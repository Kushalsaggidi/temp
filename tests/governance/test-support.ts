import bootstrapFixture from "../../fixtures/catalog/bootstrap-draft.json";
import {
  AssetVersionContentSchema,
  EvidenceSchema,
  ExecutionRecordSchema,
  type AssetVersionRecord,
  type Evidence,
  type EvidenceResult,
  type EvidenceType,
  type ExecutionRecord,
} from "@/contracts";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  ExecutionRepository,
  serverExecutorRegistry,
} from "@/modules/execution";
import { GovernanceRepository, GovernanceService } from "@/modules/governance";
import type { MarketplaceDatabase } from "@/server/db";
import type { Clock, IdGenerator } from "@/shared/ports";
import { computeSubjectDigest } from "@/shared/integrity";

export class SequenceClock implements Clock {
  private count = 0;

  constructor(private readonly start = Date.parse("2026-09-16T12:00:00Z")) {}

  now(): Date {
    const value = new Date(this.start + this.count * 1_000);
    this.count += 1;
    return value;
  }
}

export class SequenceIds implements IdGenerator {
  private count = 0;

  next(prefix: string): string {
    this.count += 1;
    return `${prefix}_governance_${this.count}`;
  }
}

export function createGovernanceService(database: MarketplaceDatabase): GovernanceService {
  return new GovernanceService(
    new GovernanceRepository(database),
    new SequenceClock(),
    new SequenceIds(),
    serverExecutorRegistry,
    new ExecutionRepository(database),
  );
}

export function freezeBootstrap(
  database: MarketplaceDatabase,
  options: { runnable?: boolean } = {},
): AssetVersionRecord {
  const repository = new GovernanceRepository(database);
  const existing = repository.getVersionById(
    "av_property_ops_brief_0_1_0_draft_1",
  );
  if (existing === null) throw new Error("bootstrap missing");
  const version = existing.asset_version;
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...originalContent
  } = version;
  const runnable = options.runnable === true;
  const content = AssetVersionContentSchema.parse({
    ...originalContent,
    owner: "Governance test owner",
    source_reference: "Synthetic event-created governance test material",
    access_permission: "confirmed",
    tool_use_permission: "confirmed",
    final_package_permission: "confirmed",
    execution_kind: runnable ? "deterministic" : "none",
    availability: runnable ? "runnable" : "reference_only",
    ...(runnable
      ? {
          executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
          definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
        }
      : {}),
  });
  const digest = computeSubjectDigest(content);
  database
    .prepare("UPDATE asset_versions SET content_json = ? WHERE asset_version_id = ?")
    .run(JSON.stringify(content), content.asset_version_id);
  database
    .prepare("UPDATE asset_versions SET subject_digest = ? WHERE asset_version_id = ?")
    .run(digest, content.asset_version_id);
  const record = repository.getVersionById(content.asset_version_id);
  if (record === null) throw new Error("frozen record missing");
  return record;
}

export function contributionPayload() {
  const source = bootstrapFixture.asset_version;
  return {
    slug: "synthetic-governance-contribution",
    actor_name: "Casey Contributor",
    content: {
      version: "0.1.0",
      name: "Synthetic Governance Contribution",
      summary: source.summary,
      owner: "Casey Contributor",
      asset_type: source.asset_type,
      execution_kind: "none",
      description: source.description,
      audiences: source.audiences,
      domains: source.domains,
      capabilities: source.capabilities,
      use_cases: source.use_cases,
      input_schema: source.input_schema,
      output_schema: source.output_schema,
      limitations: source.limitations,
      usage_instructions: source.usage_instructions,
      setup_expectations: source.setup_expectations,
      maintenance_expectations: source.maintenance_expectations,
      test_scenarios: [],
      availability: "reference_only",
      source_class: "created_during_event",
      source_reference: "Synthetic event-created test contribution",
      license_id: null,
      attribution: null,
      permission_evidence_id: null,
      access_permission: "not_applicable",
      tool_use_permission: "not_applicable",
      final_package_permission: "not_applicable",
    },
  } as const;
}

export function transitionToReview(service: GovernanceService, id: string): void {
  service.transition(id, {
    to_state: "submitted",
    actor_type: "team_member",
    actor_name: "Casey Contributor",
    reason: "Metadata is ready for review.",
  });
  service.transition(id, {
    to_state: "in_review",
    actor_type: "demo_reviewer",
    actor_name: "Riley Reviewer",
    reason: "Starting explicit human review.",
  });
}

