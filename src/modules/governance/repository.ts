import {
  AssetVersionContentSchema,
  AssetVersionIdSchema,
  EvidenceSchema,
  LifecycleEventSchema,
  type Asset,
  type AssetVersionContent,
  type AssetVersionRecord,
  type Evidence,
  type LifecycleEvent,
  type LifecycleState,
} from "@/contracts";
import { CatalogRepository } from "@/modules/catalog/repository";
import type { MarketplaceDatabase } from "@/server/db/connection";

interface EvidenceRow {
  evidence_id: string;
  asset_id: string;
  asset_version_id: string;
  evidence_type: string;
  result: string;
  subject_digest: string;
  record_json: string;
  timestamp: string;
}

interface LifecycleEventRow {
  event_id: string;
  asset_id: string;
  asset_version_id: string;
  from_state: string | null;
  to_state: string;
  actor_type: string;
  actor_name: string | null;
  reason: string;
  evidence_ids_json: string;
  timestamp: string;
}

export interface TransitionPersistenceInput {
  assetVersionId: string;
  expectedFrom: LifecycleState;
  toState: LifecycleState;
  event: LifecycleEvent;
  publishedAt?: string;
  deprecatedAt?: string;
  replacementVersion?: string | null;
  validateCurrent?: () => void;
}

function parseEvidenceRow(row: EvidenceRow): Evidence {
  const evidence = EvidenceSchema.parse(JSON.parse(row.record_json));
  if (
    evidence.evidence_id !== row.evidence_id ||
    evidence.asset_id !== row.asset_id ||
    evidence.asset_version_id !== row.asset_version_id ||
    evidence.evidence_type !== row.evidence_type ||
    evidence.result !== row.result ||
    evidence.subject_digest !== row.subject_digest ||
    evidence.timestamp !== row.timestamp
  ) {
    throw new Error(
      `Evidence row ${row.evidence_id} disagrees with its canonical record JSON.`,
    );
  }
  return evidence;
}

function parseLifecycleEventRow(row: LifecycleEventRow): LifecycleEvent {
  return LifecycleEventSchema.parse({
    event_id: row.event_id,
    asset_id: row.asset_id,
    asset_version_id: row.asset_version_id,
    ...(row.from_state === null ? {} : { from_state: row.from_state }),
    to_state: row.to_state,
    actor_type: row.actor_type,
    ...(row.actor_name === null ? {} : { actor_name: row.actor_name }),
    reason: row.reason,
    evidence_ids: JSON.parse(row.evidence_ids_json),
    timestamp: row.timestamp,
  });
}

export class GovernanceRepository {
  private readonly catalog: CatalogRepository;

  constructor(private readonly database: MarketplaceDatabase) {
    this.catalog = new CatalogRepository(database);
  }

  getVersionById(assetVersionId: string): AssetVersionRecord | null {
    return this.catalog.getAdminVersionById(assetVersionId);
  }

  listVersions(): AssetVersionRecord[] {
    const rows = this.database
      .prepare(`
        SELECT asset_version_id
        FROM asset_versions
        ORDER BY created_at DESC, asset_version_id DESC
      `)
      .all() as unknown as { asset_version_id: string }[];

    return rows.map((row) => {
      const record = this.catalog.getAdminVersionById(row.asset_version_id);
      if (record === null) {
        throw new Error(`Asset version ${row.asset_version_id} disappeared while reading.`);
      }
      return record;
    });
  }

