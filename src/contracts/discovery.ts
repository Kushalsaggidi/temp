import { z } from "zod";

import { AssetIdSchema, AssetVersionIdSchema, QueryIdSchema, SemVerSchema } from "./primitives";

export const DiscoveryOptionalContextSchema = z
  .object({
    audience: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().min(1).max(200).optional(),
    desired_output: z.string().trim().min(1).max(500).optional(),
    constraints: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();

export const DiscoveryRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    optional_context: DiscoveryOptionalContextSchema.optional(),
  })
  .strict();

export const DiscoveryModeSchema = z.enum(["deterministic", "hybrid", "ai_assisted"]);

export const InterpretedIntentItemSchema = z
  .object({
    goal: z.string().trim().min(1).max(500),
    domain: z.string().trim().min(1).max(200).optional(),
    desired_output: z.string().trim().min(1).max(500).optional(),
    constraints: z.array(z.string().trim().min(1).max(500)),
  })
  .strict();

export const InterpretedIntentSchema = z
  .object({
    intents: z.array(InterpretedIntentItemSchema).min(1),
  })
  .strict();

export const DiscoveryCandidateSchema = z
  .object({
    asset_id: AssetIdSchema,
    asset_version_id: AssetVersionIdSchema,
    version: SemVerSchema,
    match_band: z.enum(["strong_match", "possible_match"]),
    ranking_score_internal: z.number().finite().min(0).max(1).optional(),
    scoring_method: z.string().trim().min(1).max(200),
    matched_fields: z.array(z.string().trim().min(1)).min(1),
    rationale: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const inactiveGuardrailSchema = z.object({ triggered: z.literal(false) }).strict();
const activeGuardrailSchema = z
  .object({
    triggered: z.literal(true),
    reason: z.string().trim().min(1).max(1_000),
    human_review_point: z.string().trim().min(1).max(1_000),
  })
  .strict();

const commonDiscoveryResponseShape = {
  query_id: QueryIdSchema,
  mode: DiscoveryModeSchema,
  interpreted_intent: InterpretedIntentSchema,
  fallback_used: z.boolean(),
  fallback_reason: z.string().trim().min(1).max(1_000).optional(),
};

const MatchesDiscoveryResponseSchema = z
  .object({
    ...commonDiscoveryResponseShape,
    status: z.literal("matches"),
    guardrail: inactiveGuardrailSchema,
    candidates: z.array(DiscoveryCandidateSchema).min(1),
  })
  .strict();

const ClarificationDiscoveryResponseSchema = z
  .object({
    ...commonDiscoveryResponseShape,
    status: z.literal("clarification_required"),
    clarification_question: z.string().trim().min(1).max(500),
    guardrail: inactiveGuardrailSchema,
    candidates: z.array(DiscoveryCandidateSchema).max(0),
  })
  .strict();

const NoMatchDiscoveryResponseSchema = z
  .object({
    ...commonDiscoveryResponseShape,
    status: z.literal("no_match"),
    no_match_reason: z.string().trim().min(1).max(1_000),
    guardrail: inactiveGuardrailSchema,
    candidates: z.array(DiscoveryCandidateSchema).max(0),
  })
  .strict();

const GuardrailDiscoveryResponseSchema = z
  .object({
    ...commonDiscoveryResponseShape,
    status: z.literal("guardrail"),
    guardrail: activeGuardrailSchema,
    candidates: z.array(DiscoveryCandidateSchema).max(0),
  })
  .strict();

export const DiscoveryResponseSchema = z
  .discriminatedUnion("status", [
    MatchesDiscoveryResponseSchema,
    ClarificationDiscoveryResponseSchema,
    NoMatchDiscoveryResponseSchema,
    GuardrailDiscoveryResponseSchema,
  ])
  .superRefine((response, context) => {
    if (response.fallback_used && response.fallback_reason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["fallback_reason"],
        message: "fallback_reason is required when fallback_used is true",
      });
    }
    if (!response.fallback_used && response.fallback_reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["fallback_reason"],
        message: "fallback_reason must be omitted when fallback_used is false",
      });
    }
  });

export type DiscoveryOptionalContext = z.infer<typeof DiscoveryOptionalContextSchema>;
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
