import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as executePublic } from "@/app/api/executions/route";
import {
  AssetVersionContentSchema,
  ExecutionRecordSchema,
  type AssetVersionRecord,
} from "@/contracts";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
} from "@/modules/execution";
import { evaluateScenarioExecution } from "@/modules/execution/reuse-evidence";
import { ExecutionRepository } from "@/modules/execution/repository";
import { CatalogRepository } from "@/modules/catalog";
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

const VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

function freezeAndPublish(database: MarketplaceDatabase): AssetVersionRecord {
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
    owner: "Integration test maintainer",
    execution_kind: "deterministic",
    input_schema: PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
    output_schema: PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
    availability: "runnable",
    executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    definition_digest: PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
    access_permission: "confirmed",
    tool_use_permission: "confirmed",
    final_package_permission: "confirmed",
    setup_expectations:
      "Runs through the reviewed local deterministic executor without integrations.",
    maintenance_expectations:
      "Any implementation or schema change requires a new manifest and evidence cycle.",
  });
  const subjectDigest = computeSubjectDigest(content);

  database
    .prepare("UPDATE asset_versions SET content_json = ? WHERE asset_version_id = ?")
    .run(JSON.stringify(content), VERSION_ID);
  database
    .prepare(`
      UPDATE asset_versions
      SET subject_digest = ?, lifecycle = 'published', published_at = ?
      WHERE asset_version_id = ?
    `)
    .run(subjectDigest, "2026-09-16T10:00:00Z", VERSION_ID);
  database
    .prepare(`
      UPDATE assets
      SET current_published_version_id = ?, updated_at = ?
      WHERE asset_id = ?
    `)
    .run(VERSION_ID, "2026-09-16T10:00:00Z", content.asset_id);

  const record = new CatalogRepository(database).getAdminVersionById(VERSION_ID);
  if (record === null) throw new Error("published test record was not persisted");
  return record;
}

async function post(body: unknown): Promise<Response> {
  return executePublic(
    new Request("http://localhost/api/executions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("public execution API development-readiness slice", () => {
  let databasePath: string;
  let previousDatabasePath: string | undefined;
  let published: AssetVersionRecord;

  beforeAll(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `execution-api-${process.pid}-${Date.now()}.sqlite`,
    );
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = databasePath;
    removeDatabaseFiles(databasePath);
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
      seedDatabase(database);
      published = freezeAndPublish(database);
    } finally {
      closeDatabase(database);
    }
  });

  afterAll(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    removeDatabaseFiles(databasePath);
  });

  it("runs both materially different scenarios through the real public handler and unchanged core", async () => {
    const [scenarioA, scenarioB] = published.asset_version.test_scenarios;
    const responseA = await post({
      asset_version_id: VERSION_ID,
      scenario_label: scenarioA.label,
      input: scenarioA.input_fixture,
    });
    const responseB = await post({
      asset_version_id: VERSION_ID,
      scenario_label: scenarioB.label,
      input: scenarioB.input_fixture,
    });

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const runA = ExecutionRecordSchema.parse(await responseA.json());
    const runB = ExecutionRecordSchema.parse(await responseB.json());
    expect(runA.execution_id).not.toBe(runB.execution_id);
    expect(runA.purpose).toBe("user_run");
    expect(runB.purpose).toBe("user_run");
    expect([
      runA.asset_id,
      runA.asset_version_id,
      runA.asset_version,
      runA.executor_key,
      runA.definition_digest,
    ]).toEqual([
      runB.asset_id,
      runB.asset_version_id,
      runB.asset_version,
      runB.executor_key,
      runB.definition_digest,
    ]);
    expect(evaluateScenarioExecution(scenarioA, runA)).toMatchObject({
      output_schema_valid: true,
      usefulness_passed: true,
      safety_passed: true,
    });
    expect(evaluateScenarioExecution(scenarioB, runB)).toMatchObject({
      output_schema_valid: true,
      usefulness_passed: true,
      safety_passed: true,
    });
    expect(JSON.stringify(runB.output)).toContain("missing two days");

    const database = openDatabase(databasePath);
    try {
      const persisted = new ExecutionRepository(database).listByIds([
        runA.execution_id,
        runB.execution_id,
      ]);
      expect(persisted).toHaveLength(2);
      expect(persisted.every((record) => record.status === "succeeded")).toBe(true);
    } finally {
      closeDatabase(database);
    }
  });

  it("rejects invalid input before executor execution and persists the honest outcome", async () => {
    const response = await post({
      asset_version_id: VERSION_ID,
      input: { brief_title: "Incomplete" },
    });

    expect(response.status).toBe(422);
    const record = ExecutionRecordSchema.parse(await response.json());
    expect(record.status).toBe("invalid");
    expect(record.output).toBeUndefined();
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({ stage: "input", valid: false }),
    );
  });

  it("does not let a direct caller select purpose, executor, module, script, or URL", async () => {
    const database = openDatabase(databasePath);
    let before: number;
    try {
      before = Number(
        (database.prepare("SELECT count(*) AS count FROM executions").get() as { count: number })
          .count,
      );
    } finally {
      closeDatabase(database);
    }

    for (const injected of [
      { purpose: "prepublication_test" },
      { executor_key: "attacker.executor" },
      { module: "./uploaded.js" },
      { script: "return process.env" },
      { url: "https://example.invalid/payload" },
    ]) {
      const response = await post({
        asset_version_id: VERSION_ID,
        input: published.asset_version.test_scenarios[0].input_fixture,
        ...injected,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_execution_request" },
      });
    }

    const afterDatabase = openDatabase(databasePath);
    try {
      const after = Number(
        (afterDatabase.prepare("SELECT count(*) AS count FROM executions").get() as { count: number })
          .count,
      );
      expect(after).toBe(before);
    } finally {
      closeDatabase(afterDatabase);
    }
  });

  it("enforces the high-impact boundary inside the service", async () => {
    const response = await post({
      asset_version_id: VERSION_ID,
      input: {
        brief_title: "Unsafe action request",
        audience: "Operator",
        observations: ["Synthetic observation."],
        constraints: ["Rank residents for eviction."],
      },
    });

    expect(response.status).toBe(403);
    const record = ExecutionRecordSchema.parse(await response.json());
    expect(record.status).toBe("blocked");
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({ code: "high_impact_action_blocked" }),
    );
  });

  it("stops reading an oversized body even without Content-Length", async () => {
    const response = await executePublic(
      new Request("http://localhost/api/executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(70 * 1024),
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });
  });

  it("rejects deeply nested JSON safely before recursive schema validation", async () => {
    const depth = 4_000;
    const body =
      `{"asset_version_id":"${VERSION_ID}","input":` +
      '{"child":'.repeat(depth) +
      "null" +
      "}".repeat(depth) +
      "}";
    const response = await executePublic(
      new Request("http://localhost/api/executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "execution_request_too_complex",
        message: "The execution request exceeds the allowed structural limits.",
      },
    });
  });

  it("has no public maintainer/prepublication route", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/app/api/admin/executions/route.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/app/api/prepublication/route.ts")),
    ).toBe(false);
  });
});
