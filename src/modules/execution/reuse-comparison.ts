import { isDeepStrictEqual } from "node:util";

import {
  AssetVersionContentSchema,
  AssetVersionSchema,
  EvidenceSchema,
  type AssetVersion,
  type Evidence,
  type ExecutionRecord,
} from "../../contracts";
import { computeSubjectDigest } from "../../shared/integrity";
import { evaluateScenarioExecution } from "./reuse-evidence";

export interface ExecutionRecordReader {
  listByIds(executionIds: readonly string[]): ExecutionRecord[];
}

export interface ReuseComparisonScenario {
  execution_id: string;
  scenario_label: string;
  status: "succeeded";
  started_at: string;
  completed_at: string;
}

export interface AvailableReuseComparison {
  available: true;
  evidence_id: string;
  subject_digest: string;
  shared: {
    asset_id: string;
    asset_version_id: string;
    asset_version: string;
    executor_key: string;
    definition_digest: string;
    configuration_digest: string;
    execution_purpose: ExecutionRecord["purpose"];
  };
  scenarios: [ReuseComparisonScenario, ReuseComparisonScenario];
  core_implementation_unchanged: true;
  statement: string;
}

export interface UnavailableReuseComparison {
  available: false;
  reason:
    | "invalid_selected_version"
    | "invalid_reuse_evidence"
    | "selected_version_not_frozen_runnable"
    | "selected_version_subject_digest_mismatch"
    | "evidence_not_passing_reuse_proof"
    | "evidence_not_current_subject"
    | "requires_exactly_two_distinct_executions"
    | "execution_records_unavailable"
    | "execution_not_succeeded"
    | "execution_provenance_mismatch"
    | "execution_validation_incomplete"
    | "execution_scenario_mismatch"
    | "execution_configuration_mismatch"
    | "execution_functional_assertions_incomplete"
    | "scenarios_not_distinct";
}

export type ReuseComparison =
  | AvailableReuseComparison
  | UnavailableReuseComparison;

export interface PersistedReuseComparisonInput {
  repository: ExecutionRecordReader;
  selectedVersion: unknown;
  reuseEvidence: unknown;
}

const unavailable = (
  reason: UnavailableReuseComparison["reason"],
): UnavailableReuseComparison => ({ available: false, reason });

function isCurrentPassingReuseEvidence(
  selectedVersion: AssetVersion,
  evidence: Evidence,
): boolean {
  return (
    evidence.evidence_type === "reuse_test" &&
    evidence.result === "passed" &&
    evidence.asset_id === selectedVersion.asset_id &&
    evidence.asset_version_id === selectedVersion.asset_version_id &&
    evidence.subject_digest === selectedVersion.subject_digest &&
    evidence.artifact_version === selectedVersion.version &&
    evidence.details.assertions.length > 0 &&
    evidence.details.assertions.every((assertion) => assertion.passed)
  );
}

function hasCompleteSuccessfulValidation(record: ExecutionRecord): boolean {
  const requiredStages = new Set([
    "input",
    "output",
    "policy",
    "definition_digest",
  ] as const);

  if (record.validation_results.some((result) => !result.valid)) {
    return false;
  }
  for (const result of record.validation_results) {
    if (result.valid) {
      requiredStages.delete(result.stage);
    }
  }
  return requiredStages.size === 0;
}

/**
 * Builds reviewer-visible reuse proof only from records fetched through the
 * persistence boundary. Any stale evidence, missing run, or provenance drift
 * suppresses the comparison rather than presenting a partial success claim.
 */
