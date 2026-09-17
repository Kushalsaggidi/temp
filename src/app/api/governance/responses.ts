import { GovernanceError } from "@/modules/governance";

export const governanceHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export function governanceErrorResponse(
  status: number,
  code: string,
  message: string,
  issues: readonly { path: string; message: string }[] = [],
): Response {
  return Response.json(
    { error: { code, message, ...(issues.length === 0 ? {} : { issues }) } },
    { status, headers: governanceHeaders },
  );
}

export async function readGovernanceJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new GovernanceError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export async function handleGovernanceRequest(
  operation: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GovernanceError) {
      return governanceErrorResponse(
        error.status,
        error.code,
        error.message,
        error.issues,
      );
    }
    return governanceErrorResponse(
      503,
      "governance_unavailable",
      "The governance workflow is temporarily unavailable.",
    );
  }
}

