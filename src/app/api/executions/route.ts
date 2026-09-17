import { EXECUTION_LIMITS } from "@/modules/execution/limits";
import { withExecutionService } from "@/modules/execution/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function safeError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: responseHeaders },
  );
}

function statusForExecution(status: string): number {
  switch (status) {
    case "succeeded":
      return 200;
    case "pending":
    case "running":
      return 202;
    case "invalid":
      return 422;
    case "blocked":
      return 403;
    case "failed":
      return 500;
    default:
      return 500;
  }
}

class RequestTooLargeError extends Error {}

async function readBoundedBody(request: Request, limit: number): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("request body limit exceeded");
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > EXECUTION_LIMITS.requestBytes
  ) {
    return safeError(
      413,
      "request_too_large",
      "The execution request exceeds the allowed size.",
    );
  }

  let bodyText: string;
  try {
    bodyText = await readBoundedBody(request, EXECUTION_LIMITS.requestBytes);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return safeError(
        413,
        "request_too_large",
        "The execution request exceeds the allowed size.",
      );
    }
    return safeError(400, "invalid_execution_request", "Invalid execution request.");
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return safeError(400, "invalid_execution_request", "Invalid execution request.");
  }

  try {
    const result = await withExecutionService((service) =>
      service.executePublic(body),
    );
    if (result.kind === "request_error") {
      return safeError(result.status, result.error.code, result.error.message);
    }
    return Response.json(result.record, {
      status: statusForExecution(result.record.status),
      headers: responseHeaders,
    });
  } catch {
    return safeError(
      503,
      "execution_unavailable",
      "Execution is temporarily unavailable.",
    );
  }
}
