import { z } from "zod";

import {
  AssetIdSchema,
  AssetVersionIdSchema,
  DigestSchema,
  EvidenceIdSchema,
  ExecutorKeySchema,
  JsonSchemaDocumentSchema,
  JSONValueSchema,
  ScenarioIdSchema,
  SemVerSchema,
  SlugSchema,
  UtcTimestampSchema,
} from "./primitives";

export const AssetTypeSchema = z.enum([
  "skill",
  "workflow",
  "agent",
  "template",
  "dashboard",
  "plugin",
  "other",
]);

export const ExecutionKindSchema = z.enum([
  "deterministic",
  "llm",
  "retrieval",
  "agentic",
  "none",
]);

export const ExecutionModeSchema = z.enum([
  "deterministic",
  "llm",
  "retrieval",
  "agentic",
]);

export const AvailabilitySchema = z.enum([
  "runnable",
  "reference_only",
  "request_access",
]);

export const LifecycleStateSchema = z.enum([
  "draft",
  "submitted",
  "in_review",
  "changes_requested",
  "published",
  "deprecated",
]);

export const SourceClassSchema = z.enum([
  "created_during_event",
  "team_owned",
  "sponsor_provided",
  "third_party",
]);

export const PermissionStatusSchema = z.enum([
  "confirmed",
  "not_applicable",
  "unconfirmed",
]);

export const AssetSchema = z
  .object({
    asset_id: AssetIdSchema,
    slug: SlugSchema,
    current_published_version_id: AssetVersionIdSchema.nullable().optional(),
    created_at: UtcTimestampSchema,
    updated_at: UtcTimestampSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    if (Date.parse(asset.updated_at) < Date.parse(asset.created_at)) {
      context.addIssue({
        code: "custom",
        path: ["updated_at"],
        message: "updated_at must not be earlier than created_at",
      });
    }
  });

