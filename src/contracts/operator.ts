import { z } from "zod";

import { AssetIdSchema, AssetVersionIdSchema, UtcTimestampSchema } from "./primitives";
import { AssetTypeSchema, AvailabilitySchema, LifecycleStateSchema } from "./catalog";
import {
  AlternativesResultSchema,
  ComparisonSchema,
  ImpactGraphSchema,
  ImpactPreviewSchema,
  ReuseIntelligenceSchema,
  TrustDriftSchema,
} from "./insights";
import {
  EvidenceReferenceSchema,
  InvestigationAiStateSchema,
  TrustScoreSchema,
} from "./investigation";

/* ------------------------------------------------------------------ *
 * Shared primitives for the operator layer.
 * ------------------------------------------------------------------ */

export const OperatorToneSchema = z.enum([
  "positive",
  "warning",
  "negative",
  "neutral",
  "brand",
  "ai",
]);

export const OperatorLinkSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().min(1),
  })
  .strict();

export const OperatorSuggestionSchema = z
  .object({
    label: z.string().min(1),
    /** The exact utterance replayed when the suggestion is chosen. */
    utterance: z.string().min(1),
    hint: z.string().min(1).nullable(),
  })
  .strict();

export const OperatorFactSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
    tone: OperatorToneSchema,
    hint: z.string().min(1).nullable(),
  })
  .strict();

/** Every surface the AI Lens can be opened from. */
export const OperatorSurfaceSchema = z.enum([
  "control_center",
  "overview",
  "marketplace",
  "discovery",
  "asset",
  "investigation",
  "compare",
  "governance",
  "drift",
  "contribute",
  "agents",
  "execution",
]);

export const OperatorContextSchema = z
  .object({
    surface: OperatorSurfaceSchema,
    /** Human label for the context strip, e.g. the asset name. */
    label: z.string().min(1).max(200),
    asset_version_id: AssetVersionIdSchema.nullable(),
    asset_name: z.string().min(1).max(200).nullable(),
    /** Populated on the compare surface. */
    compare_ids: z.array(AssetVersionIdSchema).max(4),
  })
  .strict();

export const OperatorToolKindSchema = z.enum(["read", "write"]);

export const OperatorToolGroupSchema = z.enum([
  "discovery",
  "investigation",
  "governance",
  "lifecycle",
  "execution",
  "intelligence",
]);

/* ------------------------------------------------------------------ *
 * Requests.
 * ------------------------------------------------------------------ */

export const OperatorRequestSchema = z
  .object({
    utterance: z.string().trim().min(1).max(1_000),
    context: OperatorContextSchema,
    /** Carried between turns so "it" keeps meaning the same asset. */
    focus_asset_version_id: AssetVersionIdSchema.nullable().optional(),
  })
  .strict();

