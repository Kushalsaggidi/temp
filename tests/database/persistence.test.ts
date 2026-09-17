import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import evidenceFixture from "../../fixtures/contracts/evidence.json";
import executionFixture from "../../fixtures/contracts/execution-record.json";
import { EvidenceSchema, ExecutionRecordSchema } from "@/contracts";
import { CatalogRepository } from "@/modules/catalog";
import {
  DATA_DIRECTORY,
  assertSafeResetPath,
  closeDatabase,
  getBootstrapLifecycleEvent,
  getBootstrapRecord,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";

let sequence = 0;

describe("SQLite catalog persistence", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    sequence += 1;
    databasePath = join(
      DATA_DIRECTORY,
      `database-test-${process.pid}-${sequence}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  it("migrates and seeds an exact schema-valid draft plus lifecycle event", () => {
    expect(migrateDatabase(database)).toEqual([{ version: 1, name: "initial" }]);
    expect(migrateDatabase(database)).toEqual([]);

    const seeded = seedDatabase(database);
    expect(seeded).toEqual(getBootstrapRecord());
    expect(new CatalogRepository(database).getAdminVersionById(
      seeded.asset_version.asset_version_id,
    )).toEqual(seeded);
    expect(new CatalogRepository(database).listPublished()).toEqual([]);

    const eventRow = database
      .prepare(`
        SELECT event_id, asset_id, asset_version_id, from_state, to_state,
               actor_type, actor_name, reason, evidence_ids_json, timestamp
        FROM lifecycle_events
      `)
      .get() as Record<string, unknown>;
    expect({
      ...eventRow,
      actor_name: eventRow.actor_name ?? undefined,
      evidence_ids: JSON.parse(String(eventRow.evidence_ids_json)),
      evidence_ids_json: undefined,
    }).toMatchObject(getBootstrapLifecycleEvent());
    expect(database.prepare("SELECT count(*) AS count FROM evidence").get()).toMatchObject({
      count: 0,
    });
    expect(database.prepare("SELECT count(*) AS count FROM executions").get()).toMatchObject({
      count: 0,
    });
  });

  it("is idempotent and refuses silent seed drift", () => {
    seedDatabase(database);
    seedDatabase(database);

    expect(database.prepare("SELECT count(*) AS count FROM assets").get()).toMatchObject({
      count: 1,
    });
    expect(
      database.prepare("SELECT count(*) AS count FROM asset_versions").get(),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare("SELECT count(*) AS count FROM lifecycle_events").get(),
    ).toMatchObject({ count: 1 });
  });

  it("prevents content mutation after the subject is frozen", () => {
    seedDatabase(database);
    const digest = `sha256:${"a".repeat(64)}`;
    database
      .prepare("UPDATE asset_versions SET subject_digest = ? WHERE asset_version_id = ?")
      .run(digest, "av_property_ops_brief_0_1_0_draft_1");

    expect(() =>
      database
        .prepare(`
          UPDATE asset_versions
          SET content_json = json_set(content_json, '$.name', 'Changed after freeze')
          WHERE asset_version_id = 'av_property_ops_brief_0_1_0_draft_1'
        `)
        .run(),
    ).toThrow(/frozen or published version content is immutable/);
  });

  it("rejects JSON identity drift and invalid relational values", () => {
    seedDatabase(database);

    expect(() =>
      database
        .prepare(`
          UPDATE asset_versions
          SET content_json = json_set(content_json, '$.asset_id', 'asset_wrong')
          WHERE asset_version_id = 'av_property_ops_brief_0_1_0_draft_1'
        `)
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare("UPDATE asset_versions SET lifecycle = 'not_a_state'")
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(`
          UPDATE asset_versions
          SET subject_digest = ?, lifecycle = 'published', published_at = ?
          WHERE asset_version_id = 'av_property_ops_brief_0_1_0_draft_1'
        `)
        .run(
          `sha256:${"e".repeat(64)}`,
          "2026-09-16T10:00:00Z",
        ),
    ).toThrow();
    expect(() =>
      database
        .prepare(`
          INSERT INTO assets (asset_id, slug, created_at, updated_at)
          VALUES ('asset_duplicate_slug', 'property-operations-brief',
                  '2026-09-16T09:00:00Z', '2026-09-16T09:00:00Z')
        `)
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(`
          INSERT INTO lifecycle_events (
            event_id, asset_id, asset_version_id, from_state, to_state,
            actor_type, actor_name, evidence_ids_json, reason, timestamp
          ) VALUES (
            'event_missing_version', 'asset_property_ops_brief', 'av_missing',
            NULL, 'draft', 'system', NULL, '[]', 'Invalid fixture',
            '2026-09-16T10:00:00Z'
          )
        `)
        .run(),
    ).toThrow();
  });

  it("binds evidence and execution JSON to the indexed version identity", () => {
    seedDatabase(database);
    const digest = `sha256:${"b".repeat(64)}`;
    const wrongDigest = `sha256:${"c".repeat(64)}`;
    const assetId = "asset_property_ops_brief";
    const assetVersionId = "av_property_ops_brief_0_1_0_draft_1";

    database
      .prepare(`
        UPDATE asset_versions
        SET content_json = json_set(
          content_json,
          '$.access_permission', 'confirmed',
          '$.tool_use_permission', 'confirmed',
          '$.final_package_permission', 'confirmed'
        )
        WHERE asset_version_id = ?
      `)
      .run(assetVersionId);
    database
      .prepare(`
        UPDATE asset_versions
        SET subject_digest = ?, lifecycle = 'published', published_at = ?
        WHERE asset_version_id = ?
      `)
      .run(digest, "2026-09-16T10:00:00Z", assetVersionId);

    const execution = ExecutionRecordSchema.parse({
      ...executionFixture,
      execution_id: "execution_bootstrap_test_001",
      asset_id: assetId,
      asset_version_id: assetVersionId,
      asset_version: "0.1.0-draft.1",
    });
    const evidence = EvidenceSchema.parse({
      ...evidenceFixture,
      evidence_id: "evidence_bootstrap_test_001",
      asset_id: assetId,
      asset_version_id: assetVersionId,
      subject_digest: digest,
      execution_ids: [execution.execution_id],
    });
    const mismatchedEvidence = {
      ...evidence,
      subject_digest: wrongDigest,
    };

    expect(() =>
      database
        .prepare(`
          INSERT INTO evidence (
            evidence_id, asset_id, asset_version_id, evidence_type, result,
            subject_digest, record_json, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          mismatchedEvidence.evidence_id,
          mismatchedEvidence.asset_id,
          mismatchedEvidence.asset_version_id,
          mismatchedEvidence.evidence_type,
          mismatchedEvidence.result,
          mismatchedEvidence.subject_digest,
          JSON.stringify(mismatchedEvidence),
          mismatchedEvidence.timestamp,
        ),
    ).toThrow(/evidence subject digest must match/);

    database
      .prepare(`
        INSERT INTO executions (
          execution_id, asset_id, asset_version_id, purpose, status,
          record_json, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        execution.execution_id,
        execution.asset_id,
        execution.asset_version_id,
        execution.purpose,
        execution.status,
        JSON.stringify(execution),
        execution.started_at,
        execution.completed_at,
      );
    database
      .prepare(`
        INSERT INTO evidence (
          evidence_id, asset_id, asset_version_id, evidence_type, result,
          subject_digest, record_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

    const executionRow = database
      .prepare("SELECT record_json FROM executions WHERE execution_id = ?")
      .get(execution.execution_id) as { record_json: string };
    const evidenceRow = database
      .prepare("SELECT record_json FROM evidence WHERE evidence_id = ?")
      .get(evidence.evidence_id) as { record_json: string };
    expect(
      ExecutionRecordSchema.parse(JSON.parse(executionRow.record_json)),
    ).toEqual(execution);
    expect(EvidenceSchema.parse(JSON.parse(evidenceRow.record_json))).toEqual(
      evidence,
    );
    expect(() =>
      database
        .prepare("UPDATE executions SET status = 'failed' WHERE execution_id = ?")
        .run(execution.execution_id),
    ).toThrow();
    expect(() =>
      database
        .prepare("UPDATE evidence SET result = 'failed' WHERE evidence_id = ?")
        .run(evidence.evidence_id),
    ).toThrow(/evidence records are immutable/);
  });

  it("lists only the current published version and preserves it after publication", () => {
    seedDatabase(database);
    const assetId = "asset_property_ops_brief";
    const assetVersionId = "av_property_ops_brief_0_1_0_draft_1";
    const digest = `sha256:${"d".repeat(64)}`;

    database
      .prepare(`
        UPDATE asset_versions
        SET content_json = json_set(
          content_json,
          '$.access_permission', 'confirmed',
          '$.tool_use_permission', 'confirmed',
          '$.final_package_permission', 'confirmed'
        )
        WHERE asset_version_id = ?
      `)
      .run(assetVersionId);
    database
      .prepare(`
        UPDATE asset_versions
        SET subject_digest = ?, lifecycle = 'published', published_at = ?
        WHERE asset_version_id = ?
      `)
      .run(digest, "2026-09-16T10:00:00Z", assetVersionId);
    database
      .prepare("UPDATE assets SET current_published_version_id = ? WHERE asset_id = ?")
      .run(assetVersionId, assetId);

    expect(new CatalogRepository(database).listPublished()).toHaveLength(1);
    database
      .prepare("UPDATE assets SET current_published_version_id = NULL WHERE asset_id = ?")
      .run(assetId);
    expect(() =>
      database
        .prepare("DELETE FROM asset_versions WHERE asset_version_id = ?")
        .run(assetVersionId),
    ).toThrow(/published versions cannot be deleted/);

    database
      .prepare(`
        UPDATE asset_versions
        SET lifecycle = 'deprecated', deprecated_at = ?
        WHERE asset_version_id = ?
      `)
      .run("2026-09-16T11:00:00Z", assetVersionId);
    expect(new CatalogRepository(database).listPublished()).toEqual([]);
  });

  it("refuses reset targets outside the repository data directory", () => {
    expect(() => assertSafeResetPath(join(process.cwd(), "unsafe.sqlite"))).toThrow(
      /Refusing to reset unsafe database path/,
    );
  });
});