export const TestScenarioSchema = z
  .object({
    scenario_id: ScenarioIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    input_fixture: JSONValueSchema,
    expected_usefulness: z.array(z.string().trim().min(1)).min(1),
    expected_safety: z.array(z.string().trim().min(1)).min(1),
    output_schema_expectations: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const AssetVersionContentSchema = z
  .object({
    asset_version_id: AssetVersionIdSchema,
    asset_id: AssetIdSchema,
    version: SemVerSchema,
    name: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    owner: z.string().trim().min(1).max(160),
    asset_type: AssetTypeSchema,
    execution_kind: ExecutionKindSchema,
    description: z.string().trim().min(1).max(5_000),
    audiences: z.array(z.string().trim().min(1)).min(1),
    domains: z.array(z.string().trim().min(1)).min(1),
    capabilities: z.array(z.string().trim().min(1)).min(1),
    use_cases: z.array(z.string().trim().min(1)).min(1),
    input_schema: JsonSchemaDocumentSchema,
    output_schema: JsonSchemaDocumentSchema,
    limitations: z.array(z.string().trim().min(1)).min(1),
    usage_instructions: z.string().trim().min(1).max(5_000),
    setup_expectations: z.string().trim().min(1).max(5_000),
    maintenance_expectations: z.string().trim().min(1).max(5_000),
    test_scenarios: z.array(TestScenarioSchema),
    availability: AvailabilitySchema,
    executor_key: ExecutorKeySchema.optional(),
    definition_digest: DigestSchema.optional(),
    source_class: SourceClassSchema,
    source_reference: z.string().trim().min(1).max(500).nullable().optional(),
    license_id: z.string().trim().min(1).max(100).nullable().optional(),
    attribution: z.string().trim().min(1).max(1_000).nullable().optional(),
    permission_evidence_id: EvidenceIdSchema.nullable().optional(),
    access_permission: PermissionStatusSchema,
    tool_use_permission: PermissionStatusSchema,
    final_package_permission: PermissionStatusSchema,
    created_at: UtcTimestampSchema,
  })
  .strict();

export const AssetVersionGovernanceSchema = z
  .object({
    lifecycle: LifecycleStateSchema,
    subject_digest: DigestSchema.nullable(),
    published_at: UtcTimestampSchema.nullable(),
    deprecated_at: UtcTimestampSchema.nullable(),
    replacement_version: AssetVersionIdSchema.nullable(),
  })
  .strict();

const assetVersionShape = {
  ...AssetVersionContentSchema.shape,
  ...AssetVersionGovernanceSchema.shape,
};

export const AssetVersionSchema = z
  .object(assetVersionShape)
  .strict()
  .superRefine((version, context) => {
    if (version.availability === "runnable") {
      if (!version.executor_key) {
        context.addIssue({
          code: "custom",
          path: ["executor_key"],
          message: "A runnable asset version requires executor_key",
        });
      }
      if (!version.definition_digest) {
        context.addIssue({
          code: "custom",
          path: ["definition_digest"],
          message: "A runnable asset version requires definition_digest",
        });
      }
      if (version.execution_kind === "none") {
        context.addIssue({
          code: "custom",
          path: ["execution_kind"],
          message: "A runnable asset version cannot use execution_kind none",
        });
      }
    } else {
      if (version.executor_key !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["executor_key"],
          message: "A non-runnable asset version must not declare executor_key",
        });
      }
      if (version.definition_digest !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["definition_digest"],
          message: "A non-runnable asset version must not declare definition_digest",
        });
      }
    }

    const isPublished = version.lifecycle === "published";
    const isDeprecated = version.lifecycle === "deprecated";
    if ((isPublished || isDeprecated) && version.subject_digest === null) {
      context.addIssue({
        code: "custom",
        path: ["subject_digest"],
        message: "A published or deprecated version requires a frozen subject_digest",
      });
    }
    if ((isPublished || isDeprecated) && version.published_at === null) {
      context.addIssue({
        code: "custom",
        path: ["published_at"],
        message: "A published or deprecated version requires published_at",
      });
    }
    if (isPublished || isDeprecated) {
      for (const field of [
        "access_permission",
        "tool_use_permission",
        "final_package_permission",
      ] as const) {
        if (version[field] === "unconfirmed") {
          context.addIssue({
            code: "custom",
            path: [field],
            message:
              "A published or deprecated version cannot have unconfirmed permissions",
          });
        }
      }
    }
    if (!isPublished && !isDeprecated && version.published_at !== null) {
      context.addIssue({
        code: "custom",
        path: ["published_at"],
        message: "An unpublished version must not have published_at",
      });
    }
    if (isDeprecated && version.deprecated_at === null) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_at"],
        message: "A deprecated version requires deprecated_at",
      });
    }
    if (!isDeprecated && version.deprecated_at !== null) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_at"],
        message: "Only a deprecated version may have deprecated_at",
      });
    }
    if (!isDeprecated && version.replacement_version !== null) {
      context.addIssue({
        code: "custom",
        path: ["replacement_version"],
        message: "Only a deprecated version may have a replacement_version",
      });
    }
    if (version.replacement_version === version.asset_version_id) {
      context.addIssue({
        code: "custom",
        path: ["replacement_version"],
        message: "A version cannot replace itself",
      });
    }
    if (version.source_class === "third_party") {
      const requiredSourceFields = [
        ["source_reference", version.source_reference],
        ["license_id", version.license_id],
        ["attribution", version.attribution],
        ["permission_evidence_id", version.permission_evidence_id],
      ] as const;
      for (const [field, value] of requiredSourceFields) {
        if (value === undefined || value === null) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `A third-party version requires ${field}`,
          });
        }
      }
      for (const field of [
        "access_permission",
        "tool_use_permission",
        "final_package_permission",
      ] as const) {
        if (version[field] !== "confirmed") {
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Third-party source permissions must be confirmed",
          });
        }
      }
    }
    if (
      version.published_at !== null &&
      Date.parse(version.published_at) < Date.parse(version.created_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["published_at"],
        message: "published_at must not be earlier than created_at",
      });
    }
    if (
      version.deprecated_at !== null &&
      version.published_at !== null &&
      Date.parse(version.deprecated_at) < Date.parse(version.published_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_at"],
        message: "deprecated_at must not be earlier than published_at",
      });
    }
  });

export const AssetVersionRecordSchema = z
  .object({
    asset: AssetSchema,
    asset_version: AssetVersionSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.asset.asset_id !== record.asset_version.asset_id) {
      context.addIssue({
        code: "custom",
        path: ["asset_version", "asset_id"],
        message: "Asset and version identifiers must agree",
      });
    }
    if (
      record.asset.current_published_version_id === record.asset_version.asset_version_id &&
      record.asset_version.lifecycle !== "published"
    ) {
      context.addIssue({
        code: "custom",
        path: ["asset", "current_published_version_id"],
        message: "The current published pointer must reference a published version",
      });
    }
  });

export type Asset = z.infer<typeof AssetSchema>;
export type AssetType = z.infer<typeof AssetTypeSchema>;
export type AssetVersionContent = z.infer<typeof AssetVersionContentSchema>;
export type AssetVersionGovernance = z.infer<typeof AssetVersionGovernanceSchema>;
export type AssetVersion = z.infer<typeof AssetVersionSchema>;
export type AssetVersionRecord = z.infer<typeof AssetVersionRecordSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type ExecutionKind = z.infer<typeof ExecutionKindSchema>;
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;
export type PermissionStatus = z.infer<typeof PermissionStatusSchema>;
export type TestScenario = z.infer<typeof TestScenarioSchema>;

export const parseAssetVersionRecord = (value: unknown): AssetVersionRecord =>
  AssetVersionRecordSchema.parse(value);
