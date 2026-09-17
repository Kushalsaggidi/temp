import type { OptionalAiProvider } from "@/shared/ports";
import { DisabledAiProvider } from "@/shared/ports";

export interface MetadataAssistanceInput {
  metadata: Record<string, unknown>;
}

export interface MetadataAssistanceOutput {
  deterministic_findings: string[];
  ai: {
    state: "disabled" | "unavailable" | "ready";
    suggestions: string[];
    model_or_config?: string;
    reason?: string;
  };
  authority: {
    can_approve: false;
    can_publish: false;
  };
}

const REQUIRED_TEXT_FIELDS = [
  "name",
  "summary",
  "owner",
  "description",
  "usage_instructions",
  "setup_expectations",
  "maintenance_expectations",
] as const;

const REQUIRED_LIST_FIELDS = [
  "audiences",
  "domains",
  "capabilities",
  "use_cases",
  "limitations",
] as const;

export class MetadataAssistanceService {
  constructor(
    private readonly provider: OptionalAiProvider<
      MetadataAssistanceInput,
      readonly string[]
    > = new DisabledAiProvider(),
  ) {}

  async inspect(input: MetadataAssistanceInput): Promise<MetadataAssistanceOutput> {
    const findings: string[] = [];
    for (const field of REQUIRED_TEXT_FIELDS) {
      const value = input.metadata[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        findings.push(`Add a clear ${field.replaceAll("_", " ")}.`);
      }
    }
    for (const field of REQUIRED_LIST_FIELDS) {
      const value = input.metadata[field];
      if (!Array.isArray(value) || value.length === 0) {
        findings.push(`Add at least one ${field.replaceAll("_", " ")}.`);
      }
    }

    const result = await this.provider.enhance(input);
    if (result.state !== "ready") {
      return {
        deterministic_findings: findings,
        ai: { state: result.state, suggestions: [], reason: result.reason },
        authority: { can_approve: false, can_publish: false },
      };
    }
    const suggestions = result.output
      .filter((suggestion): suggestion is string => typeof suggestion === "string")
      .map((suggestion) => suggestion.trim())
      .filter(Boolean)
      .slice(0, 20);
    return {
      deterministic_findings: findings,
      ai: {
        state: "ready",
        suggestions,
        model_or_config: result.modelOrConfig,
      },
      authority: { can_approve: false, can_publish: false },
    };
  }
}

