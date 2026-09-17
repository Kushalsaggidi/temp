import { z } from "zod";

import { ExecutionModeSchema } from "./catalog";
import {
  AssetIdSchema,
  AssetVersionIdSchema,
  DigestSchema,
  ExecutorKeySchema,
  ExecutionIdSchema,
  JSONObjectSchema,
  JSONValueSchema,
  SemVerSchema,
  UtcTimestampSchema,
} from "./primitives";

export const ExecutionPurposeSchema = z.enum(["user_run", "prepublication_test"]);
export const ExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "invalid",
  "blocked",
]);

export const ValidationResultSchema = z
  .object({
    stage: z.enum(["input", "output", "policy", "definition_digest"]),
    valid: z.boolean(),
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1_000),
    path: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const ExecutionErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    details: JSONObjectSchema.optional(),
  })
  .strict();

export const ModelOrConfigSchema = z
  .object({
    provider: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(200).optional(),
    configuration_digest: DigestSchema.optional(),
    parameters: JSONObjectSchema.optional(),
  })
  .strict();

export const ExecutionRequestSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    scenario_label: z.string().trim().min(1).max(200).optional(),
    input: JSONValueSchema,
  })
  .strict();

const executionRecordShape = {
  execution_id: ExecutionIdSchema,
  asset_id: AssetIdSchema,
  asset_version_id: AssetVersionIdSchema,
  asset_version: SemVerSchema,
  executor_key: ExecutorKeySchema.optional(),
  definition_digest: DigestSchema.optional(),
  purpose: ExecutionPurposeSchema,
  scenario_label: z.string().trim().min(1).max(200).optional(),
  status: ExecutionStatusSchema,
  validated_input: JSONValueSchema.optional(),
  output: JSONValueSchema.optional(),
  validation_results: z.array(ValidationResultSchema),
  error: ExecutionErrorSchema.optional(),
  rejection_reason: z.string().trim().min(1).max(2_000).optional(),
  execution_mode: ExecutionModeSchema,
  model_or_config: ModelOrConfigSchema.optional(),
  started_at: UtcTimestampSchema,
  completed_at: UtcTimestampSchema.nullable(),
};

export const ExecutionRecordSchema = z
  .object(executionRecordShape)
  .strict()
  .superRefine((record, context) => {
    const resolvedStatuses = ["pending", "running", "succeeded", "failed"];
    if (resolvedStatuses.includes(record.status)) {
      for (const field of ["executor_key", "definition_digest", "validated_input"] as const) {
        if (record[field] === undefined) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `A ${record.status} execution requires ${field}`,
          });
        }
      }
    }
    const completed = record.completed_at !== null;
    if (["succeeded", "failed", "invalid", "blocked"].includes(record.status) && !completed) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: `A ${record.status} execution requires completed_at`,
      });
    }
    if (["pending", "running"].includes(record.status) && completed) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: `A ${record.status} execution must not have completed_at`,
      });
    }
    if (record.status === "succeeded" && record.output === undefined) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "A succeeded execution requires output",
      });
    }
    if (
      record.status === "succeeded" &&
      !record.validation_results.some(
        (result) => result.stage === "output" && result.valid,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation_results"],
        message: "A succeeded execution requires a valid output-stage validation result",
      });
    }
    if (record.status === "failed" && record.error === undefined) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "A failed execution requires error",
      });
    }
    if (["invalid", "blocked"].includes(record.status) && record.rejection_reason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["rejection_reason"],
        message: `A ${record.status} execution requires rejection_reason`,
      });
    }
    if (record.status !== "succeeded" && record.output !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "Only a succeeded execution may contain output",
      });
    }
    if (record.status !== "failed" && record.error !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Only a failed execution may contain error",
      });
    }
    if (!["invalid", "blocked"].includes(record.status) && record.rejection_reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["rejection_reason"],
        message: "Only an invalid or blocked execution may contain rejection_reason",
      });
    }
    if (
      record.completed_at !== null &&
      Date.parse(record.completed_at) < Date.parse(record.started_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "completed_at must not be earlier than started_at",
      });
    }
  });

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type ExecutionError = z.infer<typeof ExecutionErrorSchema>;
export type ModelOrConfig = z.infer<typeof ModelOrConfigSchema>;
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;
