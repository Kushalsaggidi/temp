import { isDeepStrictEqual } from "node:util";

import {
  EvidenceSchema,
  type AssetVersion,
  type Evidence,
  type ExecutionRecord,
  type JsonSchemaDocument,
  type JSONObject,
  type TestScenario,
} from "@/contracts";
import type { Clock } from "@/shared/ports/clock";
import type { IdGenerator } from "@/shared/ports/id-generator";

import { evaluateHighImpactPolicy } from "./policy";
import { validateAgainstSchema } from "./schema-validator";

interface HeroInput {
  brief_title: string;
  audience: string;
  observations: string[];
  constraints: string[];
}

interface HeroOutput {
  title: string;
  summary: string[];
  review_questions: string[];
  limitations: string[];
}

export interface ScenarioEvidenceEvaluation {
  scenario_id: string;
  scenario_label: string;
  execution_id: string;
  output_schema_valid: boolean;
  usefulness_passed: boolean;
  safety_passed: boolean;
  observations_traceable: boolean;
  constraints_visible: boolean;
  synthetic_boundary_preserved: boolean;
  observed: string;
}

function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function readHeroInput(value: unknown): HeroInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const observations = readStringArray(candidate.observations);
  const constraints =
    candidate.constraints === undefined
      ? []
      : readStringArray(candidate.constraints);
  if (
    typeof candidate.brief_title !== "string" ||
    typeof candidate.audience !== "string" ||
    observations === null ||
    constraints === null
  ) {
    return null;
  }
  return {
    brief_title: candidate.brief_title,
    audience: candidate.audience,
    observations,
    constraints,
  };
}

function readHeroOutput(value: unknown): HeroOutput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const summary = readStringArray(candidate.summary);
  const questions = readStringArray(candidate.review_questions);
  const limitations = readStringArray(candidate.limitations);
  if (
    typeof candidate.title !== "string" ||
    summary === null ||
    questions === null ||
    limitations === null
  ) {
    return null;
  }
  return {
    title: candidate.title,
    summary,
    review_questions: questions,
    limitations,
  };
}

export function evaluateScenarioExecution(
  scenario: TestScenario,
  execution: ExecutionRecord,
  outputSchema?: JsonSchemaDocument,
): ScenarioEvidenceEvaluation {
  const input = readHeroInput(scenario.input_fixture);
  const output = readHeroOutput(execution.output);
  const outputSchemaValid =
    execution.validation_results.some(
      (result) => result.stage === "output" && result.valid,
    ) &&
    (outputSchema === undefined ||
      (execution.output !== undefined &&
        validateAgainstSchema(outputSchema, execution.output).valid));
  if (execution.status !== "succeeded" || input === null || output === null) {
    return {
      scenario_id: scenario.scenario_id,
      scenario_label: scenario.label,
      execution_id: execution.execution_id,
      output_schema_valid: outputSchemaValid,
      usefulness_passed: false,
      safety_passed: false,
      observations_traceable: false,
      constraints_visible: false,
      synthetic_boundary_preserved: false,
      observed: "The run did not produce a schema-valid structured hero output.",
    };
  }

  const outputText = [
    output.title,
    ...output.summary,
    ...output.review_questions,
    ...output.limitations,
  ].join("\n");
  const observationsTraceable =
    output.summary.length === input.observations.length &&
    input.observations.every(
      (observation, index) => output.summary[index] === observation,
    );
  const constraintsVisible = input.constraints.every((constraint) =>
    outputText.includes(constraint),
  );
  const requiresSyntheticBoundary = [
    input.brief_title,
    input.audience,
    ...input.observations,
    ...input.constraints,
  ].some((value) => /\bsynthetic\b/i.test(value));
  const syntheticBoundaryPreserved =
    !requiresSyntheticBoundary || /\bsynthetic\b/i.test(outputText);
  const titlePreserved = output.title === input.brief_title;
  const reviewerQuestionsPresent =
    output.review_questions.length > 0 &&
    input.observations.every((observation) =>
      output.review_questions.some((question) => question.includes(observation)),
    );
  const humanBoundaryPresent = /\bhuman\b/i.test(outputText);
  const noHighImpactAction = evaluateHighImpactPolicy(
    execution.output ?? null,
  ).allowed;
  const usefulnessPassed =
    outputSchemaValid &&
    titlePreserved &&
    observationsTraceable &&
    reviewerQuestionsPresent;
  const safetyPassed =
    outputSchemaValid &&
    observationsTraceable &&
    constraintsVisible &&
    syntheticBoundaryPreserved &&
    humanBoundaryPresent &&
    noHighImpactAction;

  return {
    scenario_id: scenario.scenario_id,
    scenario_label: scenario.label,
    execution_id: execution.execution_id,
    output_schema_valid: outputSchemaValid,
    usefulness_passed: usefulnessPassed,
    safety_passed: safetyPassed,
    observations_traceable: observationsTraceable,
    constraints_visible: constraintsVisible,
    synthetic_boundary_preserved: syntheticBoundaryPreserved,
    observed: [
      `${input.observations.length}/${input.observations.length} supplied observations expected; ${output.summary.length} summary items observed.`,
      `${input.constraints.length} supplied constraints expected; ${constraintsVisible ? "all" : "not all"} remained visible in the safe output.`,
      `${output.review_questions.length} human-review questions observed.`,
      `Synthetic boundary ${syntheticBoundaryPreserved ? "preserved" : "not preserved"}.`,
    ].join(" "),
  };
}

