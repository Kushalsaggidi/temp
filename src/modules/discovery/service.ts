import { randomUUID } from "node:crypto";
import {
  DiscoveryRequestSchema,
  DiscoveryResponseSchema,
  type AssetVersionRecord,
  type DiscoveryRequest,
  type DiscoveryResponse,
} from "@/contracts";
import type { OptionalAiProvider } from "@/shared/ports";
import {
  GeminiDiscoveryAdapter,
  type SemanticEnhancement,
  type SemanticEnhancementInput,
} from "./adapter";
import { guardrailFor } from "./guardrails";
import { normalizeIntent, normalizeSemanticTerms } from "./normalization";
import { isAmbiguous, toCandidate } from "./ranking";
import { retrievePublished } from "./retrieval";

type DiscoveryAiProvider = OptionalAiProvider<
  SemanticEnhancementInput,
  SemanticEnhancement
>;

function queryId(): string {
  return `query_${randomUUID().replaceAll("-", "")}`;
}

export async function discover(
  input: unknown,
  records: AssetVersionRecord[],
  ai: DiscoveryAiProvider = new GeminiDiscoveryAdapter(),
): Promise<DiscoveryResponse> {
  const request: DiscoveryRequest = DiscoveryRequestSchema.parse(input);
  const interpretedIntent = normalizeIntent(request);
  const base = {
    query_id: queryId(),
    interpreted_intent: interpretedIntent,
    fallback_used: false as const,
    mode: "deterministic" as const,
  };

  const guardrail = guardrailFor(request);
  if (guardrail.triggered) {
    return DiscoveryResponseSchema.parse({
      ...base,
      status: "guardrail",
      guardrail,
      candidates: [],
    });
  }

  if (interpretedIntent.intents.length > 1) {
    return DiscoveryResponseSchema.parse({
      ...base,
      status: "clarification_required",
      clarification_question:
        `Your request contains ${interpretedIntent.intents.length} separate intents. Which one should we search first?`,
      guardrail: { triggered: false },
      candidates: [],
    });
  }

  if (isAmbiguous(request)) {
    return DiscoveryResponseSchema.parse({
      ...base,
      status: "clarification_required",
      clarification_question:
        "What specific work should the asset help with, and what output do you need?",
      guardrail: { triggered: false },
      candidates: [],
    });
  }

  let semanticTerms: string[] = [];
  let fallbackReason: string | undefined;
  let aiWasUsed = false;

  if (ai.state !== "disabled") {
    try {
      const enhancement = await ai.enhance({
        interpreted_intent: interpretedIntent,
        ...(request.optional_context?.audience
          ? { audience: request.optional_context.audience }
          : {}),
      });
      if (enhancement.state === "ready") {
        semanticTerms = normalizeSemanticTerms(enhancement.output.additional_terms);
        aiWasUsed = true;
      } else {
        fallbackReason = enhancement.reason;
      }
    } catch {
      fallbackReason =
        "Optional AI failed unexpectedly; deterministic discovery used.";
    }
  }

  const candidates = retrievePublished(records, interpretedIntent.intents[0]!, {
    ...(request.optional_context?.audience
      ? { audience: request.optional_context.audience }
      : {}),
    ...(semanticTerms.length > 0 ? { semanticTerms } : {}),
  });
  const responseBase = fallbackReason
    ? {
        ...base,
        mode: "hybrid" as const,
        fallback_used: true as const,
        fallback_reason: fallbackReason,
      }
    : aiWasUsed
      ? { ...base, mode: "hybrid" as const }
      : base;

  if (candidates.length === 0) {
    return DiscoveryResponseSchema.parse({
      ...responseBase,
      status: "no_match",
      no_match_reason:
        "No published asset met the deterministic evidence threshold for this request.",
      guardrail: { triggered: false },
      candidates: [],
    });
  }

  return DiscoveryResponseSchema.parse({
    ...responseBase,
    status: "matches",
    guardrail: { triggered: false },
    candidates: candidates.slice(0, 5).map(toCandidate),
  });
}
