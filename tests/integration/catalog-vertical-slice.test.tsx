import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getAdminCatalogVersion } from "@/app/api/admin/catalog/versions/[assetVersionId]/route";
import { GET as getPublicCatalog } from "@/app/api/catalog/route";
import { GET as getHealth } from "@/app/api/health/route";
import {
  AdminCatalogVersionResponseSchema,
  CatalogListResponseSchema,
} from "@/contracts";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
} from "@/server/db";

const BOOTSTRAP_VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

describe("catalog vertical slice", () => {
  let databasePath: string;
  let previousDatabasePath: string | undefined;

  beforeAll(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `integration-${process.pid}-${Date.now()}.sqlite`,
    );
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = databasePath;

    removeDatabaseFiles(databasePath);
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
      seedDatabase(database);
    } finally {
      closeDatabase(database);
    }
  });

  afterAll(() => {
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }

    removeDatabaseFiles(databasePath);
  });

  it("serves a healthy node route", async () => {
    const response = await getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "ai-marketplace",
    });
  });

  it("returns the schema-valid bootstrap draft from the real admin route", async () => {
    const response = await getAdminCatalogVersion(
      new Request(`http://localhost/api/admin/catalog/versions/${BOOTSTRAP_VERSION_ID}`),
      { params: Promise.resolve({ assetVersionId: BOOTSTRAP_VERSION_ID }) },
    );

    expect(response.status).toBe(200);
    const record = AdminCatalogVersionResponseSchema.parse(await response.json());
    expect(record.asset_version.asset_version_id).toBe(BOOTSTRAP_VERSION_ID);
    expect(record.asset_version.lifecycle).toBe("draft");
    expect(record.asset.current_published_version_id).toBeNull();

    expect(record.asset_version.availability).not.toBe("runnable");
    expect(record.asset_version.subject_digest).toBeNull();
    expect(record.asset_version.executor_key).toBeUndefined();
  });

  it("keeps the bootstrap draft out of public discovery", async () => {
    const response = await getPublicCatalog();

    expect(response.status).toBe(200);
    const catalog = CatalogListResponseSchema.parse(await response.json());
    expect(catalog).toEqual({ items: [], count: 0 });
    expect(JSON.stringify(catalog)).not.toContain(BOOTSTRAP_VERSION_ID);
  });
});
