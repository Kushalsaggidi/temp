import { OperatorRequestSchema } from "@/contracts";
import { runOperator } from "@/modules/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * The operator's read path. It interprets a request, runs the capability that
 * answers it, and returns the visual blocks. A write tool reached through this
 * route returns its action preview only; nothing is changed here.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = OperatorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "invalid_operator_request", "Unexpected operator request shape.");
  }

  try {
    const response = await runOperator(parsed.data);
    return Response.json(response, { headers });
  } catch (error) {
    // Without this a 503 is undiagnosable: the cause never leaves the process.
    console.error("[operator] request failed", error);
    return fail(
      503,
      "operator_unavailable",
      "The operator could not complete that request. Nothing was changed.",
    );
  }
}
