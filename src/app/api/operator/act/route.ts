import { OperatorActionRequestSchema } from "@/contracts";
import { executeOperatorAction } from "@/modules/operator";

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
 * The operator's only write path. It refuses anything that does not carry an
 * explicit confirmation, performs the capability, then re-reads the resulting
 * state before reporting it.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = OperatorActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      422,
      "confirmation_required",
      "A state-changing action requires an explicit confirmation. Nothing was changed.",
    );
  }

  try {
    const response = await executeOperatorAction(parsed.data);
    return Response.json(response, { headers });
  } catch (error) {
    // Without this a 503 is undiagnosable: the cause never leaves the process.
    console.error("[operator act] request failed", error);
    return fail(
      503,
      "operator_unavailable",
      "The action could not be completed. Nothing was changed.",
    );
  }
}
