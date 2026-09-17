import {
  AssetVersionContentSchema,
  EvidenceSchema,
  LifecycleEventSchema,
  type AssetVersion,
  type AssetVersionRecord,
  type Evidence,
  type ExecutionRecord,
  type JSONObject,
  type TestScenario,
} from "../../contracts";
import {
  demoCatalogEntries,
  heroDraftRecord,
  heroReviewEvidence,
  HERO_VERSION_ID,
  type DemoCatalogEntry,
  type DemoEvidencePlan,
} from "../../../fixtures/catalog/published-catalog";
import { CatalogRepository } from "../../modules/catalog/repository";
import {
  buildReuseEvidenceCandidate,
  createMaintainerExecutionHarness,
  evaluateScenarioExecution,
  ExecutionRepository,
  ExecutionService,
  serverExecutorRegistry,
} from "../../modules/execution";
import { GovernanceRepository } from "../../modules/governance/repository";
import { GovernanceService } from "../../modules/governance/service";
import { SystemClock } from "../../shared/ports/clock";
import { CryptoIdGenerator } from "../../shared/ports/id-generator";
import type { MarketplaceDatabase } from "./connection";
import { migrateDatabase } from "./migrate";

const ids = new CryptoIdGenerator();
const clock = new SystemClock();

function hoursBefore(reference: Date, hours: number): string {
  return new Date(reference.getTime() - hours * 3_600_000).toISOString();
}

