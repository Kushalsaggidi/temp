import type { ZodIssue } from "zod";

export interface GovernanceIssue {
  path: string;
  message: string;
}

export class GovernanceError extends Error {
  readonly name = "GovernanceError";

  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly issues: readonly GovernanceIssue[] = [],
  ) {
    super(message);
  }
}

export function issuesFromZod(issues: readonly ZodIssue[]): GovernanceIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

