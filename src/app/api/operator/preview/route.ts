import { z } from "zod";

import { OperatorContextSchema } from "@/contracts";
import { previewOperatorAction } from "@/modules/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const RequestSchema = z
  .object({
    tool: z.string().trim().min(1).max(60),
    args: z.record(z.string(), z.unknown()),
    context: OperatorContextSchema,
  })
  .strict();

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * Builds the action preview for one write capability. It reads persisted state
 * and computes what would change; it never performs the change.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "invalid_preview_request", "Unexpected preview request shape.");
  }

  try {
    const response = await previewOperatorAction(
      parsed.data.tool,
      parsed.data.args,
      parsed.data.context,
    );
    return Response.json(response, { headers });
  } catch (error) {
    // Without this a 503 is undiagnosable: the cause never leaves the process.
    console.error("[operator preview] request failed", error);
    return fail(
      503,
      "operator_unavailable",
      "The preview could not be produced. Nothing was changed.",
    );
  }
}
