import type {
  AssetVersionRecord,
  Evidence,
  EvidenceReference,
  ExecutionRecord,
  LifecycleEvent,
  OperatorAssetCard,
  OperatorSystemState,
  TrustScore,
} from "@/contracts";
import { OperatorSystemStateSchema } from "@/contracts";
import { CatalogRepository } from "@/modules/catalog/repository";
import { ExecutionRepository, serverExecutorRegistry } from "@/modules/execution";
import {
  buildGovernanceProjection,
  type GovernanceProjection,
} from "@/modules/governance";
import { GovernanceRepository } from "@/modules/governance/repository";
import { computeTrustScore } from "@/modules/investigation";
import { loadTrustDrift } from "@/modules/insights";
import {
  closeDatabase,
  openDatabase,
  type MarketplaceDatabase,
} from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";

import { AGENTS } from "./agents";

/** One open/migrate/close cycle, matching how every other module reads. */
export function withOperatorDatabase<T>(
  operation: (database: MarketplaceDatabase) => T,
  path?: string,
): T {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    return operation(database);
  } finally {
    closeDatabase(database);
  }
}

export interface AssetSnapshot {
  record: AssetVersionRecord;
  evidence: Evidence[];
  executions: ExecutionRecord[];
  events: LifecycleEvent[];
  projection: GovernanceProjection;
  trust: TrustScore;
  lastReviewed: string | null;
  blockingGates: string[];
  isCurrentPublished: boolean;
}

const EVIDENCE_TONE: Record<string, EvidenceReference["tone"]> = {
  passed: "positive",
  not_applicable: "positive",
  informational: "neutral",
  stale_digest: "warning",
  stale_artifact: "warning",
  superseded: "neutral",
  failed: "negative",
};

export function isCurrentPublished(record: AssetVersionRecord): boolean {
  return (
    record.asset_version.lifecycle === "published" &&
    record.asset_version.deprecated_at === null &&
    record.asset.current_published_version_id === record.asset_version.asset_version_id
  );
}

function newest(values: readonly { timestamp: string }[]): string | null {
  return (
    [...values]
      .map((value) => value.timestamp)
      .sort()
      .at(-1) ?? null
  );
}

export function snapshotFor(
  database: MarketplaceDatabase,
  record: AssetVersionRecord,
  now: Date = new Date(),
): AssetSnapshot {
  const governance = new GovernanceRepository(database);
  const executions = new ExecutionRepository(database);
  const assetVersionId = record.asset_version.asset_version_id;
  const evidence = governance.listEvidence(assetVersionId);
  const projection = buildGovernanceProjection(
    record,
    evidence,
    serverExecutorRegistry,
    executions,
  );
  return {
    record,
    evidence,
    executions: executions.listByAssetVersionId(assetVersionId),
    events: governance.listLifecycleEvents(assetVersionId),
    projection,
    trust: computeTrustScore(projection, now),
    lastReviewed: newest(evidence),
    blockingGates: projection.gates
      .filter(
        (gate) =>
          gate.status === "missing" || gate.status === "failed" || gate.status === "stale",
      )
      .map((gate) => gate.label),
    isCurrentPublished: isCurrentPublished(record),
  };
}

export function loadSnapshot(
  database: MarketplaceDatabase,
  assetVersionId: string,
  now: Date = new Date(),
): AssetSnapshot | null {
  const record = new GovernanceRepository(database).getVersionById(assetVersionId);
  return record === null ? null : snapshotFor(database, record, now);
}

export function listPublishedRecords(database: MarketplaceDatabase): AssetVersionRecord[] {
  return new CatalogRepository(database).listPublished();
}

export function listAllRecords(database: MarketplaceDatabase): AssetVersionRecord[] {
  return new GovernanceRepository(database).listVersions();
}

/**
 * The one card shape every visual answer uses. Trust and execution counts are
 * optional because a search result may legitimately be assembled before the
 * governance projection has been computed for each candidate.
 */
export function toAssetCard(
  record: AssetVersionRecord,
  options: {
    trust?: TrustScore | null;
    lastReviewed?: string | null;
    blockingGates?: readonly string[];
    matchedFields?: readonly string[];
    rationale?: readonly string[];
    executions?: number | null;
  } = {},
): OperatorAssetCard {
  const version = record.asset_version;
  return {
    asset_version_id: version.asset_version_id,
    asset_id: version.asset_id,
    name: version.name,
    summary: version.summary,
    owner: version.owner,
    version: version.version,
    asset_type: version.asset_type,
    availability: version.availability,
    lifecycle: version.lifecycle,
    trust: options.trust ?? null,
    last_reviewed: options.lastReviewed ?? null,
    blocking_gates: [...(options.blockingGates ?? [])],
    matched_fields: [...(options.matchedFields ?? [])],
    rationale: [...(options.rationale ?? [])],
    executions: options.executions ?? null,
    href: `/assets/${version.asset_version_id}`,
  };
}

export function cardFromSnapshot(
  snapshot: AssetSnapshot,
  extra: { matchedFields?: readonly string[]; rationale?: readonly string[] } = {},
): OperatorAssetCard {
  return toAssetCard(snapshot.record, {
    trust: snapshot.trust,
    lastReviewed: snapshot.lastReviewed,
    blockingGates: snapshot.blockingGates,
    executions: snapshot.executions.length,
    matchedFields: extra.matchedFields,
    rationale: extra.rationale,
  });
}

