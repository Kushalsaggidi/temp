import { z } from "zod";

import { AssetIdSchema, AssetVersionIdSchema, DigestSchema, UtcTimestampSchema } from "./primitives";
import { TrustScoreSchema } from "./investigation";

/* ------------------------------------------------------------------ *
 * Impact preview: what a state-changing action will actually do.
 * ------------------------------------------------------------------ */

export const ImpactActionKeySchema = z.enum([
  "flag_for_review",
  "metadata_validation",
  "publish",
  "submit_for_review",
]);

export const StateFactSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
    tone: z.enum(["positive", "warning", "negative", "neutral"]),
  })
  .strict();

export const AffectedEntitySchema = z
  .object({
    label: z.string().min(1),
    count: z.number().int().min(0),
    detail: z.string().min(1),
    /** True when the action destroys or hides these records. */
    at_risk: z.boolean(),
  })
  .strict();

export const ImpactPreviewSchema = z
  .object({
    action: ImpactActionKeySchema,
    title: z.string().min(1),
    question: z.string().min(1),
    available: z.boolean(),
    unavailable_reason: z.string().min(1).nullable(),
    current_state: z.array(StateFactSchema),
    resulting_state: z.array(StateFactSchema),
    affected: z.array(AffectedEntitySchema),
    reversible: z.boolean(),
    reversibility_note: z.string().min(1),
    confirm_label: z.string().min(1),
    endpoint: z.string().min(1).nullable(),
    body: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Impact graph: only relationships that are actually persisted.
 * ------------------------------------------------------------------ */

export const GraphNodeKindSchema = z.enum([
  "asset",
  "version",
  "evidence",
  "execution",
  "scenario",
  "owner",
  "related_asset",
]);

export const GraphNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: GraphNodeKindSchema,
    label: z.string().min(1),
    sublabel: z.string().min(1).nullable(),
    tone: z.enum(["positive", "warning", "negative", "neutral", "brand"]),
    /** Set when this node would be affected by the pending action. */
    affected: z.boolean(),
    href: z.string().min(1).nullable(),
    detail: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  })
  .strict();

export const GraphEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().min(1),
    derived: z.boolean(),
  })
  .strict();

export const ImpactGraphSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    affected_count: z.number().int().min(0),
    summary: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Alternatives: ranked by the same retrieval discovery uses.
 * ------------------------------------------------------------------ */

export const AlternativeSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    asset_id: AssetIdSchema,
    name: z.string().min(1),
    summary: z.string().min(1),
    owner: z.string().min(1),
    similarity: z.number().int().min(0).max(100),
    matched_capabilities: z.array(z.string().min(1)),
    trust: TrustScoreSchema,
    runnable: z.boolean(),
    evidence_fresh: z.boolean(),
    last_reviewed: UtcTimestampSchema.nullable(),
    safer: z.boolean(),
  })
  .strict();

export const AlternativesResultSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    subject_trust: z.number().int().min(0).max(100),
    alternatives: z.array(AlternativeSchema),
    /** Deterministic sentence describing what the ranking found. */
    observation: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Reuse intelligence: only dimensions the execution record stores.
 * ------------------------------------------------------------------ */

export const ScenarioUsageSchema = z
  .object({
    label: z.string().min(1),
    runs: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    last_run: UtcTimestampSchema.nullable(),
  })
  .strict();

export const ReuseIntelligenceSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    total: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    rejected: z.number().int().min(0),
    user_runs: z.number().int().min(0),
    prepublication_runs: z.number().int().min(0),
    distinct_scenarios: z.number().int().min(0),
    scenarios: z.array(ScenarioUsageSchema),
    first_run: UtcTimestampSchema.nullable(),
    last_run: UtcTimestampSchema.nullable(),
    reuse_proved: z.boolean(),
    observation: z.string().min(1),
    /** Explicit note about a dimension this prototype does not record. */
    not_recorded: z.array(z.string().min(1)),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Trust drift: derived from documented state transitions only.
 * ------------------------------------------------------------------ */

