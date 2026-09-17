import { EvidenceSchema, type AssetVersion } from "@/contracts";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

import { ExecutionRepository } from "./repository";
import {
  buildPersistedReuseComparison,
  type ReuseComparison,
} from "./reuse-comparison";

interface EvidenceJsonRow {
  record_json: string;
}

/** Reads only current-subject passing reuse evidence; it does not govern it. */
export function loadPersistedReuseComparison(
  selectedVersion: AssetVersion,
  path?: string,
): ReuseComparison {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const rows = database
      .prepare(`
        SELECT record_json
        FROM evidence
        WHERE asset_id = ?
          AND asset_version_id = ?
          AND subject_digest = ?
          AND evidence_type = 'reuse_test'
          AND result = 'passed'
        ORDER BY timestamp DESC, evidence_id DESC
      `)
      .all(
        selectedVersion.asset_id,
        selectedVersion.asset_version_id,
        selectedVersion.subject_digest,
      ) as unknown as EvidenceJsonRow[];

    const evidence = rows
      .map((row) => {
        try {
          return EvidenceSchema.safeParse(JSON.parse(row.record_json));
        } catch {
          return null;
        }
      })
      .find((result) => result?.success)?.data;

    return buildPersistedReuseComparison({
      repository: new ExecutionRepository(database),
      selectedVersion,
      reuseEvidence: evidence ?? null,
    });
  } finally {
    closeDatabase(database);
  }
}