export function evidenceReferences(
  snapshot: AssetSnapshot,
  limit = 10,
): EvidenceReference[] {
  const currentDigest = snapshot.record.asset_version.subject_digest;
  const assetVersionId = snapshot.record.asset_version.asset_version_id;
  return snapshot.projection.evidence.slice(0, limit).map((assessment) => ({
    evidence_id: assessment.evidence.evidence_id,
    evidence_type: assessment.evidence.evidence_type.replaceAll("_", " "),
    state: assessment.state,
    state_label: assessment.label,
    tone: EVIDENCE_TONE[assessment.state] ?? "neutral",
    subject_digest: assessment.evidence.subject_digest,
    digest_matches_current: assessment.evidence.subject_digest === currentDigest,
    timestamp: assessment.evidence.timestamp,
    reviewer:
      assessment.evidence.reviewer?.name ?? assessment.evidence.actor_name ?? null,
    summary: assessment.evidence.details.summary,
    scope: assessment.evidence.scope,
    href: `/governance/${assetVersionId}#evidence-${assessment.evidence.evidence_id}`,
  }));
}

/**
 * The live counters behind the console rails and the "SYSTEM LIVE" strip.
 * Everything is counted from persisted rows; nothing is estimated.
 */
export function loadSystemState(
  path?: string,
  now: Date = new Date(),
): OperatorSystemState {
  const drift = loadTrustDrift(path, now);

  return withOperatorDatabase((database) => {
    const governance = new GovernanceRepository(database);
    const executions = new ExecutionRepository(database);
    const all = governance.listVersions();

    let published = 0;
    let ready = 0;
    let runnable = 0;
    let attention = 0;
    let evidenceCount = 0;
    let executionCount = 0;
    let successfulExecutions = 0;

    for (const record of all) {
      const assetVersionId = record.asset_version.asset_version_id;
      const evidence = governance.listEvidence(assetVersionId);
      evidenceCount += evidence.length;
      const runs = executions.listByAssetVersionId(assetVersionId);
      executionCount += runs.length;
      successfulExecutions += runs.filter((run) => run.status === "succeeded").length;

      if (!isCurrentPublished(record)) continue;
      published += 1;
      if (record.asset_version.availability === "runnable") runnable += 1;
      const projection = buildGovernanceProjection(
        record,
        evidence,
        serverExecutorRegistry,
        executions,
      );
      const trust = computeTrustScore(projection, now);
      if (trust.band === "strong") ready += 1;
      if (
        projection.gates.some(
          (gate) =>
            gate.status === "missing" ||
            gate.status === "failed" ||
            gate.status === "stale",
        )
      ) {
        attention += 1;
      }
    }

    const inReview = all.filter((record) =>
      ["submitted", "in_review", "changes_requested"].includes(
        record.asset_version.lifecycle,
      ),
    ).length;
    const drafts = all.filter(
      (record) => record.asset_version.lifecycle === "draft",
    ).length;
    const deprecated = all.filter(
      (record) => record.asset_version.lifecycle === "deprecated",
    ).length;

    const signals: OperatorSystemState["signals"] = [];
    if (drift.entries.length > 0) {
      signals.push({
        tone: "warning",
        text: `Trust drift detected in ${drift.entries.length} ${drift.entries.length === 1 ? "asset" : "assets"}`,
        href: "/drift",
        utterance: "Which assets have changed trust recently?",
      });
    }
    if (attention > 0) {
      signals.push({
        tone: "warning",
        text: `${attention} published ${attention === 1 ? "asset has" : "assets have"} an incomplete required check`,
        href: "/governance",
        utterance: "Which assets need attention?",
      });
    }
    if (inReview > 0) {
      signals.push({
        tone: "brand",
        text: `${inReview} ${inReview === 1 ? "version is" : "versions are"} in the review queue`,
        href: "/governance",
        utterance: "What is in the review queue?",
      });
    }
    if (drafts > 0) {
      signals.push({
        tone: "neutral",
        text: `${drafts} ${drafts === 1 ? "draft is" : "drafts are"} not yet submitted`,
        href: "/governance",
        utterance: "What is in the review queue?",
      });
    }
    if (executionCount > 0) {
      signals.push({
        tone: "positive",
        text: `${successfulExecutions} of ${executionCount} saved runs succeeded`,
        href: null,
        utterance: "How often are these assets being used?",
      });
    }
    if (signals.length === 0) {
      signals.push({
        tone: "positive",
        text: "Every published asset has current checks covering the content people receive",
        href: "/marketplace",
        utterance: "Give me the marketplace overview",
      });
    }

    return OperatorSystemStateSchema.parse({
      generated_at: now.toISOString(),
      published,
      ready_to_use: ready,
      runnable,
      needs_attention: attention,
      drift_warnings: drift.entries.length,
      in_review: inReview,
      drafts,
      deprecated,
      executions: executionCount,
      successful_executions: successfulExecutions,
      evidence_records: evidenceCount,
      agents: AGENTS.length,
      signals: signals.slice(0, 6),
    });
  }, path);
}
