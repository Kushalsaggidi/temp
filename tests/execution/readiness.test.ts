import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getHealth } from "@/app/api/health/route";
import { AssetVersionContentSchema } from "@/contracts";
import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
  assertExecutionCatalogReadiness,
  serverExecutorRegistry,
} from "@/modules/execution";
import {
  DATA_DIRECTORY,
  closeDatabase,
  getBootstrapRecord,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";

function runnableContent(definitionDigest = PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST) {
  const original = getBootstrapRecord().asset_version;
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...content
  } = original;
  return AssetVersionContentSchema.parse({
    ...content,
    execution_kind: "deterministic",
    input_schema: PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
    output_schema: PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
    availability: "runnable",
    executor_key: PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    definition_digest: definitionDigest,
  });
}

describe("execution startup readiness", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let previousDatabasePath: string | undefined;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `execution-readiness-${process.pid}-${Date.now()}.sqlite`,
    );
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = databasePath;
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    seedDatabase(database);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  });

  it("accepts only a runnable catalog binding that matches reviewed artifacts", () => {
    database
      .prepare("UPDATE asset_versions SET content_json = ? WHERE asset_version_id = ?")
      .run(
        JSON.stringify(runnableContent()),
        "av_property_ops_brief_0_1_0_draft_1",
      );

    expect(() =>
      assertExecutionCatalogReadiness(database, serverExecutorRegistry),
    ).not.toThrow();
  });

  it("fails startup readiness and health when the selected definition digest differs", async () => {
    database
      .prepare("UPDATE asset_versions SET content_json = ? WHERE asset_version_id = ?")
      .run(
        JSON.stringify(runnableContent(`sha256:${"f".repeat(64)}`)),
        "av_property_ops_brief_0_1_0_draft_1",
      );

    expect(() =>
      assertExecutionCatalogReadiness(database, serverExecutorRegistry),
    ).toThrow(/does not match its reviewed executor definition/);
    closeDatabase(database);
    const health = await getHealth();
    database = openDatabase(databasePath);
    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toEqual({
      status: "unavailable",
      service: "ai-marketplace",
    });
  });
});

