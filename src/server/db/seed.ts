import { isDeepStrictEqual } from "node:util";

import bootstrapFixture from "../../../fixtures/catalog/bootstrap-draft.json";
import bootstrapLifecycleEventFixture from "../../../fixtures/contracts/lifecycle-event.json";
import {
  AssetVersionContentSchema,
  LifecycleEventSchema,
  parseAssetVersionRecord,
  type AssetVersionRecord,
  type LifecycleEvent,
} from "../../contracts";
import { CatalogRepository } from "../../modules/catalog/repository";
import { seedReferenceCatalog } from "./seed-demo";
import type { MarketplaceDatabase } from "./connection";
import { migrateDatabase } from "./migrate";

export const BOOTSTRAP_ASSET_ID = "asset_property_ops_brief";
export const BOOTSTRAP_ASSET_VERSION_ID =
  "av_property_ops_brief_0_1_0_draft_1";
export const BOOTSTRAP_LIFECYCLE_EVENT_ID = "event_bootstrap_draft_created";

export function getBootstrapRecord(): AssetVersionRecord {
  return parseAssetVersionRecord(bootstrapFixture);
}

export function getBootstrapLifecycleEvent(): LifecycleEvent {
  return LifecycleEventSchema.parse(bootstrapLifecycleEventFixture);
}

export function seedDatabase(database: MarketplaceDatabase): AssetVersionRecord {
  migrateDatabase(database);
  const record = getBootstrapRecord();
  const lifecycleEvent = getBootstrapLifecycleEvent();
  if (
    lifecycleEvent.asset_id !== record.asset.asset_id ||
    lifecycleEvent.asset_version_id !== record.asset_version.asset_version_id ||
    lifecycleEvent.to_state !== record.asset_version.lifecycle
  ) {
    throw new Error("Bootstrap record and lifecycle-event fixture identities disagree.");
  }
  const {
    lifecycle,
    subject_digest,
    published_at,
    deprecated_at,
    replacement_version,
    ...contentValue
  } = record.asset_version;
  const content = AssetVersionContentSchema.parse(contentValue);

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(`
        INSERT INTO assets (
          asset_id,
          slug,
          current_published_version_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (asset_id) DO NOTHING
      `)
      .run(
        record.asset.asset_id,
        record.asset.slug,
        record.asset.current_published_version_id ?? null,
        record.asset.created_at,
        record.asset.updated_at,
      );

    database
      .prepare(`
        INSERT INTO asset_versions (
          asset_version_id,
          asset_id,
          version,
          content_json,
          subject_digest,
          lifecycle,
          published_at,
          deprecated_at,
          replacement_version,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (asset_version_id) DO NOTHING
      `)
      .run(
        record.asset_version.asset_version_id,
        record.asset_version.asset_id,
        record.asset_version.version,
        JSON.stringify(content),
        subject_digest,
        lifecycle,
        published_at,
        deprecated_at,
        replacement_version,
        record.asset_version.created_at,
      );

    database
      .prepare(`
        INSERT INTO lifecycle_events (
          event_id,
          asset_id,
          asset_version_id,
          from_state,
          to_state,
          actor_type,
          actor_name,
          reason,
          evidence_ids_json,
          timestamp
        ) VALUES (?, ?, ?, NULL, 'draft', 'system', NULL, ?, '[]', ?)
        ON CONFLICT (event_id) DO NOTHING
      `)
      .run(
        lifecycleEvent.event_id,
        lifecycleEvent.asset_id,
        lifecycleEvent.asset_version_id,
        lifecycleEvent.reason,
        lifecycleEvent.timestamp,
      );

    const persisted = new CatalogRepository(database).getAdminVersionById(
      BOOTSTRAP_ASSET_VERSION_ID,
    );
    if (persisted === null || !isDeepStrictEqual(persisted, record)) {
      throw new Error(
        "Bootstrap seed identifiers already exist with content that differs from the canonical fixture.",
      );
    }

    const lifecycleRow = database
      .prepare(`
        SELECT
          event_id,
          asset_id,
          asset_version_id,
          from_state,
          to_state,
          actor_type,
          actor_name,
          reason,
          evidence_ids_json,
          timestamp
        FROM lifecycle_events
        WHERE event_id = ?
      `)
      .get(BOOTSTRAP_LIFECYCLE_EVENT_ID) as
      | {
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
      | undefined;
    if (lifecycleRow === undefined) {
      throw new Error("Bootstrap lifecycle event was not persisted.");
    }
    const { evidence_ids_json, actor_name, ...lifecycleValues } = lifecycleRow;
    const persistedLifecycleEvent = LifecycleEventSchema.parse({
      ...lifecycleValues,
      evidence_ids: JSON.parse(evidence_ids_json),
      ...(actor_name === null ? {} : { actor_name }),
    });
    if (!isDeepStrictEqual(persistedLifecycleEvent, lifecycleEvent)) {
      throw new Error(
        "Bootstrap lifecycle event differs from the canonical lifecycle fixture.",
      );
    }

    database.exec("COMMIT");
    return persisted;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Seeds the curated published reference catalog (no hero, no executions). */
export function seedPublishedCatalog(database: MarketplaceDatabase): void {
  seedReferenceCatalog(database);
}
