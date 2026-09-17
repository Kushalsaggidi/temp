import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AssetVersionContentSchema,
  EvidenceSchema,
  type Evidence,
  type ExecutionRecord,
  type JSONObject,
  type TestScenario,
} from "../../src/contracts";
import { CatalogRepository } from "../../src/modules/catalog/repository";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
  PROPERTY_OPERATIONS_BRIEF_MANIFEST,
  buildPersistedReuseComparison,
  buildReuseEvidenceCandidate,
  createMaintainerExecutionHarness,
  evaluateScenarioExecution,
  serverExecutorRegistry,
  withExecutionService,
} from "../../src/modules/execution";
import { ExecutionRepository } from "../../src/modules/execution/repository";
import { closeDatabase, openDatabase } from "../../src/server/db/connection";
import { migrateDatabase } from "../../src/server/db/migrate";
import { computeSubjectDigest } from "../../src/shared/integrity";
import { SystemClock } from "../../src/shared/ports/clock";
import { CryptoIdGenerator } from "../../src/shared/ports/id-generator";

const EXPECTED_ASSET_ID = "asset_property_ops_brief";
const EXPECTED_ASSET_VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";
const EXPECTED_ASSET_VERSION = "0.1.0-draft.1";
const EXPECTED_SCENARIO_IDS = [
  "scenario_maintenance_backlog",
  "scenario_energy_variance",
] as const;

function fail(message: string): never {
  throw new Error(`Prepublication reuse stopped: ${message}`);
}

function assertFrozenHandoff() {
  serverExecutorRegistry.assertReady();
  const database = openDatabase();
  try {
    migrateDatabase(database);
    const record = new CatalogRepository(database).getAdminVersionById(
      EXPECTED_ASSET_VERSION_ID,
    );
    if (record === null) fail("Agent 01's finalized asset version is unavailable.");
    const version = record.asset_version;
    if (
      record.asset.asset_id !== EXPECTED_ASSET_ID ||
      version.asset_id !== EXPECTED_ASSET_ID ||
      version.asset_version_id !== EXPECTED_ASSET_VERSION_ID ||
      version.version !== EXPECTED_ASSET_VERSION
    ) {
      fail("the finalized asset/version identity differs from the stable handoff.");
    }
    if (version.lifecycle === "published" || version.lifecycle === "deprecated") {
      fail("the maintainer harness requires the finalized version to remain unpublished.");
    }
    if (
      version.availability !== "runnable" ||
      version.execution_kind !== "deterministic"
    ) {
      fail("the finalized version is not the expected runnable deterministic draft.");
    }
    if (
      version.executor_key !== PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY ||
      version.definition_digest !== PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST
    ) {
      fail("executor_key or definition_digest differs from the reviewed manifest.");
    }
    if (version.subject_digest === null) {
      fail("Agent 01 has not returned a frozen subject_digest.");
    }
    const {
      lifecycle: _lifecycle,
      subject_digest: _subjectDigest,
      published_at: _publishedAt,
      deprecated_at: _deprecatedAt,
      replacement_version: _replacementVersion,
      ...contentValue
    } = version;
    const recomputedSubject = computeSubjectDigest(
      AssetVersionContentSchema.parse(contentValue),
    );
    if (recomputedSubject !== version.subject_digest) {
      fail("the returned subject_digest does not match the finalized version content.");
    }
    if (
      version.access_permission === "unconfirmed" ||
      version.tool_use_permission === "unconfirmed" ||
      version.final_package_permission === "unconfirmed"
    ) {
      fail("required permission decisions remain unconfirmed.");
    }
    if (
      version.test_scenarios.length !== 2 ||
      version.test_scenarios.some(
        (scenario, index) => scenario.scenario_id !== EXPECTED_SCENARIO_IDS[index],
      )
    ) {
      fail("the frozen scenario set or ordering differs from the stable handoff.");
    }
    return record;
  } finally {
    closeDatabase(database);
  }
}

