import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ExecutionRecord } from "@/contracts";
import { ExecutionRepository } from "@/modules/execution/repository";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";

const DEFINITION_DIGEST = `sha256:${"d".repeat(64)}`;
const CONFIGURATION_DIGEST = `sha256:${"c".repeat(64)}`;

function pendingRecord(
  executionId = "execution_repository_a",
): ExecutionRecord {
  return {
    execution_id: executionId,
    asset_id: "asset_property_ops_brief",
    asset_version_id: "av_property_ops_brief_0_1_0_draft_1",
    asset_version: "0.1.0-draft.1",
    executor_key: "property_ops.brief",
    definition_digest: DEFINITION_DIGEST,
    purpose: "prepublication_test",
    scenario_label: "Synthetic maintenance backlog review",
    status: "pending",
    validated_input: {
      brief_title: "Weekly maintenance backlog",
      audience: "Regional property operations reviewer",
      observations: ["Synthetic Site A has 14 open work orders."],
    },
    validation_results: [
      {
        stage: "input",
        valid: true,
        code: "schema_valid",
        message: "Input matched the selected version schema.",
      },
      {
        stage: "policy",
        valid: true,
        code: "policy_allowed",
        message: "Input stayed inside the reviewed safety boundary.",
      },
      {
        stage: "definition_digest",
        valid: true,
        code: "definition_digest_verified",
        message: "The registered artifacts matched the selected version.",
      },
    ],
    execution_mode: "deterministic",
    model_or_config: {
      provider: "local",
      configuration_digest: CONFIGURATION_DIGEST,
      parameters: { outbound_integrations: false },
    },
    started_at: "2026-09-16T10:00:00Z",
    completed_at: null,
  };
}

function succeededRecord(record: ExecutionRecord): ExecutionRecord {
  return {
    ...record,
    status: "succeeded",
    output: {
      title: "Weekly maintenance backlog",
      summary: ["Synthetic Site A has 14 open work orders."],
      review_questions: ["Can a reviewer verify the supplied count?"],
      limitations: ["Synthetic observations require human verification."],
    },
    validation_results: [
      ...record.validation_results,
      {
        stage: "output",
        valid: true,
        code: "schema_valid",
        message: "Output matched the selected version schema.",
      },
    ],
    completed_at: "2026-09-16T10:00:01Z",
  };
}

describe("ExecutionRepository", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let repository: ExecutionRepository;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `execution-repository-${process.pid}-${Date.now()}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    migrateDatabase(database);
    seedDatabase(database);
    repository = new ExecutionRepository(database);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  it("atomically transitions a pending run and preserves complete provenance", () => {
    const pending = pendingRecord();
    expect(repository.insert(pending)).toEqual(pending);

    const succeeded = succeededRecord(pending);
    expect(repository.update(succeeded)).toEqual(succeeded);
    expect(repository.getById(succeeded.execution_id)).toEqual(succeeded);
    expect(
      repository.listByAssetVersionId(succeeded.asset_version_id),
    ).toEqual([succeeded]);
    expect(repository.listByIds([succeeded.execution_id])).toEqual([succeeded]);

    const row = database
      .prepare(`
        SELECT purpose, status, record_json, started_at, completed_at
        FROM executions
        WHERE execution_id = ?
      `)
      .get(succeeded.execution_id) as Record<string, unknown>;
    const persistedJson = JSON.parse(String(row.record_json));
    expect(row).toMatchObject({
      purpose: succeeded.purpose,
      status: "succeeded",
      started_at: succeeded.started_at,
      completed_at: succeeded.completed_at,
    });
    expect(persistedJson).toEqual(succeeded);
    expect(persistedJson).toMatchObject({
      executor_key: "property_ops.brief",
      definition_digest: DEFINITION_DIGEST,
      model_or_config: { configuration_digest: CONFIGURATION_DIGEST },
    });
  });

  it("persists an honest execution failure without output", () => {
    const pending = pendingRecord("execution_repository_failure");
    repository.insert(pending);

    const failed: ExecutionRecord = {
      ...pending,
      status: "failed",
      error: {
        code: "executor_timeout",
        message: "Execution exceeded the reviewed time limit.",
        retryable: true,
      },
      completed_at: "2026-09-16T10:00:02Z",
    };

    expect(repository.update(failed)).toEqual(failed);
    expect(repository.getById(failed.execution_id)).toMatchObject({
      status: "failed",
      error: { code: "executor_timeout" },
      executor_key: "property_ops.brief",
      definition_digest: DEFINITION_DIGEST,
    });
    expect(repository.getById(failed.execution_id)).not.toHaveProperty("output");
  });

  it("rejects provenance drift and mutation after a terminal result", () => {
    const pending = pendingRecord("execution_repository_immutable");
    repository.insert(pending);

    expect(() =>
      repository.update({
        ...succeededRecord(pending),
        definition_digest: `sha256:${"e".repeat(64)}`,
      }),
    ).toThrow(/immutable field definition_digest/);

    const succeeded = repository.update(succeededRecord(pending));
    expect(() =>
      repository.update({
        ...succeeded,
        completed_at: "2026-09-16T10:00:03Z",
      }),
    ).toThrow(/already terminal/);
  });

  it("schema-validates writes and returns null for a missing execution", () => {
    expect(() =>
      repository.insert({ ...pendingRecord(), unexpected: true }),
    ).toThrow();
    expect(repository.getById("execution_missing")).toBeNull();
    expect(repository.listByIds([])).toEqual([]);
  });

  it("rejects a forged terminal success that did not transition from pending", () => {
    const pending = pendingRecord("execution_repository_forged_success");
    expect(() => repository.insert(succeededRecord(pending))).toThrow(
      /cannot be inserted directly with status succeeded/,
    );
    expect(repository.getById(pending.execution_id)).toBeNull();
  });
});
