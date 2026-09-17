import bootstrapFixture from "../../fixtures/catalog/bootstrap-draft.json";
import {
  AssetVersionContentSchema,
  AssetVersionRecordSchema,
  ExecutorManifestSchema,
  JSONValueSchema,
  type AssetVersionRecord,
  type ExecutionRecord,
  type ExecutorManifest,
  type JSONValue,
} from "@/contracts";
import {
  computeDefinitionDigest,
  computeSubjectDigest,
  sha256Digest,
} from "@/shared/integrity";

export const TEST_EXECUTOR_KEY = "property_ops.brief_builder";

export function createTestManifest(
  inputSchema: JSONValue = bootstrapFixture.asset_version.input_schema as JSONValue,
  outputSchema: JSONValue = bootstrapFixture.asset_version.output_schema as JSONValue,
): ExecutorManifest {
  return ExecutorManifestSchema.parse({
    schema_version: "1.0.0",
    executor_key: TEST_EXECUTOR_KEY,
    implementation_version: "1.0.0",
    implementation_digest: `sha256:${"1".repeat(64)}`,
    input_schema_digest: sha256Digest(JSONValueSchema.parse(inputSchema)),
    output_schema_digest: sha256Digest(JSONValueSchema.parse(outputSchema)),
    behavior_config_digest: `sha256:${"2".repeat(64)}`,
  });
}

export function createRunnableHeroRecord(options: {
  lifecycle?: "draft" | "submitted" | "in_review" | "changes_requested" | "published";
  definitionDigest?: `sha256:${string}`;
  executionKind?: "deterministic" | "llm" | "retrieval" | "agentic";
  current?: boolean;
} = {}): AssetVersionRecord {
  const lifecycle = options.lifecycle ?? "draft";
  const manifest = createTestManifest();
  const definitionDigest =
    options.definitionDigest ?? computeDefinitionDigest(manifest);
  const original = bootstrapFixture.asset_version;
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...originalContent
  } = original;
  const content = AssetVersionContentSchema.parse({
    ...originalContent,
    owner: "Execution test maintainer",
    execution_kind: options.executionKind ?? "deterministic",
    availability: "runnable",
    executor_key: TEST_EXECUTOR_KEY,
    definition_digest: definitionDigest,
    access_permission: "confirmed",
    tool_use_permission: "confirmed",
    final_package_permission: "confirmed",
    setup_expectations:
      "Runs locally through the reviewed deterministic executor with no integrations.",
    maintenance_expectations:
      "Recompute artifact and definition digests after any reviewed implementation change.",
  });
  const subjectDigest = computeSubjectDigest(content);
  const published = lifecycle === "published";

  return AssetVersionRecordSchema.parse({
    asset: {
      ...bootstrapFixture.asset,
      current_published_version_id:
        published && options.current !== false ? content.asset_version_id : null,
    },
    asset_version: {
      ...content,
      lifecycle,
      subject_digest: subjectDigest,
      published_at: published ? "2026-09-16T10:00:00Z" : null,
      deprecated_at: null,
      replacement_version: null,
    },
  });
}

export class RecordingExecutionStore {
  readonly records = new Map<string, ExecutionRecord>();
  readonly history: ExecutionRecord[] = [];

  insert(record: ExecutionRecord): void {
    if (this.records.has(record.execution_id)) throw new Error("duplicate execution");
    this.records.set(record.execution_id, record);
    this.history.push(structuredClone(record));
  }

  update(record: ExecutionRecord): void {
    if (!this.records.has(record.execution_id)) throw new Error("missing execution");
    this.records.set(record.execution_id, record);
    this.history.push(structuredClone(record));
  }

  getById(executionId: string): ExecutionRecord | null {
    return this.records.get(executionId) ?? null;
  }
}
