import {
  AssetVersionRecordSchema,
  type AssetVersionRecord,
} from "../../contracts";
import type { MarketplaceDatabase } from "../../server/db/connection";

interface CatalogRow {
  asset_id: string;
  slug: string;
  current_published_version_id: string | null;
  asset_created_at: string;
  asset_updated_at: string;
  asset_version_id: string;
  version: string;
  content_json: string;
  subject_digest: string | null;
  lifecycle: string;
  published_at: string | null;
  deprecated_at: string | null;
  replacement_version: string | null;
}

const SELECT_RECORD = `
  SELECT
    a.asset_id,
    a.slug,
    a.current_published_version_id,
    a.created_at AS asset_created_at,
    a.updated_at AS asset_updated_at,
    v.asset_version_id,
    v.version,
    v.content_json,
    v.subject_digest,
    v.lifecycle,
    v.published_at,
    v.deprecated_at,
    v.replacement_version
  FROM assets a
  JOIN asset_versions v ON v.asset_id = a.asset_id
`;

function parseRow(row: CatalogRow): AssetVersionRecord {
  const content: unknown = JSON.parse(row.content_json);

  return AssetVersionRecordSchema.parse({
    asset: {
      asset_id: row.asset_id,
      slug: row.slug,
      current_published_version_id: row.current_published_version_id,
      created_at: row.asset_created_at,
      updated_at: row.asset_updated_at,
    },
    asset_version: {
      ...(typeof content === "object" && content !== null ? content : {}),
      asset_version_id: row.asset_version_id,
      asset_id: row.asset_id,
      version: row.version,
      subject_digest: row.subject_digest,
      lifecycle: row.lifecycle,
      published_at: row.published_at,
      deprecated_at: row.deprecated_at,
      replacement_version: row.replacement_version,
    },
  });
}

export class CatalogRepository {
  constructor(private readonly database: MarketplaceDatabase) {}

  getAdminVersionById(assetVersionId: string): AssetVersionRecord | null {
    const row = this.database
      .prepare(`${SELECT_RECORD} WHERE v.asset_version_id = ?`)
      .get(assetVersionId) as unknown as CatalogRow | undefined;

    return row === undefined ? null : parseRow(row);
  }

  listPublished(): AssetVersionRecord[] {
    const rows = this.database
      .prepare(`
        ${SELECT_RECORD}
        WHERE v.lifecycle = 'published'
          AND v.deprecated_at IS NULL
          AND a.current_published_version_id = v.asset_version_id
        ORDER BY json_extract(v.content_json, '$.name') COLLATE NOCASE, v.asset_version_id
      `)
      .all() as unknown as CatalogRow[];

    return rows.map(parseRow);
  }
}
