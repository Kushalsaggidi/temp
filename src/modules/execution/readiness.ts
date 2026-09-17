import {
  AssetVersionContentSchema,
  JSONValueSchema,
} from "@/contracts";
import { CatalogRepository } from "@/modules/catalog/repository";
import type { MarketplaceDatabase } from "@/server/db/connection";
import { computeSubjectDigest, sha256Digest } from "@/shared/integrity";

import type { VerifiedExecutorRegistry } from "./service";

interface RunnableVersionRow {
  asset_version_id: string;
}

/**
 * Startup/service-initialization gate for every catalog version that declares
 * itself runnable. Per-run checks repeat the same binding immediately before
 * execution.
 */
export function assertExecutionCatalogReadiness(
  database: MarketplaceDatabase,
  registry: VerifiedExecutorRegistry,
): void {
  registry.assertReady();
  const rows = database
    .prepare(`
      SELECT asset_version_id
      FROM asset_versions
      WHERE json_extract(content_json, '$.availability') = 'runnable'
      ORDER BY asset_version_id
    `)
    .all() as unknown as RunnableVersionRow[];
  const catalog = new CatalogRepository(database);

  for (const row of rows) {
    const record = catalog.getAdminVersionById(row.asset_version_id);
    if (record === null) {
      throw new Error("Runnable catalog version could not be loaded.");
    }
    const version = record.asset_version;
    if (!version.executor_key || !version.definition_digest) {
      throw new Error("Runnable catalog version lacks reviewed executor metadata.");
    }
    const executor = registry.resolveVerified(version.executor_key);
    if (!executor) {
      throw new Error("Runnable catalog version references a non-allowlisted executor.");
    }
    const inputDigest = sha256Digest(JSONValueSchema.parse(version.input_schema));
    const outputDigest = sha256Digest(JSONValueSchema.parse(version.output_schema));
    if (
      executor.key !== version.executor_key ||
      executor.definitionDigest !== version.definition_digest ||
      executor.executionMode !== version.execution_kind ||
      executor.manifest.input_schema_digest !== inputDigest ||
      executor.manifest.output_schema_digest !== outputDigest ||
      executor.manifest.behavior_config_digest === null ||
      executor.modelOrConfig.configuration_digest !==
        executor.manifest.behavior_config_digest ||
      executor.policy.networkAccess !== "none" ||
      executor.policy.filesystemAccess !== "none" ||
      executor.policy.productionSideEffects ||
      executor.policy.outboundIntegrations.length !== 0
    ) {
      throw new Error(
        "Runnable catalog version does not match its reviewed executor definition.",
      );
    }

    if (version.subject_digest !== null) {
      const {
        lifecycle: _lifecycle,
        subject_digest: _subjectDigest,
        published_at: _publishedAt,
        deprecated_at: _deprecatedAt,
        replacement_version: _replacementVersion,
        ...contentValue
      } = version;
      const recomputedSubject = computeSubjectDigest(
        AssetVersionContentSchema.parse(contentValue),
      );
      if (recomputedSubject !== version.subject_digest) {
        throw new Error(
          "Runnable catalog version does not match its frozen subject digest.",
        );
      }
    }
  }
}
