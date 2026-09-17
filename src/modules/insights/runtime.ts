import type {
  AlternativesResult,
  AssetVersionRecord,
  Comparison,
  ImpactActionKey,
  ImpactGraph,
  ImpactPreview,
  MarketplaceMetrics,
  ReuseIntelligence,
  TrustDrift,
} from "@/contracts";
import { CatalogRepository } from "@/modules/catalog/repository";
import { normalizeIntent, retrievePublished } from "@/modules/discovery";
import { ExecutionRepository, serverExecutorRegistry } from "@/modules/execution";
import { loadPersistedReuseComparison } from "@/modules/execution/reuse-runtime";
import { buildGovernanceProjection } from "@/modules/governance";
import { GovernanceRepository } from "@/modules/governance/repository";
import { computeTrustScore } from "@/modules/investigation";
import { closeDatabase, openDatabase, type MarketplaceDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

import {
  buildAlternatives,
  buildComparison,
  buildMarketplaceMetrics,
  buildReuseIntelligence,
  detectTrustDrift,
  type AlternativeCandidate,
  type CompareInput,
  type DriftCandidate,
} from "./analysis";
import { buildImpactGraph } from "./graph";
import { buildImpactPreview } from "./impact";

function withDatabase<T>(path: string | undefined, operation: (database: MarketplaceDatabase) => T): T {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    return operation(database);
  } finally {
    closeDatabase(database);
  }
}

function isCurrentPublished(record: AssetVersionRecord): boolean {
  return (
    record.asset_version.lifecycle === "published" &&
    record.asset_version.deprecated_at === null &&
    record.asset.current_published_version_id === record.asset_version.asset_version_id
  );
}

/** Ranks published assets covering the same capability text, using the discovery ranker. */
function relatedTo(
  record: AssetVersionRecord,
  published: AssetVersionRecord[],
): { record: AssetVersionRecord; similarity: number; matchedCapabilities: string[] }[] {
  const version = record.asset_version;
  // Capability and use-case text only: the long prose summary dilutes the ranker.
  const queryText = [...version.capabilities, ...version.use_cases, ...version.domains].join(". ");
  const intent = normalizeIntent({ query: queryText });
  const first = intent.intents[0];
  if (!first) return [];

  return retrievePublished(published, first, {})
    .filter(
      (candidate) =>
        candidate.record.asset_version.asset_version_id !== version.asset_version_id &&
        candidate.score > 0.05,
    )
    .map((candidate) => ({
      record: candidate.record,
      similarity: Math.min(99, Math.round(candidate.score * 100)),
      matchedCapabilities: candidate.evidence
        .filter((item) => item.field === "capabilities" || item.field === "use_cases")
        .map((item) => item.catalogValue)
        .slice(0, 3),
    }));
}

function newestEvidence(rows: { timestamp: string }[]): string | null {
  return (
    [...rows]
      .map((row) => row.timestamp)
      .sort()
      .at(-1) ?? null
  );
}

export function loadImpactPreview(
  assetVersionId: string,
  action: ImpactActionKey,
  path?: string,
): ImpactPreview | null {
  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const record = governance.getVersionById(assetVersionId);
    if (record === null) return null;

    const evidence = governance.listEvidence(assetVersionId);
    const publishedCount = new CatalogRepository(database).listPublished().length;

    return buildImpactPreview(
      {
        record,
        evidence,
        executions: new ExecutionRepository(database).listByAssetVersionId(assetVersionId),
        projection: buildGovernanceProjection(record, evidence, serverExecutorRegistry, new ExecutionRepository(database)),
        publishedCount,
      },
      action,
    );
  });
}

export function loadImpactGraph(assetVersionId: string, path?: string): ImpactGraph | null {
  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const record = governance.getVersionById(assetVersionId);
    if (record === null) return null;

    const evidence = governance.listEvidence(assetVersionId);
    const projection = buildGovernanceProjection(record, evidence, serverExecutorRegistry, new ExecutionRepository(database));
    const published = new CatalogRepository(database).listPublished();

    return buildImpactGraph({
      record,
      assessments: projection.evidence,
      executions: new ExecutionRepository(database).listByAssetVersionId(assetVersionId),
      related: relatedTo(record, published).slice(0, 3).map((item) => ({
        asset_version_id: item.record.asset_version.asset_version_id,
        name: item.record.asset_version.name,
        similarity: item.similarity,
      })),
      siblings: governance
        .listVersions()
        .filter(
          (candidate) =>
            candidate.asset.asset_id === record.asset.asset_id &&
            candidate.asset_version.asset_version_id !== assetVersionId &&
            candidate.asset_version.published_at !== null,
        ),
    });
  });
}