function materializeEvidence(
  version: AssetVersion,
  plan: DemoEvidencePlan,
  reference: Date,
): Evidence {
  if (version.subject_digest === null) {
    throw new Error(`Cannot attach evidence to unfrozen version ${version.asset_version_id}.`);
  }
  const reviewer =
    plan.actor === "reviewer"
      ? {
          reviewer: {
            name: plan.reviewer_name ?? "Unnamed demo reviewer",
            ...(plan.reviewer_role ? { role: plan.reviewer_role } : {}),
          },
          actor_type: "demo_reviewer" as const,
          actor_name: plan.reviewer_name ?? "Unnamed demo reviewer",
        }
      : { actor_type: "system" as const };

  return EvidenceSchema.parse({
    evidence_id: ids.next("evidence"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest,
    evidence_type: plan.evidence_type,
    scope: plan.scope,
    observed: plan.summary,
    result: plan.result,
    ...reviewer,
    timestamp: hoursBefore(reference, plan.hours_ago),
    method: plan.method,
    execution_ids: [],
    artifact_version: version.version,
    details: {
      summary: plan.summary,
      assertions: plan.assertions,
      ...(plan.data ? { data: plan.data } : {}),
    },
    limitations: plan.limitations,
  });
}

function insertEvidenceRow(database: MarketplaceDatabase, evidence: Evidence): void {
  database
    .prepare(`
      INSERT INTO evidence (
        evidence_id, asset_id, asset_version_id, evidence_type, result,
        subject_digest, record_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (evidence_id) DO NOTHING
    `)
    .run(
      evidence.evidence_id,
      evidence.asset_id,
      evidence.asset_version_id,
      evidence.evidence_type,
      evidence.result,
      evidence.subject_digest,
      JSON.stringify(evidence),
      evidence.timestamp,
    );
}

function insertLifecycleEvent(
  database: MarketplaceDatabase,
  version: AssetVersion,
  from: string | null,
  to: string,
  reason: string,
  timestamp: string,
  actorName?: string,
): void {
  const event = LifecycleEventSchema.parse({
    event_id: ids.next("event"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    from_state: from,
    to_state: to,
    actor_type: actorName ? "demo_reviewer" : "system",
    ...(actorName ? { actor_name: actorName } : {}),
    evidence_ids: [],
    reason,
    timestamp,
  });
  database
    .prepare(`
      INSERT INTO lifecycle_events (
        event_id, asset_id, asset_version_id, from_state, to_state,
        actor_type, actor_name, evidence_ids_json, reason, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `)
    .run(
      event.event_id,
      event.asset_id,
      event.asset_version_id,
      event.from_state ?? null,
      event.to_state,
      event.actor_type,
      event.actor_name ?? null,
      JSON.stringify(event.evidence_ids),
      event.reason,
      event.timestamp,
    );
}

function insertVersion(
  database: MarketplaceDatabase,
  record: AssetVersionRecord,
): void {
  const version = record.asset_version;
  const {
    lifecycle,
    subject_digest,
    published_at,
    deprecated_at,
    replacement_version,
    ...contentValue
  } = version;
  const content = AssetVersionContentSchema.parse(contentValue);

  database
    .prepare(`
      INSERT INTO assets (asset_id, slug, current_published_version_id, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?)
      ON CONFLICT (asset_id) DO NOTHING
    `)
    .run(record.asset.asset_id, record.asset.slug, record.asset.created_at, record.asset.updated_at);

  database
    .prepare(`
      INSERT INTO asset_versions (
        asset_version_id, asset_id, version, content_json, subject_digest,
        lifecycle, published_at, deprecated_at, replacement_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (asset_version_id) DO NOTHING
    `)
    .run(
      version.asset_version_id,
      version.asset_id,
      version.version,
      JSON.stringify(content),
      subject_digest,
      lifecycle,
      published_at,
      deprecated_at,
      replacement_version,
    version.created_at,
    );
}

export function seedReferenceCatalog(
  database: MarketplaceDatabase,
  reference: Date = new Date(),
): void {
  const current: DemoCatalogEntry[] = [];

  for (const entry of demoCatalogEntries) {
    insertVersion(database, entry.record);
    const version = entry.record.asset_version;
    insertLifecycleEvent(
      database,
      version,
      "in_review",
      "published",
      "Seeded published reference contribution for the demo catalog.",
      version.published_at ?? version.created_at,
    );
    for (const plan of entry.evidence) {
      insertEvidenceRow(database, materializeEvidence(version, plan, reference));
    }
    if (entry.current) current.push(entry);
  }

  // The public pointer is set last so a superseded version never claims it.
  for (const entry of current) {
    database
      .prepare("UPDATE assets SET current_published_version_id = ?, updated_at = ? WHERE asset_id = ?")
      .run(
        entry.record.asset_version.asset_version_id,
        entry.record.asset_version.published_at,
        entry.record.asset.asset_id,
      );
  }
}

function buildFunctionalEvidence(
  version: AssetVersion,
  scenario: TestScenario,
  execution: ExecutionRecord,
  reference: Date,
): Evidence {
  const evaluation = evaluateScenarioExecution(scenario, execution, version.output_schema);
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
    scope: `Frozen-version prepublication scenario: ${scenario.label}`,
    expected: {
      usefulness: scenario.expected_usefulness,
      safety: scenario.expected_safety,
      output_schema_expectations: scenario.output_schema_expectations,
    },
    observed: evaluation as unknown as JSONObject,
    result: passed ? "passed" : "failed",
    actor_type: "system",
    timestamp: hoursBefore(reference, 4),
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
        ? "The scenario passed every schema, usefulness, and safety assertion."
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
  version: AssetVersion,
  invalid: ExecutionRecord,
  reference: Date,
): Evidence {
  const rejectedBeforeExecution =
    invalid.status === "invalid" &&
    invalid.output === undefined &&
    invalid.validation_results.some((result) => result.stage === "input" && !result.valid);

  return EvidenceSchema.parse({
    evidence_id: ids.next("evidence"),
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest,
    evidence_type: "guardrail_test",
    scope: "Schema-invalid input must fail closed before the executor runs.",
    observed: {
      status: invalid.status,
      produced_output: invalid.output !== undefined,
      validation_results: invalid.validation_results as unknown as JSONObject[],
    } as unknown as JSONObject,
    result: rejectedBeforeExecution ? "passed" : "failed",
    actor_type: "system",
    timestamp: hoursBefore(reference, 4),
    method:
      "Submitted a schema-invalid request through the maintainer harness and confirmed the run was rejected without producing output.",
    execution_ids: [invalid.execution_id],
    artifact_version: version.version,
    details: {
      summary: rejectedBeforeExecution
        ? "The invalid request was rejected at input validation and produced no output."
        : "The invalid request was not rejected as required.",
      assertions: [
        {
          name: "Invalid input is rejected before execution",
          passed: rejectedBeforeExecution,
          observed: `status=${invalid.status}; output_present=${invalid.output !== undefined}`,
        },
      ],
    },
    limitations: [
      "Covers the documented input contract only; it is not an exhaustive adversarial test.",
    ],
  });
}

/**
 * Drives the hero through the real prepublication and publication path: two
 * distinct scenario runs, a fail-closed guardrail run, generated evidence, and
 * a gate-enforced publish. Nothing here asserts a state the gates did not check.
 */
async function seedRunnableHero(
  database: MarketplaceDatabase,
  reference: Date,
): Promise<void> {
  insertVersion(database, heroDraftRecord);
  const heroVersion = heroDraftRecord.asset_version;
  insertLifecycleEvent(
    database,
    heroVersion,
    null,
    "draft",
    "Seeded the frozen runnable hero draft for prepublication testing.",
    heroVersion.created_at,
  );

  const governanceRepository = new GovernanceRepository(database);
  const executionRepository = new ExecutionRepository(database);
  const service = new ExecutionService(
    new CatalogRepository(database),
    executionRepository,
    serverExecutorRegistry,
    clock,
    ids,
  );
  const harness = createMaintainerExecutionHarness({
    executePrepublication: (value) => service.executePrepublication(value),
  });

  const scenarios = heroVersion.test_scenarios as unknown as [TestScenario, TestScenario];
  const executions: ExecutionRecord[] = [];
  for (const scenario of scenarios) {
    executions.push(
      await harness.runScenario({
        asset_version_id: HERO_VERSION_ID,
        scenario_label: scenario.label,
        input: scenario.input_fixture,
      }),
    );
  }

  // Fail-closed guardrail run: the observations array is required and non-empty.
  const guardrail = await harness.runScenario({
    asset_version_id: HERO_VERSION_ID,
    scenario_label: "Guardrail: missing observations",
    input: { brief_title: "Incomplete request", audience: "Regional manager" },
  });

  for (const [index, scenario] of scenarios.entries()) {
    insertEvidenceRow(
      database,
      buildFunctionalEvidence(heroVersion, scenario, executions[index]!, reference),
    );
  }
  insertEvidenceRow(database, buildGuardrailEvidence(heroVersion, guardrail, reference));
  insertEvidenceRow(
    database,
    buildReuseEvidenceCandidate({
      version: heroVersion,
      scenarios,
      executions: [executions[0]!, executions[1]!],
      ids,
      clock,
    }),
  );
  for (const plan of heroReviewEvidence) {
    insertEvidenceRow(database, materializeEvidence(heroVersion, plan, reference));
  }

  const governance = new GovernanceService(
    governanceRepository,
    clock,
    ids,
    serverExecutorRegistry,
    executionRepository,
  );
  governance.transition(HERO_VERSION_ID, {
    to_state: "submitted",
    actor_type: "team_member",
    actor_name: "Property Operations Enablement",
    reason: "Prepublication scenarios and guardrail run completed against the frozen digest.",
  });
  governance.transition(HERO_VERSION_ID, {
    to_state: "in_review",
    actor_type: "demo_reviewer",
    actor_name: "Dana Whitfield",
    reason: "Accepted the contribution into prototype review.",
  });
  governance.transition(HERO_VERSION_ID, {
    to_state: "published",
    actor_type: "demo_reviewer",
    actor_name: "Dana Whitfield",
    reason: "All required publication gates passed against the current subject digest.",
    confirm_publication: true,
  });

  await seedUserRuns(service);
}

/**
 * Real public runs of the published hero. These go through the same execution
 * service a user's Try request uses, so usage reporting reads genuine records
 * rather than numbers written straight into the table.
 */
const USER_RUNS: { scenario: string; input: Record<string, unknown> }[] = [
  {
    scenario: "Maintenance backlog review",
    input: {
      brief_title: "Westview maintenance backlog",
      audience: "Regional maintenance manager",
      observations: [
        "Synthetic: 9 work orders have been open longer than 21 days.",
        "Synthetic: one elevator inspection is awaiting a vendor date.",
      ],
      constraints: ["A human must confirm the work-order counts before sharing."],
    },
  },
  {
    scenario: "Maintenance backlog review",
    input: {
      brief_title: "Harbor Point make-ready backlog",
      audience: "Make-ready supervisor",
      observations: [
        "Synthetic: 4 units are waiting on flooring installation.",
        "Synthetic: paint crew availability drops next week.",
      ],
    },
  },
  {
    scenario: "Energy variance review",
    input: {
      brief_title: "Cedar Grove energy variance",
      audience: "Sustainability analyst",
      observations: [
        "Synthetic: August consumption exceeded baseline by 12 percent.",
        "Synthetic: one interval-data gap remains unexplained.",
      ],
      constraints: ["Do not attribute the variance without a verified meter audit."],
    },
  },
  {
    scenario: "Turnover handoff brief",
    input: {
      brief_title: "Building C turnover handoff",
      audience: "Incoming shift supervisor",
      observations: [
        "Synthetic: 3 punch items remain open in Building C.",
        "Synthetic: keys for two units are unaccounted for.",
      ],
    },
  },
  {
    scenario: "Vendor escalation brief",
    input: {
      brief_title: "Roofing vendor escalation",
      audience: "Procurement specialist",
      observations: ["Synthetic: the roofing vendor has missed two scheduled visits."],
    },
  },
  // A rejected run: observations must be a non-empty array of strings.
  {
    scenario: "Rejected: empty observations",
    input: {
      brief_title: "Incomplete submission",
      audience: "Regional manager",
      observations: [],
    },
  },
];

async function seedUserRuns(service: ExecutionService): Promise<void> {
  for (const run of USER_RUNS) {
    const result = await service.executePublic({
      asset_version_id: HERO_VERSION_ID,
      scenario_label: run.scenario,
      input: run.input,
    });
    if (result.kind !== "record") {
      throw new Error(
        `Seeded user run "${run.scenario}" was rejected before producing a record.`,
      );
    }
  }
}

/**
 * Seeds the complete demo state: a differentiated published catalog with varied
 * governance coverage, and one hero asset published through the real gates with
 * persisted executions and reuse evidence.
 */
export async function seedDemoCatalog(
  database: MarketplaceDatabase,
  now: Date = new Date(),
): Promise<void> {
  migrateDatabase(database);
  seedReferenceCatalog(database, now);
  await seedRunnableHero(database, now);
}