export function recordReferencePublicationEvidence(
  service: GovernanceService,
  id: string,
  reviewer = "Riley Reviewer",
): void {
  service.runMetadataValidation(id);
  service.recordDemoReview(id, {
    review_type: "source_permission",
    result: "not_applicable",
    reviewer_name: "Morgan Source Reviewer",
    reviewer_role: "Source reviewer",
    scope: "Source permission is not applicable for synthetic event-created material.",
    summary: "Not applicable: the version contains only synthetic event-created material.",
  });
  service.recordDemoReview(id, {
    review_type: "human_review",
    result: "passed",
    reviewer_name: reviewer,
    reviewer_role: "Prepublication reviewer",
    scope: "Prepublication review of metadata, limitations, and intended use.",
    summary: "The exact frozen reference-only version passed human review.",
  });
}

export function insertExecution(
  database: MarketplaceDatabase,
  record: AssetVersionRecord,
  executionId: string,
  status: "succeeded" | "blocked",
): ExecutionRecord {
  const executions = new ExecutionRepository(database);
  const base: ExecutionRecord = ExecutionRecordSchema.parse({
    execution_id: executionId,
    asset_id: record.asset.asset_id,
    asset_version_id: record.asset_version.asset_version_id,
    asset_version: record.asset_version.version,
    executor_key: record.asset_version.executor_key,
    definition_digest: record.asset_version.definition_digest,
    purpose: "prepublication_test",
    scenario_label: status === "succeeded" ? "Typical synthetic scenario" : "Guardrail rejection",
    status: "pending",
    validated_input: { synthetic: true },
    validation_results: [
      { stage: "input", valid: true, code: "schema_valid", message: "Synthetic input accepted." },
      { stage: "policy", valid: true, code: "policy_allowed", message: "Prepublication policy evaluated." },
    ],
    execution_mode: "deterministic",
    model_or_config: {
      provider: "local",
      configuration_digest: `sha256:${"3".repeat(64)}`,
    },
    started_at: "2026-09-16T12:10:00Z",
    completed_at: null,
  });
  executions.insert(base);
  const terminal = ExecutionRecordSchema.parse(
    status === "succeeded"
      ? {
          ...base,
          status,
          output: { result: "safe synthetic output" },
          validation_results: [
            ...base.validation_results,
            { stage: "output", valid: true, code: "schema_valid", message: "Synthetic output accepted." },
          ],
          completed_at: "2026-09-16T12:10:01Z",
        }
      : {
          ...base,
          status,
          rejection_reason: "The representative unsafe request was blocked.",
          validation_results: [
            ...base.validation_results,
            { stage: "policy", valid: false, code: "guardrail_blocked", message: "Unsafe request blocked." },
          ],
          completed_at: "2026-09-16T12:10:01Z",
        },
  );
  return executions.update(terminal);
}

export function evidenceForExecution(
  record: AssetVersionRecord,
  type: "functional_test" | "guardrail_test" | "reuse_test",
  executionIds: string[],
  result: EvidenceResult = "passed",
  idSuffix: string = type,
): Evidence {
  if (record.asset_version.subject_digest === null) throw new Error("digest missing");
  return EvidenceSchema.parse({
    evidence_id: `evidence_governance_${idSuffix}`,
    asset_id: record.asset.asset_id,
    asset_version_id: record.asset_version.asset_version_id,
    subject_digest: record.asset_version.subject_digest,
    evidence_type: type as EvidenceType,
    scope: type === "functional_test" ? "Typical prepublication functional behavior." : "Relevant prepublication failure and guardrail behavior.",
    expected: { pass: true },
    observed: { pass: result === "passed" },
    result,
    actor_type: "system",
    timestamp: `2026-09-16T12:${type === "functional_test" ? "20" : "21"}:00Z`,
    method: "Persisted prepublication execution evidence.",
    scenario: type === "functional_test" ? "Typical synthetic scenario" : "Guardrail rejection",
    execution_ids: executionIds,
    artifact_version: record.asset_version.version,
    details: {
      summary: `${type.replaceAll("_", " ")} ${result}.`,
      assertions: [
        { name: `${type} expected outcome`, passed: result === "passed", observed: result },
      ],
      data: { persisted_execution_provenance: true },
    },
    limitations: ["Synthetic prepublication test."],
  });
}
