import { z } from "zod";

import { LifecycleStateSchema } from "./catalog";
import { ModelOrConfigSchema } from "./execution";
import {
  ActorTypeSchema,
  AssetIdSchema,
  AssetVersionIdSchema,
  DigestSchema,
  EvidenceIdSchema,
  ExecutionIdSchema,
  JSONObjectSchema,
  JSONValueSchema,
  LifecycleEventIdSchema,
  SemVerSchema,
  UtcTimestampSchema,
} from "./primitives";

export const EvidenceTypeSchema = z.enum([
  "metadata_validation",
  "functional_test",
  "guardrail_test",
  "reuse_test",
  "human_review",
  "security_review",
  "source_permission",
]);

export const EvidenceResultSchema = z.enum([
  "passed",
  "failed",
  "needs_changes",
  "informational",
  "not_applicable",
]);

export const ReviewerSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    role: z.string().trim().min(1).max(160).optional(),
    organization: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const EvidenceAssertionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    passed: z.boolean(),
    observed: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const EvidenceDetailsSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    assertions: z.array(EvidenceAssertionSchema),
    data: JSONObjectSchema.optional(),
  })
  .strict();

export const EvidenceSchema = z
  .object({
    evidence_id: EvidenceIdSchema,
    asset_id: AssetIdSchema,
    asset_version_id: AssetVersionIdSchema,
    subject_digest: DigestSchema,
    evidence_type: EvidenceTypeSchema,
    scope: z.string().trim().min(1).max(1_000),
    expected: JSONValueSchema.optional(),
    observed: JSONValueSchema,
    result: EvidenceResultSchema,
    actor_type: ActorTypeSchema,
    actor_name: z.string().trim().min(1).max(160).optional(),
    reviewer: ReviewerSchema.optional(),
    timestamp: UtcTimestampSchema,
    method: z.string().trim().min(1).max(1_000),
    scenario: z.string().trim().min(1).max(500).optional(),
    execution_ids: z.array(ExecutionIdSchema),
    artifact_reference: z.string().trim().min(1).max(1_000).optional(),
    artifact_version: SemVerSchema,
    commit_sha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/, "Expected a lowercase hexadecimal commit SHA")
      .optional(),
    model_or_config: ModelOrConfigSchema.optional(),
    details: EvidenceDetailsSchema,
    limitations: z.array(z.string().trim().min(1).max(1_000)),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.actor_type === "system" && evidence.actor_name !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["actor_name"],
        message: "System evidence must not claim a human actor name",
      });
    }
    if (evidence.actor_type === "demo_reviewer" && evidence.reviewer === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message: "Demo reviewer evidence requires reviewer details",
      });
    }
    if (evidence.evidence_type === "human_review" && evidence.actor_type === "system") {
      context.addIssue({
        code: "custom",
        path: ["actor_type"],
        message: "Human-review evidence requires an explicit human actor",
      });
    }
    if (
      evidence.evidence_type === "security_review" &&
      evidence.result === "passed" &&
      evidence.reviewer === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message: "Passed security-review evidence requires reviewer details",
      });
    }
  });

export const LifecycleEventSchema = z
  .object({
    event_id: LifecycleEventIdSchema,
    asset_id: AssetIdSchema,
    asset_version_id: AssetVersionIdSchema,
    from_state: LifecycleStateSchema.nullable().optional(),
    to_state: LifecycleStateSchema,
    actor_type: ActorTypeSchema,
    actor_name: z.string().trim().min(1).max(160).optional(),
    reason: z.string().trim().min(1).max(2_000),
    evidence_ids: z.array(EvidenceIdSchema),
    timestamp: UtcTimestampSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.from_state !== undefined && event.from_state === event.to_state) {
      context.addIssue({
        code: "custom",
        path: ["to_state"],
        message: "A lifecycle event must change state",
      });
    }
    if (event.actor_type === "system" && event.actor_name !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["actor_name"],
        message: "A system lifecycle event must not claim a human actor name",
      });
    }
  });

export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceDetails = z.infer<typeof EvidenceDetailsSchema>;
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;
export type Reviewer = z.infer<typeof ReviewerSchema>;
