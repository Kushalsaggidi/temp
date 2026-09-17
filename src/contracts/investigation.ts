import { z } from "zod";

import { AssetIdSchema, AssetVersionIdSchema, DigestSchema, UtcTimestampSchema } from "./primitives";

export const TrustBandSchema = z.enum(["strong", "adequate", "attention", "blocked"]);

export const TrustDimensionStatusSchema = z.enum([
  "passed",
  "attention",
  "failed",
  "not_required",
]);

export const TrustDimensionSchema = z
  .object({
    key: z.enum(["governance", "review", "evidence", "security", "freshness"]),
    label: z.string().min(1),
    status: TrustDimensionStatusSchema,
    detail: z.string().min(1),
  })
  .strict();

export const TrustScoreSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    band: TrustBandSchema,
    label: z.string().min(1),
    dimensions: z.array(TrustDimensionSchema),
    required_gates: z.number().int().min(0),
    passing_gates: z.number().int().min(0),
  })
  .strict();

export const SignalDirectionSchema = z.enum(["down", "up", "flat"]);
export const SignalSeveritySchema = z.enum(["critical", "warning", "info"]);

export const ChangeSignalSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    before: z.string().min(1),
    after: z.string().min(1),
    direction: SignalDirectionSchema,
    severity: SignalSeveritySchema,
    detail: z.string().min(1),
    /** Rendered in monospace when the values are digests or identifiers. */
    technical: z.boolean(),
  })
  .strict();

export const EvidenceReferenceSchema = z
  .object({
    evidence_id: z.string().min(1),
    evidence_type: z.string().min(1),
    state: z.string().min(1),
    state_label: z.string().min(1),
    tone: z.enum(["positive", "warning", "negative", "neutral"]),
    subject_digest: DigestSchema,
    digest_matches_current: z.boolean(),
    timestamp: UtcTimestampSchema,
    reviewer: z.string().nullable(),
    summary: z.string().min(1),
    scope: z.string().min(1),
    href: z.string().min(1),
  })
  .strict();

export const RecommendedActionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    emphasis: z.enum(["primary", "secondary"]),
    /** Present only when the action performs a real state change. */
    endpoint: z.string().min(1).nullable(),
    method: z.enum(["POST", "GET"]).nullable(),
    body: z.record(z.string(), z.unknown()).nullable(),
    effect: z.string().min(1),
  })
  .strict();

export const InvestigationAiStateSchema = z.enum(["ready", "disabled", "unavailable"]);

export const InvestigationReportSchema = z
  .object({
    asset_id: AssetIdSchema,
    asset_version_id: AssetVersionIdSchema,
    asset_name: z.string().min(1),
    asset_version: z.string().min(1),
    generated_at: UtcTimestampSchema,
    severity: SignalSeveritySchema,
    headline: z.string().min(1),
    subheadline: z.string().min(1),
    trust: TrustScoreSchema,
    /** Trust for the previous published version of the same asset, when one exists. */
    baseline: z
      .object({
        asset_version_id: AssetVersionIdSchema,
        asset_version: z.string().min(1),
        score: z.number().int().min(0).max(100),
        subject_digest: DigestSchema.nullable(),
      })
      .strict()
      .nullable(),
    signals: z.array(ChangeSignalSchema),
    /** Deterministic facts read from persisted records. */
    observations: z.array(z.string().min(1)),
    /** Model interpretation. Never presented as verified fact. */
    inference: z.string().min(1),
    recommendation: z.string().min(1),
    impact: z.string().min(1),
    changed_fields: z.array(z.string().min(1)),
    evidence: z.array(EvidenceReferenceSchema),
    actions: z.array(RecommendedActionSchema),
    ai: z
      .object({
        state: InvestigationAiStateSchema,
        model_or_config: z.string().min(1).nullable(),
        reason: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export type TrustBand = z.infer<typeof TrustBandSchema>;
export type TrustDimension = z.infer<typeof TrustDimensionSchema>;
export type TrustScore = z.infer<typeof TrustScoreSchema>;
export type ChangeSignal = z.infer<typeof ChangeSignalSchema>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;
export type SignalSeverity = z.infer<typeof SignalSeveritySchema>;
