import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/discovery/route";
import { DiscoveryResponseSchema } from "@/contracts";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
} from "@/server/db";
import { seedPublishedCatalog } from "@/server/db/seed";

describe("discovery API", () => {
  let databasePath: string;
  let previousDatabasePath: string | undefined;
  let previousAiProvider: string | undefined;

  beforeAll(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(DATA_DIRECTORY, `discovery-api-${process.pid}-${Date.now()}.sqlite`);
    previousDatabasePath = process.env.DATABASE_PATH;
    previousAiProvider = process.env.AI_PROVIDER;
    process.env.DATABASE_PATH = databasePath;
    process.env.AI_PROVIDER = "disabled";
    removeDatabaseFiles(databasePath);
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
      seedDatabase(database);
      seedPublishedCatalog(database);
    } finally {
      closeDatabase(database);
    }
  });

  afterAll(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousAiProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousAiProvider;
    removeDatabaseFiles(databasePath);
  });

  it("returns a canonical response from the persisted published catalog", async () => {
    const response = await POST(new Request("http://localhost/api/discovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "resident communication planner" }),
    }));

    expect(response.status).toBe(200);
    const result = DiscoveryResponseSchema.parse(await response.json());
    expect(result.status).toBe("matches");
    expect(JSON.stringify(result)).not.toContain("av_property_ops_brief_0_1_0_draft_1");
  });

  it("rejects malformed JSON and unsupported request fields", async () => {
    const malformed = await POST(new Request("http://localhost/api/discovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }));
    expect(malformed.status).toBe(400);

    const unsupported = await POST(new Request("http://localhost/api/discovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "resident updates", confidence: 1 }),
    }));
    expect(unsupported.status).toBe(400);
  });
});
