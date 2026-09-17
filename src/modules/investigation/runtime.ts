import type { AssetVersionRecord, Evidence, InvestigationReport, TrustScore } from "@/contracts";
import { buildGovernanceProjection } from "@/modules/governance";
import { GovernanceRepository } from "@/modules/governance/repository";
import { ExecutionRepository, serverExecutorRegistry } from "@/modules/execution";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

import { GeminiInvestigationAdapter } from "./ai";
import { buildInvestigationReport, type InvestigationSubject } from "./service";
import { computeTrustScore } from "./trust";

export interface AssetTrustSummary {
  record: AssetVersionRecord;
  trust: TrustScore;
  /** Newest non-superseded evidence timestamp, or null when none exists. */
  last_reviewed: string | null;
  blocking_gates: string[];
}

function newestTimestamp(evidence: readonly Evidence[]): string | null {
  return (
    [...evidence]
      .map((item) => item.timestamp)
      .sort()
      .at(-1) ?? null
  );
}

function summarize(
  record: AssetVersionRecord,
  evidence: Evidence[],
  now: Date,
  executions: ExecutionRepository,
): AssetTrustSummary {
  const projection = buildGovernanceProjection(
    record,
    evidence,
    serverExecutorRegistry,
    executions,
  );
  return {
    record,
    trust: computeTrustScore(projection, now),
    last_reviewed: newestTimestamp(evidence),
    blocking_gates: projection.gates
      .filter((gate) => gate.status === "missing" || gate.status === "failed" || gate.status === "stale")
      .map((gate) => gate.label),
  };
}

/**
 * Trust summaries for every current published version, used by the overview and
 * the marketplace. Reads only; it never writes or infers.
 */
export async function listPublishedTrustSummaries(
  path?: string,
  now: Date = new Date(),
): Promise<AssetTrustSummary[]> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const repository = new GovernanceRepository(database);
    return repository
      .listVersions()
      .filter(
        (record) =>
          record.asset_version.lifecycle === "published" &&
          record.asset_version.deprecated_at === null &&
          record.asset.current_published_version_id === record.asset_version.asset_version_id,
      )
      .map((record) =>
        summarize(
          record,
          repository.listEvidence(record.asset_version.asset_version_id),
          now,
          new ExecutionRepository(database),
        ),
      )
      .sort((left, right) => left.trust.score - right.trust.score);
  } finally {
    closeDatabase(database);
  }
}

export async function loadTrustSummary(
  assetVersionId: string,
  path?: string,
  now: Date = new Date(),
): Promise<AssetTrustSummary | null> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const repository = new GovernanceRepository(database);
    const record = repository.getVersionById(assetVersionId);
    if (record === null) return null;
    return summarize(
      record,
      repository.listEvidence(assetVersionId),
      now,
      new ExecutionRepository(database),
    );
  } finally {
    closeDatabase(database);
  }
}

function loadSubject(
  repository: GovernanceRepository,
  executions: ExecutionRepository,
  assetVersionId: string,
): InvestigationSubject | null {
  const record = repository.getVersionById(assetVersionId);
  if (record === null) return null;

  // The previous published version of the same asset, if the asset has one.
  const siblings = repository
    .listVersions()
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
    );
  const previousRecord = siblings.at(0) ?? null;

  return {
    record,
    evidence: repository.listEvidence(assetVersionId),
    executions: executions.listByAssetVersionId(assetVersionId),
    previous:
      previousRecord === null
        ? null
        : {
            record: previousRecord,
            evidence: repository.listEvidence(
              previousRecord.asset_version.asset_version_id,
            ),
          },
  };
}

/**
 * Produces the investigation report for one asset version. The optional model
 * supplies interpretation only; every fact comes from persisted records.
 */
export async function investigateAssetVersion(
  assetVersionId: string,
  path?: string,
  now: Date = new Date(),
): Promise<InvestigationReport | null> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const subject = loadSubject(
      new GovernanceRepository(database),
      new ExecutionRepository(database),
      assetVersionId,
    );
    if (subject === null) return null;
    return await buildInvestigationReport(subject, {
      executorLookup: serverExecutorRegistry,
      executionReader: new ExecutionRepository(database),
      provider: new GeminiInvestigationAdapter(),
      now,
    });
  } finally {
    closeDatabase(database);
  }
}