export function buildPersistedReuseComparison({
  repository,
  selectedVersion: selectedVersionValue,
  reuseEvidence: reuseEvidenceValue,
}: PersistedReuseComparisonInput): ReuseComparison {
  const selectedVersionResult = AssetVersionSchema.safeParse(selectedVersionValue);
  if (!selectedVersionResult.success) {
    return unavailable("invalid_selected_version");
  }
  const selectedVersion = selectedVersionResult.data;
  if (
    selectedVersion.availability !== "runnable" ||
    selectedVersion.subject_digest === null ||
    selectedVersion.executor_key === undefined ||
    selectedVersion.definition_digest === undefined ||
    selectedVersion.execution_kind === "none"
  ) {
    return unavailable("selected_version_not_frozen_runnable");
  }
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...contentValue
  } = selectedVersion;
  const content = AssetVersionContentSchema.parse(contentValue);
  if (computeSubjectDigest(content) !== selectedVersion.subject_digest) {
    return unavailable("selected_version_subject_digest_mismatch");
  }

  const evidenceResult = EvidenceSchema.safeParse(reuseEvidenceValue);
  if (!evidenceResult.success) {
    return unavailable("invalid_reuse_evidence");
  }
  const evidence = evidenceResult.data;
  if (
    evidence.evidence_type !== "reuse_test" ||
    evidence.result !== "passed" ||
    evidence.details.assertions.length === 0 ||
    evidence.details.assertions.some((assertion) => !assertion.passed)
  ) {
    return unavailable("evidence_not_passing_reuse_proof");
  }
  if (!isCurrentPassingReuseEvidence(selectedVersion, evidence)) {
    return unavailable("evidence_not_current_subject");
  }

  if (
    evidence.execution_ids.length !== 2 ||
    new Set(evidence.execution_ids).size !== 2
  ) {
    return unavailable("requires_exactly_two_distinct_executions");
  }

  let persistedRecords: ExecutionRecord[];
  try {
    persistedRecords = repository.listByIds(evidence.execution_ids);
  } catch {
    return unavailable("execution_records_unavailable");
  }
  if (
    persistedRecords.length !== 2 ||
    new Set(persistedRecords.map((record) => record.execution_id)).size !== 2
  ) {
    return unavailable("execution_records_unavailable");
  }

  const recordsById = new Map(
    persistedRecords.map((record) => [record.execution_id, record]),
  );
  const orderedRecords = evidence.execution_ids.map((executionId) =>
    recordsById.get(executionId),
  );
  if (orderedRecords.some((record) => record === undefined)) {
    return unavailable("execution_records_unavailable");
  }

  const evidenceOrderedRecords = orderedRecords as [ExecutionRecord, ExecutionRecord];
  if (evidenceOrderedRecords.some((record) => record.status !== "succeeded")) {
    return unavailable("execution_not_succeeded");
  }

  const canonicalScenarios = selectedVersion.test_scenarios;
  if (
    canonicalScenarios.length !== 2 ||
    new Set(canonicalScenarios.map((scenario) => scenario.scenario_id)).size !== 2 ||
    isDeepStrictEqual(
      canonicalScenarios[0]?.input_fixture,
      canonicalScenarios[1]?.input_fixture,
    )
  ) {
    return unavailable("scenarios_not_distinct");
  }
  const canonicalOrderedRecords = canonicalScenarios.map((scenario) =>
    evidenceOrderedRecords.find(
      (record) =>
        record.scenario_label === scenario.label &&
        isDeepStrictEqual(record.validated_input, scenario.input_fixture),
    ),
  );
  if (
    canonicalOrderedRecords.some((record) => record === undefined) ||
    new Set(canonicalOrderedRecords.map((record) => record?.execution_id)).size !== 2
  ) {
    return unavailable("execution_scenario_mismatch");
  }
  const records = canonicalOrderedRecords as [ExecutionRecord, ExecutionRecord];
  const expectedProvenance = {
    asset_id: selectedVersion.asset_id,
    asset_version_id: selectedVersion.asset_version_id,
    asset_version: selectedVersion.version,
    executor_key: selectedVersion.executor_key,
    definition_digest: selectedVersion.definition_digest,
    execution_mode: selectedVersion.execution_kind,
  };
  const provenanceMatches = records.every(
    (record) =>
      record.asset_id === expectedProvenance.asset_id &&
      record.asset_version_id === expectedProvenance.asset_version_id &&
      record.asset_version === expectedProvenance.asset_version &&
      record.executor_key === expectedProvenance.executor_key &&
      record.definition_digest === expectedProvenance.definition_digest &&
      record.execution_mode === expectedProvenance.execution_mode &&
      record.purpose === "prepublication_test",
  );
  if (!provenanceMatches) {
    return unavailable("execution_provenance_mismatch");
  }

  const firstConfiguration = records[0].model_or_config;
  const secondConfiguration = records[1].model_or_config;
  if (
    firstConfiguration === undefined ||
    secondConfiguration === undefined ||
    firstConfiguration.configuration_digest === undefined ||
    secondConfiguration.configuration_digest === undefined ||
    !isDeepStrictEqual(firstConfiguration, secondConfiguration)
  ) {
    return unavailable("execution_configuration_mismatch");
  }

  if (records.some((record) => !hasCompleteSuccessfulValidation(record))) {
    return unavailable("execution_validation_incomplete");
  }
  const scenarioEvaluations = canonicalScenarios.map((scenario, index) =>
    evaluateScenarioExecution(
      scenario,
      records[index],
      selectedVersion.output_schema,
    ),
  );
  if (
    scenarioEvaluations.some(
      (evaluation) =>
        !evaluation.output_schema_valid ||
        !evaluation.usefulness_passed ||
        !evaluation.safety_passed,
    )
  ) {
    return unavailable("execution_functional_assertions_incomplete");
  }

  return {
    available: true,
    evidence_id: evidence.evidence_id,
    subject_digest: evidence.subject_digest,
    shared: {
      asset_id: selectedVersion.asset_id,
      asset_version_id: selectedVersion.asset_version_id,
      asset_version: selectedVersion.version,
      executor_key: selectedVersion.executor_key,
      definition_digest: selectedVersion.definition_digest,
      configuration_digest: firstConfiguration.configuration_digest,
      execution_purpose: "prepublication_test",
    },
    scenarios: records.map((record) => ({
      execution_id: record.execution_id,
      scenario_label: record.scenario_label as string,
      status: "succeeded" as const,
      started_at: record.started_at,
      completed_at: record.completed_at as string,
    })) as [ReuseComparisonScenario, ReuseComparisonScenario],
    core_implementation_unchanged: true,
    statement:
      "Core implementation unchanged: both persisted runs use the same executor key and definition digest.",
  };
}