export const OperatorActionRequestSchema = z
  .object({
    tool: z.string().trim().min(1).max(60),
    args: z.record(z.string(), z.unknown()),
    context: OperatorContextSchema,
    /** Explicit human confirmation. A write never runs without it. */
    confirmed: z.literal(true),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Actions: the only route by which the operator changes state.
 * ------------------------------------------------------------------ */

export const OperatorActionSchema = z
  .object({
    tool: z.string().min(1),
    label: z.string().min(1),
    summary: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    asset_version_id: AssetVersionIdSchema.nullable(),
    asset_name: z.string().min(1).nullable(),
    /** What the change does, stated deterministically from persisted state. */
    effects: z.array(z.string().min(1)),
    /** Reuses the existing Impact Preview whenever the action has one. */
    preview: ImpactPreviewSchema.nullable(),
    governance: z
      .object({
        passing: z.number().int().min(0),
        required: z.number().int().min(0),
        blocking: z.array(z.string().min(1)),
      })
      .strict()
      .nullable(),
    available: z.boolean(),
    unavailable_reason: z.string().min(1).nullable(),
    confirm_label: z.string().min(1),
    reversible: z.boolean(),
    reversibility_note: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Plans: multi-step work the human inspects before anything runs.
 * ------------------------------------------------------------------ */

export const OperatorStepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "complete",
  "failed",
  "blocked",
  "skipped",
]);

export const OperatorStepSchema = z
  .object({
    index: z.number().int().min(1),
    key: z.string().min(1),
    title: z.string().min(1),
    detail: z.string().min(1),
    tool: z.string().min(1),
    kind: OperatorToolKindSchema,
    args: z.record(z.string(), z.unknown()),
    /** True when this step shows its own action preview before running. */
    confirm_required: z.boolean(),
    status: OperatorStepStatusSchema,
    outcome: z.string().min(1).nullable(),
  })
  .strict();

export const OperatorPlanSchema = z
  .object({
    plan_id: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().min(1),
    created_at: UtcTimestampSchema,
    steps: z.array(OperatorStepSchema).min(1),
    note: z.string().min(1).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Knowledge and agents.
 * ------------------------------------------------------------------ */

export const KnowledgeSectionSchema = z
  .object({
    heading: z.string().min(1),
    body: z.string().min(1),
    bullets: z.array(z.string().min(1)),
    facts: z.array(OperatorFactSchema),
    links: z.array(OperatorLinkSchema),
  })
  .strict();

export const AgentProfileSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    purpose: z.string().min(1),
    /** Where the behaviour actually lives in the repository. */
    implementation: z.string().min(1),
    model_or_config: z.string().min(1).nullable(),
    deterministic_fallback: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    inputs: z.array(z.string().min(1)).min(1),
    outputs: z.array(z.string().min(1)).min(1),
    authority: z.array(z.string().min(1)).min(1),
    tools: z.array(z.string().min(1)),
    actions: z.array(OperatorSuggestionSchema),
  })
  .strict();

export const ToolProfileSchema = z
  .object({
    name: z.string().min(1),
    group: OperatorToolGroupSchema,
    kind: OperatorToolKindSchema,
    summary: z.string().min(1),
    /** The existing service or endpoint the tool delegates to. */
    backed_by: z.string().min(1),
    confirm_required: z.boolean(),
    available: z.boolean(),
    unavailable_reason: z.string().min(1).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Visual answer blocks. The model chooses which to use; every value
 * inside one comes from a tool result, never from generated prose.
 * ------------------------------------------------------------------ */

export const OperatorAssetCardSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    asset_id: AssetIdSchema,
    name: z.string().min(1),
    summary: z.string().min(1),
    owner: z.string().min(1),
    version: z.string().min(1),
    asset_type: AssetTypeSchema,
    availability: AvailabilitySchema,
    lifecycle: LifecycleStateSchema,
    trust: TrustScoreSchema.nullable(),
    last_reviewed: UtcTimestampSchema.nullable(),
    blocking_gates: z.array(z.string().min(1)),
    matched_fields: z.array(z.string().min(1)),
    rationale: z.array(z.string().min(1)),
    executions: z.number().int().min(0).nullable(),
    href: z.string().min(1),
  })
  .strict();

const headlineBlock = z
  .object({
    kind: z.literal("headline"),
    eyebrow: z.string().min(1).nullable(),
    title: z.string().min(1),
    detail: z.string().min(1).nullable(),
    tone: OperatorToneSchema,
  })
  .strict();

const noteBlock = z
  .object({
    kind: z.literal("note"),
    text: z.string().min(1),
    tone: OperatorToneSchema,
  })
  .strict();

const factsBlock = z
  .object({
    kind: z.literal("facts"),
    title: z.string().min(1),
    items: z.array(OperatorFactSchema).min(1),
  })
  .strict();

const assetsBlock = z
  .object({
    kind: z.literal("assets"),
    title: z.string().min(1),
    caption: z.string().min(1).nullable(),
    items: z.array(OperatorAssetCardSchema),
  })
  .strict();

const trustBlock = z
  .object({
    kind: z.literal("trust"),
    asset_version_id: AssetVersionIdSchema,
    name: z.string().min(1),
    trust: TrustScoreSchema,
    blocking_gates: z.array(z.string().min(1)),
    last_reviewed: UtcTimestampSchema.nullable(),
  })
  .strict();

const signalsBlock = z
  .object({
    kind: z.literal("signals"),
    title: z.string().min(1),
    items: z
      .array(
        z
          .object({
            label: z.string().min(1),
            status: z.enum(["pass", "warn", "fail", "info"]),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const whyBlock = z
  .object({
    kind: z.literal("why"),
    question: z.string().min(1),
    chain: z
      .array(
        z
          .object({
            label: z.string().min(1),
            detail: z.string().min(1),
            tone: OperatorToneSchema,
          })
          .strict(),
      )
      .min(2),
    conclusion: z.string().min(1),
  })
  .strict();

const evidenceBlock = z
  .object({
    kind: z.literal("evidence"),
    title: z.string().min(1),
    items: z.array(EvidenceReferenceSchema),
    links: z.array(OperatorLinkSchema),
  })
  .strict();

const timelineBlock = z
  .object({
    kind: z.literal("timeline"),
    title: z.string().min(1),
    items: z
      .array(
        z
          .object({
            title: z.string().min(1),
            detail: z.string().min(1),
            timestamp: UtcTimestampSchema,
            actor: z.string().min(1).nullable(),
            tone: OperatorToneSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const comparisonBlock = z
  .object({
    kind: z.literal("comparison"),
    comparison: ComparisonSchema,
  })
  .strict();

const graphBlock = z
  .object({
    kind: z.literal("graph"),
    graph: ImpactGraphSchema,
  })
  .strict();

const alternativesBlock = z
  .object({
    kind: z.literal("alternatives"),
    result: AlternativesResultSchema,
    subject_name: z.string().min(1),
  })
  .strict();

const reuseBlock = z
  .object({
    kind: z.literal("reuse"),
    name: z.string().min(1),
    reuse: ReuseIntelligenceSchema,
  })
  .strict();

const driftBlock = z
  .object({
    kind: z.literal("drift"),
    drift: TrustDriftSchema,
  })
  .strict();

const chartBlock = z
  .object({
    kind: z.literal("chart"),
    title: z.string().min(1),
    question: z.string().min(1),
    variant: z.enum(["bar", "stacked"]),
    caption: z.string().min(1),
    table_label: z.string().min(1),
    value_label: z.string().min(1),
    data: z
      .array(
        z
          .object({
            label: z.string().min(1),
            value: z.number().int().min(0),
            tone: OperatorToneSchema,
            note: z.string().min(1).nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const actionPreviewBlock = z
  .object({
    kind: z.literal("action_preview"),
    action: OperatorActionSchema,
  })
  .strict();

const planBlock = z
  .object({
    kind: z.literal("plan"),
    plan: OperatorPlanSchema,
  })
  .strict();

const completionBlock = z
  .object({
    kind: z.literal("completion"),
    title: z.string().min(1),
    detail: z.string().min(1),
    /** Carried so a plan's next step knows what the previous one produced. */
    asset_version_id: AssetVersionIdSchema.nullable(),
    facts: z.array(OperatorFactSchema),
    /** True only when the resulting state was re-read after the write. */
    verified: z.boolean(),
    links: z.array(OperatorLinkSchema),
  })
  .strict();

const blockedBlock = z
  .object({
    kind: z.literal("blocked"),
    title: z.string().min(1),
    reason: z.string().min(1),
    detail: z.array(z.string().min(1)),
    links: z.array(OperatorLinkSchema),
    suggestions: z.array(OperatorSuggestionSchema),
  })
  .strict();

const knowledgeBlock = z
  .object({
    kind: z.literal("knowledge"),
    title: z.string().min(1),
    summary: z.string().min(1),
    sections: z.array(KnowledgeSectionSchema).min(1),
  })
  .strict();

const agentsBlock = z
  .object({
    kind: z.literal("agents"),
    title: z.string().min(1),
    items: z.array(AgentProfileSchema).min(1),
  })
  .strict();

const capabilitiesBlock = z
  .object({
    kind: z.literal("capabilities"),
    title: z.string().min(1),
    groups: z
      .array(
        z
          .object({
            group: OperatorToolGroupSchema,
            label: z.string().min(1),
            tools: z.array(ToolProfileSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const sourcesBlock = z
  .object({
    kind: z.literal("sources"),
    title: z.string().min(1),
    signals: z
      .array(
        z
          .object({
            label: z.string().min(1),
            used: z.boolean(),
          })
          .strict(),
      )
      .min(1),
    links: z.array(OperatorLinkSchema),
  })
  .strict();

const inferenceBlock = z
  .object({
    kind: z.literal("inference"),
    text: z.string().min(1),
    recommendation: z.string().min(1).nullable(),
    ai: z
      .object({
        state: InvestigationAiStateSchema,
        model_or_config: z.string().min(1).nullable(),
        reason: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

const contributionBlock = z
  .object({
    kind: z.literal("contribution"),
    title: z.string().min(1),
    draft: z
      .object({
        slug: z.string().min(1),
        name: z.string().min(1),
        summary: z.string().min(1),
        owner: z.string().min(1),
        asset_type: AssetTypeSchema,
        version: z.string().min(1),
        capabilities: z.array(z.string().min(1)),
        use_cases: z.array(z.string().min(1)),
        domains: z.array(z.string().min(1)),
        audiences: z.array(z.string().min(1)),
        limitations: z.array(z.string().min(1)),
        description: z.string().min(1),
        usage_instructions: z.string().min(1),
        setup_expectations: z.string().min(1),
        maintenance_expectations: z.string().min(1),
      })
      .strict(),
    checks: z
      .array(
        z
          .object({
            label: z.string().min(1),
            status: z.enum(["pass", "warn", "fail"]),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    passing: z.number().int().min(0),
    total: z.number().int().min(0),
    duplicates: z.array(OperatorAssetCardSchema),
    ai_assisted: z.boolean(),
  })
  .strict();

export const OperatorBlockSchema = z.discriminatedUnion("kind", [
  headlineBlock,
  noteBlock,
  factsBlock,
  assetsBlock,
  trustBlock,
  signalsBlock,
  whyBlock,
  evidenceBlock,
  timelineBlock,
  comparisonBlock,
  graphBlock,
  alternativesBlock,
  reuseBlock,
  driftBlock,
  chartBlock,
  actionPreviewBlock,
  planBlock,
  completionBlock,
  blockedBlock,
  knowledgeBlock,
  agentsBlock,
  capabilitiesBlock,
  sourcesBlock,
  inferenceBlock,
  contributionBlock,
]);

/* ------------------------------------------------------------------ *
 * Responses.
 * ------------------------------------------------------------------ */

/** How the optional model was involved in this turn, if at all. */
export const OperatorAiStateSchema = z.enum([
  "ready",
  "not_needed",
  "disabled",
  "unavailable",
]);

export const OperatorUnderstandingSchema = z
  .object({
    intent: z.string().min(1),
    tool: z.string().min(1).nullable(),
    kind: OperatorToolKindSchema.nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    /** How the request was read, in one sentence. */
    interpretation: z.string().min(1),
    routed_by: z.enum(["deterministic", "model"]),
    resolved_asset: z
      .object({
        asset_version_id: AssetVersionIdSchema,
        name: z.string().min(1),
        how: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const OperatorTraceEntrySchema = z
  .object({
    tool: z.string().min(1),
    kind: OperatorToolKindSchema,
    status: z.enum(["ok", "error", "skipped"]),
    detail: z.string().min(1),
    duration_ms: z.number().int().min(0),
  })
  .strict();

export const OperatorResponseSchema = z
  .object({
    request_id: z.string().min(1),
    generated_at: UtcTimestampSchema,
    utterance: z.string().min(1),
    context_label: z.string().min(1),
    understanding: OperatorUnderstandingSchema,
    blocks: z.array(OperatorBlockSchema).min(1),
    suggestions: z.array(OperatorSuggestionSchema),
    trace: z.array(OperatorTraceEntrySchema),
    ai: z
      .object({
        state: OperatorAiStateSchema,
        model_or_config: z.string().min(1).nullable(),
        reason: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Live system state shown in the console rails.
 * ------------------------------------------------------------------ */

export const OperatorSystemStateSchema = z
  .object({
    generated_at: UtcTimestampSchema,
    published: z.number().int().min(0),
    ready_to_use: z.number().int().min(0),
    runnable: z.number().int().min(0),
    needs_attention: z.number().int().min(0),
    drift_warnings: z.number().int().min(0),
    in_review: z.number().int().min(0),
    drafts: z.number().int().min(0),
    deprecated: z.number().int().min(0),
    executions: z.number().int().min(0),
    successful_executions: z.number().int().min(0),
    evidence_records: z.number().int().min(0),
    agents: z.number().int().min(0),
    signals: z
      .array(
        z
          .object({
            tone: OperatorToneSchema,
            text: z.string().min(1),
            href: z.string().min(1).nullable(),
            utterance: z.string().min(1).nullable(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export type OperatorTone = z.infer<typeof OperatorToneSchema>;
export type OperatorLink = z.infer<typeof OperatorLinkSchema>;
export type OperatorSuggestion = z.infer<typeof OperatorSuggestionSchema>;
export type OperatorFact = z.infer<typeof OperatorFactSchema>;
export type OperatorSurface = z.infer<typeof OperatorSurfaceSchema>;
export type OperatorContext = z.infer<typeof OperatorContextSchema>;
export type OperatorToolKind = z.infer<typeof OperatorToolKindSchema>;
export type OperatorToolGroup = z.infer<typeof OperatorToolGroupSchema>;
export type OperatorRequest = z.infer<typeof OperatorRequestSchema>;
export type OperatorActionRequest = z.infer<typeof OperatorActionRequestSchema>;
export type OperatorAction = z.infer<typeof OperatorActionSchema>;
export type OperatorStep = z.infer<typeof OperatorStepSchema>;
export type OperatorStepStatus = z.infer<typeof OperatorStepStatusSchema>;
export type OperatorPlan = z.infer<typeof OperatorPlanSchema>;
export type KnowledgeSection = z.infer<typeof KnowledgeSectionSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type ToolProfile = z.infer<typeof ToolProfileSchema>;
export type OperatorAssetCard = z.infer<typeof OperatorAssetCardSchema>;
export type OperatorBlock = z.infer<typeof OperatorBlockSchema>;
export type OperatorUnderstanding = z.infer<typeof OperatorUnderstandingSchema>;
export type OperatorTraceEntry = z.infer<typeof OperatorTraceEntrySchema>;
export type OperatorAiState = z.infer<typeof OperatorAiStateSchema>;
export type OperatorResponse = z.infer<typeof OperatorResponseSchema>;
export type OperatorSystemState = z.infer<typeof OperatorSystemStateSchema>;