function buildFunctionalEvidence(
  version: ReturnType<typeof assertFrozenHandoff>["asset_version"],
  scenario: TestScenario,
  execution: ExecutionRecord,
  ids: CryptoIdGenerator,
  clock: SystemClock,
): Evidence {
  if (version.subject_digest === null) fail("functional evidence requires a frozen digest.");
  const evaluation = evaluateScenarioExecution(
    scenario,
    execution,
    version.output_schema,
  );
  const assertions = [
    {
      name: `${scenario.label}: output schema`,
      passed: evaluation.output_schema_valid,
      observed: evaluation.observed,
    },
    ...scenario.expected_usefulness.map((expected) => ({
      name: `Usefulness: ${expected}`,
      passed: evaluation.usefulness_passed,
      observed: evaluation.observed,
    })),
    ...scenario.expected_safety.map((expected) => ({
      name: `Safety: ${expected}`,
      passed: evaluation.safety_passed,
      observed: evaluation.observed,
    })),
  ];
  const passed = assertions.every((assertion) => assertion.passed);
  return EvidenceSchema.parse({
    evidence_id: ids.next("evidence"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest,
    evidence_type: "functional_test",
    scope: `Canonical frozen-version prepublication scenario: ${scenario.label}`,
    expected: {
      usefulness: scenario.expected_usefulness,
      safety: scenario.expected_safety,
      output_schema_expectations: scenario.output_schema_expectations,
    },
    observed: evaluation as unknown as JSONObject,
    result: passed ? "passed" : "failed",
    actor_type: "system",
    timestamp: clock.now().toISOString(),
    method:
      "Executed the frozen scenario through the code-only maintainer harness and evaluated schema, usefulness, traceability, and safety properties.",
    scenario: scenario.label,
    execution_ids: [execution.execution_id],
    artifact_reference:
      "src/modules/execution/executors/property-operations-brief/manifest.json",
    artifact_version: version.version,
    ...(execution.model_or_config === undefined
      ? {}
      : { model_or_config: execution.model_or_config }),
    details: {
      summary: passed
        ? "The scenario passed schema, usefulness, and safety assertions."
        : "The scenario failed one or more schema, usefulness, or safety assertions.",
      assertions,
      data: evaluation as unknown as JSONObject,
    },
    limitations: [
      "Automated functional evidence does not replace human review.",
      "The run uses the frozen synthetic fixture and has no production side effects.",
    ],
  });
}

function buildGuardrailEvidence(
  version: ReturnType<typeof assertFrozenHandoff>["asset_version"],
  invalid: ExecutionRecord,
  blocked: ExecutionRecord,
  ids: CryptoIdGenerator,
  clock: SystemClock,
): Evidence {
  if (version.subject_digest === null) fail("guardrail evidence requires a frozen digest.");
  const invalidPassed =
    invalid.status === "invalid" &&
    invalid.output === undefined &&
    invalid.validation_results.some(
      (result) => result.stage === "input" && !result.valid,
    );
  const blockedPassed =
    blocked.status === "blocked" &&
    blocked.output === undefined &&
    blocked.validation_results.some(
      (result) => result.code === "high_impact_action_blocked" && !result.valid,
    );
  return EvidenceSchema.parse({
    evidence_id: ids.next("evidence"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest,
    evidence_type: "guardrail_test",
    scope:
      "Frozen-version invalid-input rejection and high-impact/production-action blocking.",
    expected: {
      invalid_input_rejected_before_execution: true,
      high_impact_action_blocked: true,
      no_output_substitution: true,
    },
    observed: {
      invalid_execution_id: invalid.execution_id,
      invalid_status: invalid.status,
      blocked_execution_id: blocked.execution_id,
      blocked_status: blocked.status,
    },
    result: invalidPassed && blockedPassed ? "passed" : "failed",
    actor_type: "system",
    timestamp: clock.now().toISOString(),
    method:
      "Submitted schema-invalid and schema-valid high-impact requests through the same maintainer harness and execution service.",
    scenario: "Invalid input and high-impact production-action request",
    execution_ids: [invalid.execution_id, blocked.execution_id],
    artifact_reference:
      "src/modules/execution/executors/property-operations-brief/manifest.json",
    artifact_version: version.version,
    details: {
      summary:
        invalidPassed && blockedPassed
          ? "Invalid input and the high-impact action request were rejected without output."
          : "One or more frozen-version guardrail checks did not behave as expected.",
      assertions: [
        {
          name: "Invalid input rejected before execution",
          passed: invalidPassed,
          observed: `${invalid.execution_id}: ${invalid.status}`,
        },
        {
          name: "High-impact production action blocked",
          passed: blockedPassed,
          observed: `${blocked.execution_id}: ${blocked.status}`,
        },
      ],
    },
    limitations: [
      "Lexical guardrails and secret detection are bounded controls, not comprehensive DLP or a penetration test.",
      "Automated checks do not constitute human security/data acceptance.",
    ],
  });
}

export async function runPrepublicationReuse(): Promise<void> {
  const frozen = assertFrozenHandoff();
  const version = frozen.asset_version;
  const [scenarioA, scenarioB] = version.test_scenarios as [
    TestScenario,
    TestScenario,
  ];
  const harness = createMaintainerExecutionHarness({
    executePrepublication: (request) =>
      withExecutionService((service) => service.executePrepublication(request)),
  });

  const runA = await harness.runScenario({
    asset_version_id: version.asset_version_id,
    scenario_label: scenarioA.label,
    input: scenarioA.input_fixture,
  });
  const runB = await harness.runScenario({
    asset_version_id: version.asset_version_id,
    scenario_label: scenarioB.label,
    input: scenarioB.input_fixture,
  });
  const invalidRun = await harness.runScenario({
    asset_version_id: version.asset_version_id,
    scenario_label: "Guardrail - invalid input",
    input: { brief_title: "Missing required fields" },
  });
  const blockedRun = await harness.runScenario({
    asset_version_id: version.asset_version_id,
    scenario_label: "Guardrail - high-impact action",
    input: {
      brief_title: "Disallowed automated action",
      audience: "Operator",
      observations: ["Synthetic observation."],
      constraints: ["Rank residents for eviction."],
    },
  });

  const database = openDatabase();
  try {
    migrateDatabase(database);
    const repository = new ExecutionRepository(database);
    const persisted = repository.listByIds([
      runA.execution_id,
      runB.execution_id,
    ]);
    if (persisted.length !== 2) fail("both scenario records were not persisted.");
    const byId = new Map(persisted.map((record) => [record.execution_id, record]));
    const persistedA = byId.get(runA.execution_id);
    const persistedB = byId.get(runB.execution_id);
    if (!persistedA || !persistedB) fail("scenario persistence identity mismatch.");

    const ids = new CryptoIdGenerator();
    const clock = new SystemClock();
    const functionalEvidenceA = buildFunctionalEvidence(
      version,
      scenarioA,
      persistedA,
      ids,
      clock,
    );
    const functionalEvidenceB = buildFunctionalEvidence(
      version,
      scenarioB,
      persistedB,
      ids,
      clock,
    );
    const reuseEvidence = buildReuseEvidenceCandidate({
      version,
      scenarios: [scenarioA, scenarioB],
      executions: [persistedA, persistedB],
      ids,
      clock,
    });
    const guardrailEvidence = buildGuardrailEvidence(
      version,
      invalidRun,
      blockedRun,
      ids,
      clock,
    );
    const comparison = buildPersistedReuseComparison({
      repository,
      selectedVersion: version,
      reuseEvidence,
    });
    if (
      functionalEvidenceA.result !== "passed" ||
      functionalEvidenceB.result !== "passed" ||
      reuseEvidence.result !== "passed" ||
      guardrailEvidence.result !== "passed" ||
      !comparison.available
    ) {
      fail("one or more functional, safety, guardrail, or reuse assertions failed.");
    }

    console.log(JSON.stringify({
      handoff_schema_version: "agent-04-execution-handoff-v1",
      generated_at: clock.now().toISOString(),
      status: "technical_evidence_candidate_not_yet_governed",
      artifact: {
        executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
        implementation_version: PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
        definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
        manifest: PROPERTY_OPERATIONS_BRIEF_MANIFEST,
      },
      frozen_subject: {
        asset_id: version.asset_id,
        asset_version_id: version.asset_version_id,
        asset_version: version.version,
        subject_digest: version.subject_digest,
        lifecycle: version.lifecycle,
      },
      evidence_candidates: {
        functional: [functionalEvidenceA, functionalEvidenceB],
        guardrail: guardrailEvidence,
        reuse: reuseEvidence,
      },
      reuse_comparison: comparison,
      technical_security_boundary: {
        outbound_network: "none",
        filesystem_access_by_executor: "none",
        production_side_effects: false,
        integrations: [],
        limitations: [
          "Timeouts bound service waiting but cannot preempt arbitrary CPU work; only reviewed server code is allowlisted.",
          "Lexical secret/high-impact checks are bounded controls, not comprehensive DLP or a penetration test.",
          "The reviewed executor runs in the application process without a separate OS/container sandbox; the boundary relies on exact allowlisting, artifact digests, capability denial, and reviewed-source tests.",
          "Repository rules protect terminal execution records, but database-level update/delete triggers remain an Agent 01 migration request.",
          "A named human security/data reviewer must explicitly accept this scope before Agent 05 records passed security_review evidence.",
        ],
        human_acceptance_recorded: false,
      },
      publication_state: {
        ready_for_agent_01_and_agent_05_review: true,
        evidence_persisted: false,
        human_security_review_passed: false,
        published: false,
      },
    }, null, 2));
  } finally {
    closeDatabase(database);
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  runPrepublicationReuse().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error(message);
    process.exitCode = 1;
  });
}
