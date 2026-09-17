import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AssetVersionContentSchema,
  AssetVersionSchema,
  EvidenceSchema,
  type Evidence,
  type ExecutionRecord,
  type JSONObject,
  type TestScenario,
} from "@/contracts";
import { ExecutionRepository } from "@/modules/execution/repository";
import { buildPersistedReuseComparison } from "@/modules/execution/reuse-comparison";
import { computeSubjectDigest } from "@/shared/integrity";
import {
  DATA_DIRECTORY,
  closeDatabase,
  getBootstrapRecord,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";

const DEFINITION_DIGEST = `sha256:${"b".repeat(64)}`;
const CONFIGURATION_DIGEST = `sha256:${"c".repeat(64)}`;

const runnableVersionValue = {
  ...getBootstrapRecord().asset_version,
  execution_kind: "deterministic",
  availability: "runnable",
  executor_key: "property_ops.brief",
  definition_digest: DEFINITION_DIGEST,
};
const {
  lifecycle: _lifecycle,
  subject_digest: _subjectDigest,
  published_at: _publishedAt,
  deprecated_at: _deprecatedAt,
  replacement_version: _replacementVersion,
  ...runnableContentValue
} = runnableVersionValue;
const SUBJECT_DIGEST = computeSubjectDigest(
  AssetVersionContentSchema.parse(runnableContentValue),
);
const selectedVersion = AssetVersionSchema.parse({
  ...runnableVersionValue,
  subject_digest: SUBJECT_DIGEST,
});

function succeededExecution(
  executionId: string,
  scenario: TestScenario,
  startedAt: string,
): ExecutionRecord {
  const fixture = scenario.input_fixture as {
    brief_title: string;
    audience: string;
    observations: string[];
    constraints?: string[];
  };
  const constraints = fixture.constraints ?? [];

  return {
    execution_id: executionId,
    asset_id: selectedVersion.asset_id,
    asset_version_id: selectedVersion.asset_version_id,
    asset_version: selectedVersion.version,
    executor_key: selectedVersion.executor_key,
    definition_digest: selectedVersion.definition_digest,
    purpose: "prepublication_test",
    scenario_label: scenario.label,
    status: "succeeded",
    validated_input: scenario.input_fixture,
    output: {
      title: fixture.brief_title,
      summary: [...fixture.observations],
      review_questions: [
        `Has a knowledgeable human verified every supplied observation and constraint for ${fixture.audience}?`,
        ...fixture.observations.map(
          (observation) =>
            `What source should a human verify for this supplied observation: ${observation}`,
        ),
        ...constraints.map(
          (constraint) =>
            `What must the human reviewer confirm to honor this supplied constraint exactly: ${constraint}`,
        ),
      ],
      limitations: [
        "This brief uses only supplied synthetic observations and does not establish production facts.",
        "A knowledgeable human must verify every observation, constraint, and resulting brief before use.",
        "This executor does not make or automate resident, employee, vendor, legal, financial, or production decisions or actions.",
      ],
    },
    validation_results: [
      {
        stage: "input",
        valid: true,
        code: "schema_valid",
        message: "Input matched the canonical schema.",
      },
      {
        stage: "policy",
        valid: true,
        code: "policy_allowed",
        message: "Input passed the execution policy.",
      },
      {
        stage: "definition_digest",
        valid: true,
        code: "definition_digest_verified",
        message: "Registered artifacts matched the selected version.",
      },
      {
        stage: "output",
        valid: true,
        code: "schema_valid",
        message: "Output matched the canonical schema.",
      },
    ],
    execution_mode: "deterministic",
    model_or_config: {
      provider: "local",
      configuration_digest: CONFIGURATION_DIGEST,
    },
    started_at: startedAt,
    completed_at: startedAt.replace("00Z", "01Z"),
  };
}

function reuseEvidence(
  executionIds: string[],
  overrides: Partial<Evidence> = {},
): Evidence {
  return EvidenceSchema.parse({
    evidence_id: "evidence_property_ops_reuse",
    asset_id: selectedVersion.asset_id,
    asset_version_id: selectedVersion.asset_version_id,
    subject_digest: SUBJECT_DIGEST,
    evidence_type: "reuse_test",
    scope: "Two materially different synthetic scenarios through one frozen core.",
    expected: { unchanged_core: true },
    observed: { unchanged_core: true },
    result: "passed",
    actor_type: "system",
    timestamp: "2026-09-16T10:05:00Z",
    method: "Compared two persisted successful execution records.",
    scenario: "Maintenance backlog and energy variance",
    execution_ids: executionIds,
    artifact_reference: "reviewed executor manifest",
    artifact_version: selectedVersion.version,
    details: {
      summary: "Both runs used the same frozen executor definition.",
      assertions: [
        {
          name: "unchanged core",
          passed: true,
          observed: "Executor key and definition digest were identical.",
        },
      ],
      data: { materially_different_scenarios: true },
    },
    limitations: ["Automated reuse evidence is not human security review."],
    ...overrides,
  });
}

function persistExecution(
  repository: ExecutionRepository,
  record: ExecutionRecord,
): void {
  if (["pending", "invalid", "blocked"].includes(record.status)) {
    repository.insert(record);
    return;
  }
  const pending = {
    ...record,
    status: "pending" as const,
    output: undefined,
    error: undefined,
    completed_at: null,
    validation_results: record.validation_results.filter(
      (result) => result.stage !== "output",
    ),
  };
  repository.insert(pending);
  repository.update(record);
}

describe("persisted reuse comparison", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let repository: ExecutionRepository;
  let scenarioA: ExecutionRecord;
  let scenarioB: ExecutionRecord;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `reuse-comparison-${process.pid}-${Date.now()}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    migrateDatabase(database);
    seedDatabase(database);
    repository = new ExecutionRepository(database);

    scenarioA = succeededExecution(
      "execution_reuse_scenario_a",
      selectedVersion.test_scenarios[0],
      "2026-09-16T10:00:00Z",
    );
    scenarioB = succeededExecution(
      "execution_reuse_scenario_b",
      selectedVersion.test_scenarios[1],
      "2026-09-16T10:01:00Z",
    );
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  function insertScenarioPair(): Evidence {
    persistExecution(repository, scenarioA);
    persistExecution(repository, scenarioB);
    return reuseEvidence([scenarioA.execution_id, scenarioB.execution_id]);
  }

  it("derives a compact unchanged-core comparison from two persisted runs", () => {
    const evidence = insertScenarioPair();

    const comparison = buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: evidence,
    });

    expect(comparison).toEqual({
      available: true,
      evidence_id: evidence.evidence_id,
      subject_digest: SUBJECT_DIGEST,
      shared: {
        asset_id: selectedVersion.asset_id,
        asset_version_id: selectedVersion.asset_version_id,
        asset_version: selectedVersion.version,
        executor_key: "property_ops.brief",
        definition_digest: DEFINITION_DIGEST,
        configuration_digest: CONFIGURATION_DIGEST,
        execution_purpose: "prepublication_test",
      },
      scenarios: [
        {
          execution_id: scenarioA.execution_id,
          scenario_label: scenarioA.scenario_label,
          status: "succeeded",
          started_at: scenarioA.started_at,
          completed_at: scenarioA.completed_at,
        },
        {
          execution_id: scenarioB.execution_id,
          scenario_label: scenarioB.scenario_label,
          status: "succeeded",
          started_at: scenarioB.started_at,
          completed_at: scenarioB.completed_at,
        },
      ],
      core_implementation_unchanged: true,
      statement:
        "Core implementation unchanged: both persisted runs use the same executor key and definition digest.",
    });
  });

  it("suppresses stale, non-passing, and duplicate-ID evidence", () => {
    const evidence = insertScenarioPair();

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: { ...evidence, subject_digest: `sha256:${"f".repeat(64)}` },
    })).toEqual({ available: false, reason: "evidence_not_current_subject" });

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: { ...evidence, result: "failed" },
    })).toEqual({ available: false, reason: "evidence_not_passing_reuse_proof" });

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: {
        ...evidence,
        execution_ids: [scenarioA.execution_id, scenarioA.execution_id],
      },
    })).toEqual({
      available: false,
      reason: "requires_exactly_two_distinct_executions",
    });
  });

  it("suppresses a selected version whose stored subject digest is not canonical", () => {
    const evidence = insertScenarioPair();
    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion: {
        ...selectedVersion,
        subject_digest: `sha256:${"f".repeat(64)}`,
      },
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "selected_version_subject_digest_mismatch",
    });
  });

  it("suppresses a missing, failed, or provenance-mismatched execution", () => {
    persistExecution(repository, scenarioA);
    const missingEvidence = reuseEvidence([
      scenarioA.execution_id,
      scenarioB.execution_id,
    ]);
    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: missingEvidence,
    })).toEqual({ available: false, reason: "execution_records_unavailable" });

    const failedB: ExecutionRecord = {
      ...scenarioB,
      status: "failed",
      output: undefined,
      error: {
        code: "executor_failure",
        message: "Safe execution failure.",
        retryable: false,
      },
    };
    persistExecution(repository, failedB);
    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: missingEvidence,
    })).toEqual({ available: false, reason: "execution_not_succeeded" });
  });

  it("suppresses definition drift and incomplete validation", () => {
    persistExecution(repository, scenarioA);
    persistExecution(repository, {
      ...scenarioB,
      definition_digest: `sha256:${"e".repeat(64)}`,
    });
    const evidence = reuseEvidence([
      scenarioA.execution_id,
      scenarioB.execution_id,
    ]);
    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({ available: false, reason: "execution_provenance_mismatch" });

    const alternateRepository = {
      listByIds: () => [
        scenarioA,
        {
          ...scenarioB,
          validation_results: scenarioB.validation_results.filter(
            (result) => result.stage !== "policy",
          ),
        },
      ],
    };
    expect(buildPersistedReuseComparison({
      repository: alternateRepository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_validation_incomplete",
    });
  });

  it("rejects records that do not bind to the exact canonical scenario label and input", () => {
    const mismatchedScenarioA: ExecutionRecord = {
      ...scenarioA,
      scenario_label: "A request-supplied lookalike scenario",
    };
    persistExecution(repository, mismatchedScenarioA);
    persistExecution(repository, scenarioB);
    const evidence = reuseEvidence([
      mismatchedScenarioA.execution_id,
      scenarioB.execution_id,
    ]);

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_scenario_mismatch",
    });

    const inputMismatchRepository = {
      listByIds: () => [
        scenarioA,
        {
          ...scenarioB,
          validated_input: {
            ...(scenarioB.validated_input as JSONObject),
            brief_title: "Request-supplied input",
          },
        },
      ],
    };
    expect(buildPersistedReuseComparison({
      repository: inputMismatchRepository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_scenario_mismatch",
    });
  });

  it("rejects a user run even when its other provenance matches", () => {
    persistExecution(repository, scenarioA);
    persistExecution(repository, { ...scenarioB, purpose: "user_run" });
    const evidence = reuseEvidence([
      scenarioA.execution_id,
      scenarioB.execution_id,
    ]);

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_provenance_mismatch",
    });
  });

  it("rejects missing or different reviewed executor configuration", () => {
    const evidence = reuseEvidence([
      scenarioA.execution_id,
      scenarioB.execution_id,
    ]);
    const configurationMismatchRepository = {
      listByIds: () => [
        scenarioA,
        {
          ...scenarioB,
          model_or_config: {
            provider: "local",
            configuration_digest: `sha256:${"d".repeat(64)}`,
          },
        },
      ],
    };

    expect(buildPersistedReuseComparison({
      repository: configurationMismatchRepository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_configuration_mismatch",
    });

    const missingConfigurationRepository = {
      listByIds: () => [
        scenarioA,
        { ...scenarioB, model_or_config: undefined },
      ],
    };
    expect(buildPersistedReuseComparison({
      repository: missingConfigurationRepository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_configuration_mismatch",
    });
  });

  it("independently rejects schema-valid output that fails functional assertions", () => {
    persistExecution(repository, scenarioA);
    persistExecution(repository, {
      ...scenarioB,
      output: {
        ...(scenarioB.output as JSONObject),
        review_questions: ["Can a human review this?"],
      },
    });
    const evidence = reuseEvidence([
      scenarioA.execution_id,
      scenarioB.execution_id,
    ]);

    expect(buildPersistedReuseComparison({
      repository,
      selectedVersion,
      reuseEvidence: evidence,
    })).toEqual({
      available: false,
      reason: "execution_functional_assertions_incomplete",
    });
  });
});
