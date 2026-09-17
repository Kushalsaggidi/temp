import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssetVersionContentSchema,
  type AssetVersionRecord,
} from "@/contracts";
import { CatalogRepository } from "@/modules/catalog";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
  buildPersistedReuseComparison,
  buildReuseEvidenceCandidate,
  createMaintainerExecutionHarness,
  withExecutionService,
} from "@/modules/execution";
import { ExecutionRepository } from "@/modules/execution/repository";
import { computeSubjectDigest } from "@/shared/integrity";
import { SystemClock } from "@/shared/ports/clock";
import { CryptoIdGenerator } from "@/shared/ports/id-generator";
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

const VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

function freezeRunnableDraft(database: MarketplaceDatabase): AssetVersionRecord {
  const original = getBootstrapRecord().asset_version;
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
    owner: "Prepublication test maintainer",
    execution_kind: "deterministic",
    input_schema: PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
    output_schema: PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
    availability: "runnable",
    executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
    access_permission: "confirmed",
    tool_use_permission: "confirmed",
    final_package_permission: "confirmed",
    setup_expectations: "Reviewed deterministic local executor; no integrations.",
    maintenance_expectations:
      "Any artifact change requires a new manifest, version, freeze, and evidence cycle.",
  });
  const subjectDigest = computeSubjectDigest(content);
  database
    .prepare("UPDATE asset_versions SET content_json = ? WHERE asset_version_id = ?")
    .run(JSON.stringify(content), VERSION_ID);
  database
    .prepare("UPDATE asset_versions SET subject_digest = ? WHERE asset_version_id = ?")
    .run(subjectDigest, VERSION_ID);
  const record = new CatalogRepository(database).getAdminVersionById(VERSION_ID);
  if (record === null) throw new Error("frozen draft missing");
  return record;
}

describe("real maintainer harness two-scenario reuse readiness", () => {
  let databasePath: string;
  let previousDatabasePath: string | undefined;
  let frozen: AssetVersionRecord;

  beforeAll(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `prepublication-reuse-${process.pid}-${Date.now()}.sqlite`,
    );
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = databasePath;
    removeDatabaseFiles(databasePath);
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
      seedDatabase(database);
      frozen = freezeRunnableDraft(database);
    } finally {
      closeDatabase(database);
    }
  });

  afterAll(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    removeDatabaseFiles(databasePath);
  });

  it("produces current-subject evidence and a persisted unchanged-core comparison", async () => {
    const harness = createMaintainerExecutionHarness({
      executePrepublication: (request) =>
        withExecutionService(
          (service) => service.executePrepublication(request),
          databasePath,
        ),
    });
    const [scenarioA, scenarioB] = frozen.asset_version.test_scenarios;
    const runA = await harness.runScenario({
      asset_version_id: VERSION_ID,
      scenario_label: scenarioA.label,
      input: scenarioA.input_fixture,
    });
    const runB = await harness.runScenario({
      asset_version_id: VERSION_ID,
      scenario_label: scenarioB.label,
      input: scenarioB.input_fixture,
    });

    expect(runA.execution_id).not.toBe(runB.execution_id);
    expect(runA.status).toBe("succeeded");
    expect(runB.status).toBe("succeeded");
    expect([
      runA.asset_id,
      runA.asset_version_id,
      runA.executor_key,
      runA.definition_digest,
    ]).toEqual([
      runB.asset_id,
      runB.asset_version_id,
      runB.executor_key,
      runB.definition_digest,
    ]);

    const evidence = buildReuseEvidenceCandidate({
      version: frozen.asset_version,
      scenarios: [scenarioA, scenarioB],
      executions: [runA, runB],
      ids: new CryptoIdGenerator(),
      clock: new SystemClock(),
    });
    expect(evidence.result).toBe("passed");
    expect(evidence.subject_digest).toBe(frozen.asset_version.subject_digest);
    expect(evidence.execution_ids).toEqual([
      runA.execution_id,
      runB.execution_id,
    ]);

    const database = openDatabase(databasePath);
    try {
      const comparison = buildPersistedReuseComparison({
        repository: new ExecutionRepository(database),
        selectedVersion: frozen.asset_version,
        reuseEvidence: evidence,
      });
      expect(comparison).toMatchObject({
        available: true,
        core_implementation_unchanged: true,
        shared: {
          asset_id: frozen.asset.asset_id,
          asset_version_id: VERSION_ID,
          executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
          definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
        },
      });
      if (!comparison.available) throw new Error("comparison unavailable");
      expect(comparison.scenarios.map((item) => item.execution_id)).toEqual([
        runA.execution_id,
        runB.execution_id,
      ]);
      expect(comparison.statement).toMatch(/Core implementation unchanged/);
    } finally {
      closeDatabase(database);
    }
  });

  it("cannot use the public service entry point for the same unpublished draft", async () => {
    const result = await withExecutionService(
      (service) =>
        service.executePublic({
          asset_version_id: VERSION_ID,
          input: frozen.asset_version.test_scenarios[0].input_fixture,
        }),
      databasePath,
    );
    expect(result.kind).toBe("record");
    if (result.kind !== "record") throw new Error("expected record");
    expect(result.record.status).toBe("blocked");
    expect(result.record.purpose).toBe("user_run");
  });
});