  insertDraft(
    asset: Asset,
    contentValue: AssetVersionContent,
    eventValue: LifecycleEvent,
  ): AssetVersionRecord {
    const content = AssetVersionContentSchema.parse(contentValue);
    const event = LifecycleEventSchema.parse(eventValue);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO assets (
            asset_id, slug, current_published_version_id, created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?)
        `)
        .run(asset.asset_id, asset.slug, asset.created_at, asset.updated_at);
      this.insertVersionRow(content);
      this.insertLifecycleEventRow(event);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return this.requireVersion(content.asset_version_id);
  }

  insertDraftForExistingAsset(
    contentValue: AssetVersionContent,
    eventValue: LifecycleEvent,
  ): AssetVersionRecord {
    const content = AssetVersionContentSchema.parse(contentValue);
    const event = LifecycleEventSchema.parse(eventValue);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertVersionRow(content);
      this.insertLifecycleEventRow(event);
      this.database
        .prepare("UPDATE assets SET updated_at = ? WHERE asset_id = ?")
        .run(event.timestamp, content.asset_id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return this.requireVersion(content.asset_version_id);
  }

  replaceEditableContent(contentValue: AssetVersionContent): AssetVersionRecord {
    const content = AssetVersionContentSchema.parse(contentValue);
    const result = this.database
      .prepare(`
        UPDATE asset_versions
        SET content_json = ?
        WHERE asset_version_id = ?
          AND subject_digest IS NULL
          AND lifecycle IN ('draft', 'changes_requested')
      `)
      .run(JSON.stringify(content), content.asset_version_id);

    if (Number(result.changes) !== 1) {
      throw new Error("Asset version is frozen or is not editable in its current state.");
    }
    return this.requireVersion(content.asset_version_id);
  }

  /**
   * Writes the subject digest for a version that has never been frozen. The
   * database refuses any later change, so this is a one-way step and the lock
   * a check is later bound to.
   */
  freezeSubjectDigest(assetVersionId: string, digest: string): AssetVersionRecord {
    const result = this.database
      .prepare(`
        UPDATE asset_versions
        SET subject_digest = ?
        WHERE asset_version_id = ?
          AND subject_digest IS NULL
          AND lifecycle IN ('draft', 'changes_requested')
      `)
      .run(digest, assetVersionId);

    if (Number(result.changes) !== 1) {
      throw new Error(
        "Asset version is already frozen or is not in an editable state.",
      );
    }
    return this.requireVersion(assetVersionId);
  }

  insertEvidence(value: Evidence): Evidence {
    const evidence = EvidenceSchema.parse(value);
    this.database
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
    return this.requireEvidence(evidence.evidence_id);
  }

  listEvidence(assetVersionIdValue: string): Evidence[] {
    const assetVersionId = AssetVersionIdSchema.parse(assetVersionIdValue);
    const rows = this.database
      .prepare(`
        SELECT evidence_id, asset_id, asset_version_id, evidence_type, result,
               subject_digest, record_json, timestamp
        FROM evidence
        WHERE asset_version_id = ?
        ORDER BY timestamp DESC, evidence_id DESC
      `)
      .all(assetVersionId) as unknown as EvidenceRow[];
    return rows.map(parseEvidenceRow);
  }

  listLifecycleEvents(assetVersionIdValue: string): LifecycleEvent[] {
    const assetVersionId = AssetVersionIdSchema.parse(assetVersionIdValue);
    const rows = this.database
      .prepare(`
        SELECT event_id, asset_id, asset_version_id, from_state, to_state,
               actor_type, actor_name, reason, evidence_ids_json, timestamp
        FROM lifecycle_events
        WHERE asset_version_id = ?
        ORDER BY timestamp ASC, event_id ASC
      `)
      .all(assetVersionId) as unknown as LifecycleEventRow[];
    return rows.map(parseLifecycleEventRow);
  }

  applyTransition(input: TransitionPersistenceInput): AssetVersionRecord {
    const event = LifecycleEventSchema.parse(input.event);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      input.validateCurrent?.();
      if (input.expectedFrom === "published" && input.toState === "deprecated") {
        this.database
          .prepare(`
            UPDATE assets
            SET current_published_version_id = NULL
            WHERE asset_id = ? AND current_published_version_id = ?
          `)
          .run(event.asset_id, input.assetVersionId);
      }

      const result = this.database
        .prepare(`
          UPDATE asset_versions
          SET lifecycle = ?,
              published_at = COALESCE(?, published_at),
              deprecated_at = ?,
              replacement_version = ?
          WHERE asset_version_id = ? AND lifecycle = ?
        `)
        .run(
          input.toState,
          input.publishedAt ?? null,
          input.deprecatedAt ?? null,
          input.replacementVersion ?? null,
          input.assetVersionId,
          input.expectedFrom,
        );
      if (Number(result.changes) !== 1) {
        throw new Error("Lifecycle state changed concurrently.");
      }

      if (input.toState === "published") {
        this.database
          .prepare(`
            UPDATE assets
            SET current_published_version_id = ?, updated_at = ?
            WHERE asset_id = ?
          `)
          .run(input.assetVersionId, event.timestamp, event.asset_id);
      } else if (input.toState === "deprecated") {
        this.database
          .prepare("UPDATE assets SET updated_at = ? WHERE asset_id = ?")
          .run(event.timestamp, event.asset_id);
      }

      this.insertLifecycleEventRow(event);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return this.requireVersion(input.assetVersionId);
  }

  private insertVersionRow(content: AssetVersionContent): void {
    this.database
      .prepare(`
        INSERT INTO asset_versions (
          asset_version_id, asset_id, version, content_json, subject_digest,
          lifecycle, published_at, deprecated_at, replacement_version, created_at
        ) VALUES (?, ?, ?, ?, NULL, 'draft', NULL, NULL, NULL, ?)
      `)
      .run(
        content.asset_version_id,
        content.asset_id,
        content.version,
        JSON.stringify(content),
        content.created_at,
      );
  }

  private insertLifecycleEventRow(event: LifecycleEvent): void {
    this.database
      .prepare(`
        INSERT INTO lifecycle_events (
          event_id, asset_id, asset_version_id, from_state, to_state,
          actor_type, actor_name, reason, evidence_ids_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.event_id,
        event.asset_id,
        event.asset_version_id,
        event.from_state ?? null,
        event.to_state,
        event.actor_type,
        event.actor_name ?? null,
        event.reason,
        JSON.stringify(event.evidence_ids),
        event.timestamp,
      );
  }

  private requireVersion(assetVersionId: string): AssetVersionRecord {
    const record = this.getVersionById(assetVersionId);
    if (record === null) {
      throw new Error(`Asset version ${assetVersionId} was not persisted.`);
    }
    return record;
  }

  private requireEvidence(evidenceId: string): Evidence {
    const row = this.database
      .prepare(`
        SELECT evidence_id, asset_id, asset_version_id, evidence_type, result,
               subject_digest, record_json, timestamp
        FROM evidence
        WHERE evidence_id = ?
      `)
      .get(evidenceId) as unknown as EvidenceRow | undefined;
    if (row === undefined) {
      throw new Error(`Evidence ${evidenceId} was not persisted.`);
    }
    return parseEvidenceRow(row);
  }
}