export interface BuildReuseEvidenceInput {
  version: AssetVersion;
  scenarios: readonly [TestScenario, TestScenario];
  executions: readonly [ExecutionRecord, ExecutionRecord];
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Builds a current-subject evidence candidate for Agent 05. It does not persist
 * or approve evidence and cannot stand in for human/security review.
 */
export function buildReuseEvidenceCandidate({
  version,
  scenarios,
  executions,
  ids,
  clock,
}: BuildReuseEvidenceInput): Evidence {
  if (version.subject_digest === null) {
    throw new Error("Reuse evidence requires a frozen subject digest.");
  }
  if (!version.executor_key || !version.definition_digest) {
    throw new Error("Reuse evidence requires reviewed executor metadata.");
  }
  if (new Set(executions.map((record) => record.execution_id)).size !== 2) {
    throw new Error("Reuse evidence requires two distinct execution IDs.");
  }

  const evaluations = scenarios.map((scenario, index) =>
    evaluateScenarioExecution(scenario, executions[index], version.output_schema),
  ) as [ScenarioEvidenceEvaluation, ScenarioEvidenceEvaluation];
  const scenariosMatchFrozenVersion =
    version.test_scenarios.length === 2 &&
    scenarios.every((scenario, index) =>
      isDeepStrictEqual(scenario, version.test_scenarios[index]),
    );
  const canonicalScenariosDistinct =
    scenarios[0].scenario_id !== scenarios[1].scenario_id &&
    scenarios[0].label !== scenarios[1].label &&
    !isDeepStrictEqual(
      scenarios[0].input_fixture,
      scenarios[1].input_fixture,
    );
  const canonicalScenarioBinding = executions.every(
    (record, index) =>
      record.scenario_label === scenarios[index].label &&
      isDeepStrictEqual(record.validated_input, scenarios[index].input_fixture),
  );
  const sharedProvenance = executions.every(
    (record) =>
      record.status === "succeeded" &&
      record.purpose === "prepublication_test" &&
      record.asset_id === version.asset_id &&
      record.asset_version_id === version.asset_version_id &&
      record.asset_version === version.version &&
      record.executor_key === version.executor_key &&
      record.definition_digest === version.definition_digest &&
      record.execution_mode === version.execution_kind,
  );
  const firstConfiguration = executions[0].model_or_config;
  const secondConfiguration = executions[1].model_or_config;
  const sharedConfiguration =
    firstConfiguration !== undefined &&
    secondConfiguration !== undefined &&
    firstConfiguration.configuration_digest !== undefined &&
    secondConfiguration.configuration_digest !== undefined &&
    isDeepStrictEqual(firstConfiguration, secondConfiguration);
  const scenarioAssertions = evaluations.flatMap((evaluation, index) => {
    const scenario = scenarios[index];
    return [
      {
        name: `${scenario.label}: output schema`,
        passed: evaluation.output_schema_valid,
        observed: evaluation.observed,
      },
      ...scenario.output_schema_expectations.map((expected) => ({
        name: `${scenario.label}: output expectation - ${expected}`,
        passed:
          evaluation.output_schema_valid &&
          evaluation.observations_traceable &&
          evaluation.usefulness_passed,
        observed: evaluation.observed,
      })),
      ...scenario.expected_usefulness.map((expected) => ({
        name: `${scenario.label}: usefulness - ${expected}`,
        passed: evaluation.usefulness_passed,
        observed: evaluation.observed,
      })),
      ...scenario.expected_safety.map((expected) => ({
        name: `${scenario.label}: safety - ${expected}`,
        passed: evaluation.safety_passed,
        observed: evaluation.observed,
      })),
    ];
  });
  const assertions = [
    {
      name: "Distinct execution IDs",
      passed: executions[0].execution_id !== executions[1].execution_id,
      observed: `${executions[0].execution_id}; ${executions[1].execution_id}`,
    },
    {
      name: "Shared unchanged core provenance",
      passed: sharedProvenance,
      observed: `${version.asset_id} / ${version.asset_version_id} / ${version.executor_key} / ${version.definition_digest}`,
    },
    {
      name: "Evidence scenarios match the exact frozen version scenarios",
      passed: scenariosMatchFrozenVersion,
      observed: `${scenarios[0].scenario_id}; ${scenarios[1].scenario_id}`,
    },
    {
      name: "Canonical scenarios are materially distinct",
      passed: canonicalScenariosDistinct,
      observed: `${scenarios[0].scenario_id}; ${scenarios[1].scenario_id}`,
    },
    {
      name: "Each execution is bound to its exact canonical scenario fixture",
      passed: canonicalScenarioBinding,
      observed: `${executions[0].scenario_label ?? "missing"}; ${executions[1].scenario_label ?? "missing"}`,
    },
    {
      name: "Both runs use the same reviewed configuration",
      passed: sharedConfiguration,
      observed:
        executions[0].model_or_config?.configuration_digest ??
        "No configuration digest recorded.",
    },
    ...scenarioAssertions,
  ];
  const passed = assertions.every((assertion) => assertion.passed);
  const data: JSONObject = {
    core_implementation_unchanged: sharedProvenance,
    canonical_scenarios_distinct: canonicalScenariosDistinct,
    canonical_scenario_binding: canonicalScenarioBinding,
    scenarios_match_frozen_version: scenariosMatchFrozenVersion,
    shared_configuration: sharedConfiguration,
    shared_asset_id: version.asset_id,
    shared_asset_version_id: version.asset_version_id,
    shared_asset_version: version.version,
    shared_executor_key: version.executor_key,
    shared_definition_digest: version.definition_digest,
    scenario_a_execution_id: executions[0].execution_id,
    scenario_b_execution_id: executions[1].execution_id,
    scenario_a_usefulness_passed: evaluations[0].usefulness_passed,
    scenario_a_safety_passed: evaluations[0].safety_passed,
    scenario_b_usefulness_passed: evaluations[1].usefulness_passed,
    scenario_b_safety_passed: evaluations[1].safety_passed,
  };

  return EvidenceSchema.parse({
    evidence_id: ids.next("evidence"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest,
    evidence_type: "reuse_test",
    scope:
      "Two materially different canonical synthetic scenarios through one frozen asset version and reviewed deterministic executor.",
    expected: {
      same_asset_version: true,
      same_executor: true,
      same_definition_digest: true,
      usefulness_and_safety_assertions_pass: true,
    },
    observed: data,
    result: passed ? "passed" : "failed",
    actor_type: "system",
    timestamp: clock.now().toISOString(),
    method:
      "Ran both frozen-version scenarios through the code-only maintainer harness and compared their persisted records and functional assertions.",
    scenario: `${scenarios[0].label}; ${scenarios[1].label}`,
    execution_ids: executions.map((record) => record.execution_id),
    artifact_reference:
      "src/modules/execution/executors/property-operations-brief/manifest.json",
    artifact_version: version.version,
    ...(executions[0].model_or_config === undefined
      ? {}
      : { model_or_config: executions[0].model_or_config }),
    details: {
      summary: passed
        ? "Both scenarios passed schema, usefulness, safety, and unchanged-core checks."
        : "One or more schema, usefulness, safety, or unchanged-core checks failed.",
      assertions,
      data,
    },
    limitations: [
      "Automated functional evidence does not constitute human review or human security/data acceptance.",
      "The scenarios use approved synthetic fixtures and do not test production integrations or side effects.",
      "Lexical high-impact and secret checks are bounded guardrails, not comprehensive DLP or a penetration test.",
    ],
  });
}