export const DriftStepSchema = z
  .object({
    label: z.string().min(1),
    timestamp: UtcTimestampSchema,
    score: z.number().int().min(0).max(100),
    detail: z.string().min(1),
    asset_version: z.string().min(1),
  })
  .strict();

export const DriftEntrySchema = z
  .object({
    asset_id: AssetIdSchema,
    asset_version_id: AssetVersionIdSchema,
    name: z.string().min(1),
    from_score: z.number().int().min(0).max(100),
    to_score: z.number().int().min(0).max(100),
    delta: z.number().int(),
    reason: z.string().min(1),
    severity: z.enum(["critical", "warning", "info"]),
    steps: z.array(DriftStepSchema),
  })
  .strict();

export const TrustDriftSchema = z
  .object({
    generated_at: UtcTimestampSchema,
    entries: z.array(DriftEntrySchema),
    scanned: z.number().int().min(0),
    method: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Comparison: factual differences, never a declared winner.
 * ------------------------------------------------------------------ */

export const CompareRowSchema = z
  .object({
    label: z.string().min(1),
    group: z.enum(["trust", "governance", "capability", "contract"]),
    values: z.array(
      z
        .object({
          display: z.string().min(1),
          tone: z.enum(["positive", "warning", "negative", "neutral"]),
        })
        .strict(),
    ),
    differs: z.boolean(),
  })
  .strict();

export const CompareSubjectSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    owner: z.string().min(1),
    trust: TrustScoreSchema,
    subject_digest: DigestSchema.nullable(),
  })
  .strict();

export const ComparisonSchema = z
  .object({
    subjects: z.array(CompareSubjectSchema).min(2),
    rows: z.array(CompareRowSchema),
    differing_rows: z.number().int().min(0),
    observation: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Marketplace metrics for the overview charts.
 * ------------------------------------------------------------------ */

export const MetricBucketSchema = z
  .object({
    label: z.string().min(1),
    value: z.number().int().min(0),
    tone: z.enum(["positive", "warning", "negative", "neutral", "brand"]),
    href: z.string().min(1).nullable(),
  })
  .strict();

export const MarketplaceMetricsSchema = z
  .object({
    published: z.number().int().min(0),
    governance: z.array(MetricBucketSchema),
    trust_bands: z.array(MetricBucketSchema),
    gate_health: z.array(MetricBucketSchema),
    usage: z.array(
      z
        .object({
          asset_version_id: AssetVersionIdSchema,
          name: z.string().min(1),
          runs: z.number().int().min(0),
          succeeded: z.number().int().min(0),
        })
        .strict(),
    ),
    total_runs: z.number().int().min(0),
  })
  .strict();

export type ImpactActionKey = z.infer<typeof ImpactActionKeySchema>;
export type ImpactPreview = z.infer<typeof ImpactPreviewSchema>;
export type StateFact = z.infer<typeof StateFactSchema>;
export type AffectedEntity = z.infer<typeof AffectedEntitySchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type ImpactGraph = z.infer<typeof ImpactGraphSchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type AlternativesResult = z.infer<typeof AlternativesResultSchema>;
export type ReuseIntelligence = z.infer<typeof ReuseIntelligenceSchema>;
export type ScenarioUsage = z.infer<typeof ScenarioUsageSchema>;
export type DriftEntry = z.infer<typeof DriftEntrySchema>;
export type DriftStep = z.infer<typeof DriftStepSchema>;
export type TrustDrift = z.infer<typeof TrustDriftSchema>;
export type CompareRow = z.infer<typeof CompareRowSchema>;
export type CompareSubject = z.infer<typeof CompareSubjectSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type MetricBucket = z.infer<typeof MetricBucketSchema>;
export type MarketplaceMetrics = z.infer<typeof MarketplaceMetricsSchema>;