export function loadAlternatives(
  assetVersionId: string,
  path?: string,
  now: Date = new Date(),
): AlternativesResult | null {
  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const record = governance.getVersionById(assetVersionId);
    if (record === null) return null;

    const subjectTrust = computeTrustScore(
      buildGovernanceProjection(
        record,
        governance.listEvidence(assetVersionId),
        serverExecutorRegistry,
        new ExecutionRepository(database),
      ),
      now,
    );
    const published = new CatalogRepository(database).listPublished();

    const candidates: AlternativeCandidate[] = relatedTo(record, published).map((item) => {
      const evidence = governance.listEvidence(item.record.asset_version.asset_version_id);
      return {
        record: item.record,
        similarity: item.similarity,
        matchedCapabilities: item.matchedCapabilities,
        trust: computeTrustScore(
          buildGovernanceProjection(
            item.record,
            evidence,
            serverExecutorRegistry,
            new ExecutionRepository(database),
          ),
          now,
        ),
        lastReviewed: newestEvidence(evidence),
      };
    });

    return buildAlternatives({ assetVersionId, trust: subjectTrust }, candidates, now);
  });
}

export function loadReuseIntelligence(
  assetVersionId: string,
  path?: string,
): ReuseIntelligence | null {
  return withDatabase(path, (database) => {
    const record = new GovernanceRepository(database).getVersionById(assetVersionId);
    if (record === null) return null;

    const executions = new ExecutionRepository(database).listByAssetVersionId(assetVersionId);
    const reuse =
      record.asset_version.availability === "runnable"
        ? loadPersistedReuseComparison(record.asset_version, path).available
        : false;

    return buildReuseIntelligence(assetVersionId, executions, reuse);
  });
}

export function loadTrustDrift(path?: string, now: Date = new Date()): TrustDrift {
  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const versions = governance.listVersions();
    const current = versions.filter(isCurrentPublished);

    const candidates: DriftCandidate[] = current.map((record) => {
      const assetVersionId = record.asset_version.asset_version_id;
      const evidence = governance.listEvidence(assetVersionId);
      const projection = buildGovernanceProjection(record, evidence, serverExecutorRegistry, new ExecutionRepository(database));
      const trust = computeTrustScore(projection, now);
      const newest = newestEvidence(evidence);

      const previousRecord =
        versions
          .filter(
            (candidate) =>
              candidate.asset.asset_id === record.asset.asset_id &&
              candidate.asset_version.asset_version_id !== assetVersionId &&
              candidate.asset_version.published_at !== null,
          )
          .sort((left, right) =>
            String(right.asset_version.published_at).localeCompare(
              String(left.asset_version.published_at),
            ),
          )
          .at(0) ?? null;

      return {
        record,
        trust,
        events: governance.listLifecycleEvents(assetVersionId),
        evidence,
        trustAtNewestEvidence:
          newest === null
            ? null
            : {
                score: computeTrustScore(projection, new Date(newest)).score,
                timestamp: newest,
              },
        previous:
          previousRecord === null
            ? null
            : {
                record: previousRecord,
                trust: computeTrustScore(
                  buildGovernanceProjection(
                    previousRecord,
                    governance.listEvidence(previousRecord.asset_version.asset_version_id),
                    serverExecutorRegistry,
                    new ExecutionRepository(database),
                  ),
                  now,
                ),
              },
      };
    });

    return detectTrustDrift(candidates, now);
  });
}

export function loadComparison(
  assetVersionIds: readonly string[],
  path?: string,
  now: Date = new Date(),
): Comparison | null {
  if (assetVersionIds.length < 2) return null;

  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const executions = new ExecutionRepository(database);
    const published = new CatalogRepository(database).listPublished();

    const subjectRecord = governance.getVersionById(assetVersionIds[0]!);
    const related = subjectRecord === null ? [] : relatedTo(subjectRecord, published);

    const inputs: CompareInput[] = [];
    for (const [index, id] of assetVersionIds.entries()) {
      const record = governance.getVersionById(id);
      if (record === null) return null;
      const evidence = governance.listEvidence(id);
      const projection = buildGovernanceProjection(record, evidence, serverExecutorRegistry, new ExecutionRepository(database));
      inputs.push({
        record,
        trust: computeTrustScore(projection, now),
        projection,
        lastReviewed: newestEvidence(evidence),
        executions: executions.listByAssetVersionId(id).length,
        similarity:
          index === 0
            ? null
            : (related.find(
                (item) => item.record.asset_version.asset_version_id === id,
              )?.similarity ?? null),
      });
    }

    return buildComparison(inputs, now);
  });
}

export function loadMarketplaceMetrics(
  path?: string,
  now: Date = new Date(),
): MarketplaceMetrics {
  return withDatabase(path, (database) => {
    const governance = new GovernanceRepository(database);
    const executions = new ExecutionRepository(database);

    const summaries = governance
      .listVersions()
      .filter(isCurrentPublished)
      .map((record) => {
        const assetVersionId = record.asset_version.asset_version_id;
        const projection = buildGovernanceProjection(
          record,
          governance.listEvidence(assetVersionId),
          serverExecutorRegistry,
          executions,
        );
        return {
          record,
          projection,
          trust: computeTrustScore(projection, now),
          executions: executions.listByAssetVersionId(assetVersionId),
        };
      });

    return buildMarketplaceMetrics({ summaries });
  });
}
