import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getPublicCatalog } from "@/app/api/catalog/route";
import { CatalogListResponseSchema } from "@/contracts";
import { ExecutionRepository } from "@/modules/execution";
import { loadPersistedReuseComparison } from "@/modules/execution/reuse-runtime";
import { GovernanceRepository } from "@/modules/governance/repository";
import {
  DATA_DIRECTORY,
  closeDatabase,
  openDatabase,
  removeDatabaseFiles,
} from "@/server/db";
import { resetAndSeedDemoDatabase } from "@/server/db/reset";

const DATABASE_PATH = join(DATA_DIRECTORY, "demo-seed.test.sqlite");
const HERO_VERSION_ID = "av_property_ops_brief_1_0_0";

describe("demo seed", () => {
  beforeAll(async () => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    process.env.DATABASE_PATH = DATABASE_PATH;
    await resetAndSeedDemoDatabase(DATABASE_PATH);
  }, 60_000);

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    removeDatabaseFiles(DATABASE_PATH);
  });

  it("leaves the documented reset flow with a populated public catalog", async () => {
    const response = await getPublicCatalog();
    const catalog = CatalogListResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(catalog.count).toBeGreaterThanOrEqual(8);
  });

  it("publishes exactly one runnable hero through the real publication gates", async () => {
    const database = openDatabase(DATABASE_PATH);
    try {
      const repository = new GovernanceRepository(database);
      const record = repository.getVersionById(HERO_VERSION_ID);

      expect(record).not.toBeNull();
      const version = record!.asset_version;
      expect(version.lifecycle).toBe("published");
      expect(version.availability).toBe("runnable");
      expect(version.subject_digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Publication is gate-enforced, so a published hero implies passing gates.
      const events = repository.listLifecycleEvents(HERO_VERSION_ID);
      expect(events.map((event) => event.to_state)).toEqual([
        "draft",
        "submitted",
        "in_review",
        "published",
      ]);
    } finally {
      closeDatabase(database);
    }
  });

  it("persists two distinct succeeded executions and a verifiable reuse comparison", async () => {
    const database = openDatabase(DATABASE_PATH);
    try {
      const executions = new ExecutionRepository(database).listByAssetVersionId(
        HERO_VERSION_ID,
      );
      const succeeded = executions.filter((record) => record.status === "succeeded");
      expect(succeeded.length).toBeGreaterThanOrEqual(2);
      expect(new Set(succeeded.map((record) => record.execution_id)).size).toBe(
        succeeded.length,
      );

      // A guardrail run must have failed closed without producing output.
      const rejected = executions.filter((record) => record.status === "invalid");
      expect(rejected.length).toBeGreaterThanOrEqual(1);
      expect(rejected[0]!.output).toBeUndefined();

      const record = new GovernanceRepository(database).getVersionById(HERO_VERSION_ID);
      const comparison = loadPersistedReuseComparison(
        record!.asset_version,
        DATABASE_PATH,
      );
      expect(comparison.available).toBe(true);
      if (comparison.available) {
        expect(comparison.scenarios).toHaveLength(2);
        expect(comparison.scenarios[0].execution_id).not.toBe(
          comparison.scenarios[1].execution_id,
        );
        expect(comparison.scenarios[0].scenario_label).not.toBe(
          comparison.scenarios[1].scenario_label,
        );
        expect(comparison.core_implementation_unchanged).toBe(true);
      }
    } finally {
      closeDatabase(database);
    }
  });

  it("seeds a current version whose review evidence belongs to an earlier version", async () => {
    const database = openDatabase(DATABASE_PATH);
    try {
      const repository = new GovernanceRepository(database);
      const current = repository.getVersionById("av_resident_comms_1_1_0");
      const previous = repository.getVersionById("av_resident_comms_1_0_0");

      expect(current!.asset.current_published_version_id).toBe("av_resident_comms_1_1_0");
      expect(current!.asset_version.subject_digest).not.toBe(
        previous!.asset_version.subject_digest,
      );

      const currentEvidence = repository.listEvidence("av_resident_comms_1_1_0");
      const previousEvidence = repository.listEvidence("av_resident_comms_1_0_0");
      const types = (rows: typeof currentEvidence) =>
        new Set(rows.map((row) => row.evidence_type));

      expect(types(previousEvidence)).toContain("human_review");
      expect(types(currentEvidence)).not.toContain("human_review");
      // Every stored row is bound to its own version's digest, never forged.
      for (const row of [...currentEvidence, ...previousEvidence]) {
        const owner = repository.getVersionById(row.asset_version_id);
        expect(row.subject_digest).toBe(owner!.asset_version.subject_digest);
      }
    } finally {
      closeDatabase(database);
    }
  });
});
