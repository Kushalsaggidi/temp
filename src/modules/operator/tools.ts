import type {
  AgentProfile,
  AlternativesResult,
  AssetVersionRecord,
  Comparison,
  DiscoveryResponse,
  EvidenceReference,
  ExecutionRecord,
  ImpactGraph,
  ImpactPreview,
  MarketplaceMetrics,
  OperatorAction,
  OperatorAssetCard,
  OperatorContext,
  OperatorFact,
  OperatorLink,
  OperatorSystemState,
  OperatorToolGroup,
  OperatorToolKind,
  ReuseIntelligence,
  ToolProfile,
  TrustDrift,
  TrustScore,
} from "@/contracts";
import { AssetVersionContentSchema } from "@/contracts";
import { CatalogRepository } from "@/modules/catalog/repository";
import { discover } from "@/modules/discovery";
import {
  ExecutionRepository,
  ExecutionService,
  assertExecutionCatalogReadiness,
  buildPersistedReuseComparison,
  serverExecutorRegistry,
} from "@/modules/execution";
import { GovernanceError, GovernanceService } from "@/modules/governance";
import { GovernanceRepository } from "@/modules/governance/repository";
import type { GovernanceGate, GovernanceProjection } from "@/modules/governance";
import {
  buildAlternatives,
  buildComparison,
  buildImpactGraph,
  buildImpactPreview,
  buildMarketplaceMetrics,
  buildReuseIntelligence,
} from "@/modules/insights";
import { loadTrustDrift } from "@/modules/insights";
import { buildInvestigationReport } from "@/modules/investigation";
import { GeminiInvestigationAdapter } from "@/modules/investigation/ai";
import type { InvestigationReport } from "@/contracts";
import type { MarketplaceDatabase } from "@/server/db/connection";
import { SystemClock } from "@/shared/ports/clock";
import { CryptoIdGenerator } from "@/shared/ports/id-generator";

import { AGENTS, findAgent } from "./agents";
import type { ProjectKnowledge } from "./knowledge";
import { buildProjectKnowledge } from "./knowledge";
import { rankByText } from "./resolve";
import {
  cardFromSnapshot,
  evidenceReferences,
  listPublishedRecords,
  loadSnapshot,
  loadSystemState,
  snapshotFor,
  toAssetCard,
  type AssetSnapshot,
} from "./state";

/* ------------------------------------------------------------------ *
 * Payloads. Each variant is what one capability actually returned; the
 * composer turns them into visual blocks.
 * ------------------------------------------------------------------ */

export interface ContributionDraftFields {
  slug: string;
  name: string;
  summary: string;
  owner: string;
  asset_type: "skill" | "workflow" | "agent" | "template" | "dashboard" | "plugin" | "other";
  version: string;
  description: string;
  capabilities: string[];
  use_cases: string[];
  domains: string[];
  audiences: string[];
  limitations: string[];
  usage_instructions: string;
  setup_expectations: string;
  maintenance_expectations: string;
}

export type OperatorPayload =
  | { type: "search"; query: string; response: DiscoveryResponse; cards: OperatorAssetCard[] }
  | {
      type: "asset";
      snapshot: AssetSnapshot;
      card: OperatorAssetCard;
      evidence: EvidenceReference[];
    }
  | { type: "investigation"; report: InvestigationReport }
  | {
      type: "trust";
      assetVersionId: string;
      name: string;
      trust: TrustScore;
      blocking: string[];
      lastReviewed: string | null;
      gates: GovernanceGate[];
    }
  | {
      type: "evidence";
      assetVersionId: string;
      name: string;
      items: EvidenceReference[];
      total: number;
    }
  | {
      type: "lifecycle";
      assetVersionId: string;
      name: string;
      snapshot: AssetSnapshot;
    }
  | {
      type: "governance";
      assetVersionId: string;
      name: string;
      projection: GovernanceProjection;
      lifecycle: string;
      trust: TrustScore;
    }
  | {
      type: "queue";
      items: { card: OperatorAssetCard; blocking: string[]; canPublish: boolean }[];
      counts: { draft: number; submitted: number; in_review: number; changes_requested: number };
    }
  | { type: "impact_graph"; graph: ImpactGraph; name: string }
  | { type: "alternatives"; result: AlternativesResult; subjectName: string }
  | { type: "comparison"; comparison: Comparison }
  | { type: "reuse"; name: string; reuse: ReuseIntelligence }
  | { type: "drift"; drift: TrustDrift }
  | { type: "overview"; metrics: MarketplaceMetrics; state: OperatorSystemState }
  | {
      type: "executions";
      assetVersionId: string;
      name: string;
      records: ExecutionRecord[];
    }
  | { type: "execution"; record: ExecutionRecord; name: string }
  | { type: "agents"; items: AgentProfile[]; title: string }
  | { type: "knowledge"; knowledge: ProjectKnowledge; topic: string | null }
  | { type: "capabilities"; tools: ToolProfile[] }
  | { type: "action"; action: OperatorAction }
  | {
      type: "contribution";
      draft: ContributionDraftFields;
      duplicates: OperatorAssetCard[];
      aiAssisted: boolean;
      aiNote: string | null;
    }
  | {
      type: "completed";
      title: string;
      detail: string;
      assetVersionId: string | null;
      facts: OperatorFact[];
      verified: boolean;
      links: OperatorLink[];
    }
  | {
      type: "blocked";
      title: string;
      reason: string;
      detail: string[];
      links: OperatorLink[];
    };

export interface ToolOutcome {
  payload: OperatorPayload;
  summary: string;
  ok: boolean;
}

export interface ToolContext {
  database: MarketplaceDatabase;
  now: Date;
  context: OperatorContext;
  /** Resolved by the service before the tool runs, so tools never re-resolve. */
  asset: AssetVersionRecord | null;
  secondAsset: AssetVersionRecord | null;
  query: string;
  utterance: string;
}

export type ToolArgs = Record<string, unknown>;

export interface OperatorToolDefinition {
  name: string;
  group: OperatorToolGroup;
  kind: OperatorToolKind;
  summary: string;
  backedBy: string;
  /** True when the tool needs an asset resolved before it can run. */
  needsAsset: boolean;
  /** True when the tool can use an asset if one is in context, but works without. */
  usesAsset?: boolean;
  available: boolean;
  unavailableReason: string | null;
  /** Read tools answer here. Write tools return their action preview here. */
  run(args: ToolArgs, ctx: ToolContext): Promise<ToolOutcome>;
  /** Write tools only: runs after explicit human confirmation. */
  execute?(args: ToolArgs, ctx: ToolContext): Promise<ToolOutcome>;
}

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

const ok = (payload: OperatorPayload, summary: string): ToolOutcome => ({
  payload,
  summary,
  ok: true,
});

const blocked = (
  title: string,
  reason: string,
  detail: string[] = [],
  links: OperatorLink[] = [],
): ToolOutcome => ({
  payload: { type: "blocked", title, reason, detail, links },
  summary: reason,
  ok: false,
});

const NO_ASSET = blocked(
  "I could not tell which asset you meant",
  "Nothing in the catalogue matched that wording, and no asset is open on this page.",
  ["Name the asset, or open it and ask again."],
  [{ label: "Browse the marketplace", href: "/marketplace" }],
);

function requireSnapshot(ctx: ToolContext): AssetSnapshot | null {
  if (ctx.asset === null) return null;
  return snapshotFor(ctx.database, ctx.asset, ctx.now);
}

function governanceService(database: MarketplaceDatabase): GovernanceService {
  return new GovernanceService(
    new GovernanceRepository(database),
    new SystemClock(),
    new CryptoIdGenerator(),
    serverExecutorRegistry,
    new ExecutionRepository(database),
  );
}

function fact(
  label: string,
  value: string,
  tone: OperatorFact["tone"] = "neutral",
  hint: string | null = null,
): OperatorFact {
  return { label, value, tone, hint };
}

function assetLinks(snapshot: AssetSnapshot): OperatorLink[] {
  const id = snapshot.record.asset_version.asset_version_id;
  return [
    { label: "Open asset", href: `/assets/${id}` },
    { label: "Governance record", href: `/governance/${id}` },
  ];
}

function governanceSummary(
  projection: GovernanceProjection,
): { passing: number; required: number; blocking: string[] } {
  const required = projection.gates.filter((gate) => gate.status !== "not_required");
  return {
    passing: required.filter((gate) => gate.status === "passed").length,
    required: required.length,
    blocking: required
      .filter((gate) => gate.status !== "passed")
      .map((gate) => `${gate.label}: ${gate.status}`),
  };
}

function previewFor(
  snapshot: AssetSnapshot,
  action: "flag_for_review" | "metadata_validation" | "publish" | "submit_for_review",
  database: MarketplaceDatabase,
): ImpactPreview {
  return buildImpactPreview(
    {
      record: snapshot.record,
      evidence: snapshot.evidence,
      executions: snapshot.executions,
      projection: snapshot.projection,
      publishedCount: new CatalogRepository(database).listPublished().length,
    },
    action,
  );
}

/** The reviewer the governance service will require for publication. */
function publishingReviewer(snapshot: AssetSnapshot): string | null {
  return (
    snapshot.projection.evidence.find(
      (item) =>
        item.evidence.evidence_type === "human_review" && item.state === "passed",
    )?.evidence.reviewer?.name ?? null
  );
}

function governanceFailure(error: unknown, fallbackTitle: string): ToolOutcome {
  if (error instanceof GovernanceError) {
    return blocked(
      fallbackTitle,
      error.message,
      error.issues.map((issue) => `${issue.path}: ${issue.message}`),
    );
  }
  return blocked(
    fallbackTitle,
    "The operation could not be completed. Nothing was changed.",
    error instanceof Error && error.message ? [error.message] : [],
  );
}

function relatedTo(
  record: AssetVersionRecord,
  published: AssetVersionRecord[],
): { record: AssetVersionRecord; similarity: number; matchedCapabilities: string[] }[] {
  const version = record.asset_version;
  const queryText = [...version.capabilities, ...version.use_cases, ...version.domains].join(
    ". ",
  );
  return rankByText(published, queryText)
    .filter(
      (candidate) =>
        candidate.record.asset_version.asset_version_id !== version.asset_version_id &&
        candidate.score > 0.05,
    )
    .map((candidate) => ({
      record: candidate.record,
      similarity: Math.min(99, Math.round(candidate.score * 100)),
      matchedCapabilities: candidate.matchedFields.slice(0, 3),
    }));
}

function newestTimestamp(rows: readonly { timestamp: string }[]): string | null {
  return (
    [...rows]
      .map((row) => row.timestamp)
      .sort()
      .at(-1) ?? null
  );
}

/* ------------------------------------------------------------------ *
 * Read tools.
 * ------------------------------------------------------------------ */

const searchAssets: OperatorToolDefinition = {
  name: "searchAssets",
  group: "discovery",
  kind: "read",
  summary:
    "Search the published catalogue for assets that match a described job, with the matched fields shown.",
  backedBy: "src/modules/discovery — discover()",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const query = ctx.query.trim() || ctx.utterance.trim();
    const published = listPublishedRecords(ctx.database);
    const response = await discover({ query: query.slice(0, 1_000) }, published);

    const cards = response.candidates.map((candidate) => {
      const record = published.find(
        (item) => item.asset_version.asset_version_id === candidate.asset_version_id,
      );
      if (record === undefined) return null;
      const snapshot = snapshotFor(ctx.database, record, ctx.now);
      return cardFromSnapshot(snapshot, {
        matchedFields: candidate.matched_fields,
        rationale: candidate.rationale,
      });
    });

    return ok(
      {
        type: "search",
        query,
        response,
        cards: cards.filter((card): card is OperatorAssetCard => card !== null),
      },
      `${response.status}: ${response.candidates.length} candidate${response.candidates.length === 1 ? "" : "s"}`,
    );
  },
};

const getAsset: OperatorToolDefinition = {
  name: "getAsset",
  group: "discovery",
  kind: "read",
  summary:
    "Show one asset: what it does, who owns it, readiness, governance state, and recent evidence.",
  backedBy: "GovernanceRepository + governance projection + trust score",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "asset",
        snapshot,
        card: cardFromSnapshot(snapshot),
        evidence: evidenceReferences(snapshot, 4),
      },
      `${snapshot.record.asset_version.name}: readiness ${snapshot.trust.score}`,
    );
  },
};

const findAlternatives: OperatorToolDefinition = {
  name: "findAlternatives",
  group: "discovery",
  kind: "read",
  summary: "Find published assets that do a similar job, ranked by the discovery ranker.",
  backedBy: "src/modules/insights — buildAlternatives()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const published = listPublishedRecords(ctx.database);
    const governance = new GovernanceRepository(ctx.database);

    const candidates = relatedTo(snapshot.record, published).map((item) => {
      const inner = snapshotFor(ctx.database, item.record, ctx.now);
      return {
        record: item.record,
        similarity: item.similarity,
        matchedCapabilities: item.matchedCapabilities,
        trust: inner.trust,
        lastReviewed: newestTimestamp(
          governance.listEvidence(item.record.asset_version.asset_version_id),
        ),
      };
    });

    const result = buildAlternatives(
      {
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        trust: snapshot.trust,
      },
      candidates,
      ctx.now,
    );
    return ok(
      { type: "alternatives", result, subjectName: snapshot.record.asset_version.name },
      `${result.alternatives.length} alternative${result.alternatives.length === 1 ? "" : "s"}`,
    );
  },
};

const compareAssets: OperatorToolDefinition = {
  name: "compareAssets",
  group: "discovery",
  kind: "read",
  summary:
    "Compare two assets attribute by attribute, highlighting only the rows that actually differ.",
  backedBy: "src/modules/insights — buildComparison()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    if (ctx.asset === null) return NO_ASSET;
    const published = listPublishedRecords(ctx.database);
    const governance = new GovernanceRepository(ctx.database);

    let second = ctx.secondAsset;
    if (second === null || second.asset_version.asset_version_id === ctx.asset.asset_version.asset_version_id) {
      second = relatedTo(ctx.asset, published).at(0)?.record ?? null;
    }
    if (second === null) {
      return blocked(
        "There is nothing to compare this against",
        "No other published asset covers a similar enough job to compare.",
        ["Name a second asset explicitly, for example \"compare X and Y\"."],
        [{ label: "Browse the marketplace", href: "/marketplace" }],
      );
    }

    const related = relatedTo(ctx.asset, published);
    const inputs = [ctx.asset, second].map((record, index) => {
      const snapshot = snapshotFor(ctx.database, record, ctx.now);
      return {
        record,
        trust: snapshot.trust,
        projection: snapshot.projection,
        lastReviewed: newestTimestamp(
          governance.listEvidence(record.asset_version.asset_version_id),
        ),
        executions: snapshot.executions.length,
        similarity:
          index === 0
            ? null
            : (related.find(
                (item) =>
                  item.record.asset_version.asset_version_id ===
                  record.asset_version.asset_version_id,
              )?.similarity ?? null),
      };
    });

    const comparison = buildComparison(inputs, ctx.now);
    return ok(
      { type: "comparison", comparison },
      `${comparison.differing_rows} of ${comparison.rows.length} attributes differ`,
    );
  },
};

const investigateAsset: OperatorToolDefinition = {
  name: "investigateAsset",
  group: "investigation",
  kind: "read",
  summary:
    "Explain whether the checks on record cover the version published today, with observations, evidence, and a labelled interpretation.",
  backedBy: "src/modules/investigation — buildInvestigationReport()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;

    const governance = new GovernanceRepository(ctx.database);
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    const previousRecord =
      governance
        .listVersions()
        .filter(
          (candidate) =>
            candidate.asset.asset_id === snapshot.record.asset.asset_id &&
            candidate.asset_version.asset_version_id !== assetVersionId &&
            candidate.asset_version.published_at !== null,
        )
        .sort((left, right) =>
          String(right.asset_version.published_at).localeCompare(
            String(left.asset_version.published_at),
          ),
        )
        .at(0) ?? null;

    const report = await buildInvestigationReport(
      {
        record: snapshot.record,
        evidence: snapshot.evidence,
        executions: snapshot.executions,
        previous:
          previousRecord === null
            ? null
            : {
                record: previousRecord,
                evidence: governance.listEvidence(
                  previousRecord.asset_version.asset_version_id,
                ),
              },
      },
      {
        executorLookup: serverExecutorRegistry,
        executionReader: new ExecutionRepository(ctx.database),
        provider: new GeminiInvestigationAdapter(),
        now: ctx.now,
      },
    );
    return ok({ type: "investigation", report }, `${report.severity}: ${report.headline}`);
  },
};

const getEvidence: OperatorToolDefinition = {
  name: "getEvidence",
  group: "investigation",
  kind: "read",
  summary:
    "List the evidence records behind an asset's readiness, and whether each one was collected against the content published today.",
  backedBy: "GovernanceRepository.listEvidence + assessEvidence",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "evidence",
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        name: snapshot.record.asset_version.name,
        items: evidenceReferences(snapshot, 12),
        total: snapshot.evidence.length,
      },
      `${snapshot.evidence.length} evidence record${snapshot.evidence.length === 1 ? "" : "s"}`,
    );
  },
};

const getLifecycle: OperatorToolDefinition = {
  name: "getLifecycle",
  group: "investigation",
  kind: "read",
  summary:
    "Show what has happened to an asset over time: lifecycle events and evidence, in order.",
  backedBy: "GovernanceRepository.listLifecycleEvents + listEvidence",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "lifecycle",
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        name: snapshot.record.asset_version.name,
        snapshot,
      },
      `${snapshot.events.length} lifecycle event${snapshot.events.length === 1 ? "" : "s"}`,
    );
  },
};

const getTrust: OperatorToolDefinition = {
  name: "getTrust",
  group: "investigation",
  kind: "read",
  summary:
    "Show the readiness score for an asset and the gate-by-gate breakdown every point comes from.",
  backedBy: "src/modules/investigation — computeTrustScore()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "trust",
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        name: snapshot.record.asset_version.name,
        trust: snapshot.trust,
        blocking: snapshot.blockingGates,
        lastReviewed: snapshot.lastReviewed,
        gates: snapshot.projection.gates,
      },
      `readiness ${snapshot.trust.score} (${snapshot.trust.label})`,
    );
  },
};

const getImpact: OperatorToolDefinition = {
  name: "getImpact",
  group: "investigation",
  kind: "read",
  summary:
    "Show what an asset is connected to: its evidence, runs, scenarios, versions, and related assets.",
  backedBy: "src/modules/insights — buildImpactGraph()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const governance = new GovernanceRepository(ctx.database);
    const published = listPublishedRecords(ctx.database);
    const assetVersionId = snapshot.record.asset_version.asset_version_id;

    const graph = buildImpactGraph({
      record: snapshot.record,
      assessments: snapshot.projection.evidence,
      executions: snapshot.executions,
      related: relatedTo(snapshot.record, published)
        .slice(0, 3)
        .map((item) => ({
          asset_version_id: item.record.asset_version.asset_version_id,
          name: item.record.asset_version.name,
          similarity: item.similarity,
        })),
      siblings: governance
        .listVersions()
        .filter(
          (candidate) =>
            candidate.asset.asset_id === snapshot.record.asset.asset_id &&
            candidate.asset_version.asset_version_id !== assetVersionId &&
            candidate.asset_version.published_at !== null,
        ),
    });
    return ok(
      { type: "impact_graph", graph, name: snapshot.record.asset_version.name },
      graph.summary,
    );
  },
};

const getExecutionHistory: OperatorToolDefinition = {
  name: "getExecutionHistory",
  group: "execution",
  kind: "read",
  summary: "List the saved runs of one asset version, with their status and scenario.",
  backedBy: "ExecutionRepository.listByAssetVersionId",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "executions",
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        name: snapshot.record.asset_version.name,
        records: snapshot.executions,
      },
      `${snapshot.executions.length} saved run${snapshot.executions.length === 1 ? "" : "s"}`,
    );
  },
};

const getExecutionStatus: OperatorToolDefinition = {
  name: "getExecutionStatus",
  group: "execution",
  kind: "read",
  summary: "Show one saved run by its execution identifier, or the most recent run of an asset.",
  backedBy: "ExecutionRepository.getById",
  needsAsset: false,
  usesAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const executions = new ExecutionRepository(ctx.database);
    const requested = typeof args.execution_id === "string" ? args.execution_id : null;
    const explicit = /execution_[a-z0-9]+/i.exec(ctx.utterance)?.[0] ?? null;
    const id = requested ?? explicit;

    if (id !== null) {
      const record = executions.getById(id);
      if (record === null) {
        return blocked(
          "No run with that identifier",
          `There is no saved execution ${id}.`,
          [],
          [],
        );
      }
      const owner = new GovernanceRepository(ctx.database).getVersionById(
        record.asset_version_id,
      );
      return ok(
        {
          type: "execution",
          record,
          name: owner?.asset_version.name ?? record.asset_version_id,
        },
        `${record.execution_id}: ${record.status}`,
      );
    }

    if (ctx.asset === null) return NO_ASSET;
    const history = executions.listByAssetVersionId(
      ctx.asset.asset_version.asset_version_id,
    );
    const latest = history.at(0) ?? null;
    if (latest === null) {
      return blocked(
        "No saved runs yet",
        `${ctx.asset.asset_version.name} has no persisted execution records.`,
        [],
        [{ label: "Open asset", href: `/assets/${ctx.asset.asset_version.asset_version_id}` }],
      );
    }
    return ok(
      { type: "execution", record: latest, name: ctx.asset.asset_version.name },
      `${latest.execution_id}: ${latest.status}`,
    );
  },
};

const getReviewQueue: OperatorToolDefinition = {
  name: "getReviewQueue",
  group: "governance",
  kind: "read",
  summary:
    "List every version that is not published yet — drafts, submitted, in review, changes requested — and what each one still needs.",
  backedBy: "GovernanceService.listQueue",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const governance = new GovernanceRepository(ctx.database);
    const pending = governance
      .listVersions()
      .filter((record) =>
        ["draft", "submitted", "in_review", "changes_requested"].includes(
          record.asset_version.lifecycle,
        ),
      );

    const items = pending.map((record) => {
      const snapshot = snapshotFor(ctx.database, record, ctx.now);
      return {
        card: cardFromSnapshot(snapshot),
        blocking: snapshot.blockingGates,
        canPublish: snapshot.projection.canPublish,
      };
    });

    const counts = {
      draft: pending.filter((record) => record.asset_version.lifecycle === "draft").length,
      submitted: pending.filter((record) => record.asset_version.lifecycle === "submitted")
        .length,
      in_review: pending.filter((record) => record.asset_version.lifecycle === "in_review")
        .length,
      changes_requested: pending.filter(
        (record) => record.asset_version.lifecycle === "changes_requested",
      ).length,
    };

    return ok(
      { type: "queue", items, counts },
      `${items.length} version${items.length === 1 ? "" : "s"} awaiting review`,
    );
  },
};

const getGovernanceStatus: OperatorToolDefinition = {
  name: "getGovernanceStatus",
  group: "governance",
  kind: "read",
  summary:
    "Show every required check for an asset version, which pass, and exactly what is blocking publication.",
  backedBy: "src/modules/governance — buildGovernanceProjection()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return ok(
      {
        type: "governance",
        assetVersionId: snapshot.record.asset_version.asset_version_id,
        name: snapshot.record.asset_version.name,
        projection: snapshot.projection,
        lifecycle: snapshot.record.asset_version.lifecycle,
        trust: snapshot.trust,
      },
      snapshot.projection.canPublish
        ? "every required gate passes"
        : `${snapshot.blockingGates.length} gate${snapshot.blockingGates.length === 1 ? "" : "s"} blocking`,
    );
  },
};

const getReuseIntelligence: OperatorToolDefinition = {
  name: "getReuseIntelligence",
  group: "intelligence",
  kind: "read",
  summary: "Show how often an asset is actually used, from persisted execution records.",
  backedBy: "src/modules/insights — buildReuseIntelligence()",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = snapshot.record.asset_version;

    // The same reuse proof the run page shows: a passing reuse_test bound to
    // the current digest, verified against its persisted executions.
    const reuseEvidence =
      snapshot.projection.evidence.find(
        (item) =>
          item.evidence.evidence_type === "reuse_test" && item.state === "passed",
      )?.evidence ?? null;
    const proved =
      version.availability === "runnable" &&
      buildPersistedReuseComparison({
        repository: new ExecutionRepository(ctx.database),
        selectedVersion: version,
        reuseEvidence,
      }).available;

    const reuse = buildReuseIntelligence(
      version.asset_version_id,
      snapshot.executions,
      proved,
    );
    return ok({ type: "reuse", name: version.name, reuse }, reuse.observation);
  },
};

const getTrustDrift: OperatorToolDefinition = {
  name: "getTrustDrift",
  group: "intelligence",
  kind: "read",
  summary:
    "List published assets whose required checks no longer cover the content people receive.",
  backedBy: "src/modules/insights — detectTrustDrift()",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const drift = loadTrustDrift(undefined, ctx.now);
    return ok(
      { type: "drift", drift },
      `${drift.entries.length} of ${drift.scanned} published assets have drifted`,
    );
  },
};

const getMarketplaceOverview: OperatorToolDefinition = {
  name: "getMarketplaceOverview",
  group: "intelligence",
  kind: "read",
  summary:
    "Summarise the whole catalogue: how many are published, ready, runnable, and where checks are stuck.",
  backedBy: "src/modules/insights — buildMarketplaceMetrics()",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(_args, ctx) {
    const governance = new GovernanceRepository(ctx.database);
    const summaries = governance
      .listVersions()
      .filter(
        (record) =>
          record.asset_version.lifecycle === "published" &&
          record.asset_version.deprecated_at === null &&
          record.asset.current_published_version_id ===
            record.asset_version.asset_version_id,
      )
      .map((record) => {
        const snapshot = snapshotFor(ctx.database, record, ctx.now);
        return {
          record,
          projection: snapshot.projection,
          trust: snapshot.trust,
          executions: snapshot.executions,
        };
      });

    const metrics = buildMarketplaceMetrics({ summaries });
    return ok(
      { type: "overview", metrics, state: loadSystemState(undefined, ctx.now) },
      `${metrics.published} published assets, ${metrics.total_runs} saved runs`,
    );
  },
};

const getAgentInformation: OperatorToolDefinition = {
  name: "getAgentInformation",
  group: "intelligence",
  kind: "read",
  summary:
    "Describe the agents in this system: what each one does, what it may decide, and what it cannot.",
  backedBy: "src/modules/operator/agents.ts",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const reference =
      typeof args.agent === "string" && args.agent.trim().length > 0
        ? args.agent
        : ctx.utterance;
    const match = findAgent(reference);
    const items = match === null ? [...AGENTS] : [match];
    return ok(
      {
        type: "agents",
        items,
        title: match === null ? "Agents in this system" : match.name,
      },
      `${items.length} agent${items.length === 1 ? "" : "s"}`,
    );
  },
};

const getProjectInformation: OperatorToolDefinition = {
  name: "getProjectInformation",
  group: "intelligence",
  kind: "read",
  summary:
    "Explain the product itself: architecture, lifecycle, trust, governance, evidence, and the available workflows.",
  backedBy: "src/modules/operator/knowledge.ts — generated from the implementation",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const topic =
      typeof args.topic === "string" && args.topic.trim().length > 0
        ? args.topic.trim()
        : ctx.utterance;
    const knowledge = buildProjectKnowledge(ctx.database, ctx.now);
    return ok({ type: "knowledge", knowledge, topic }, knowledge.summary);
  },
};

const listCapabilities: OperatorToolDefinition = {
  name: "listCapabilities",
  group: "intelligence",
  kind: "read",
  summary:
    "List every action the operator can take, grouped, and which ones require your confirmation.",
  backedBy: "src/modules/operator/tools.ts — the registry itself",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run() {
    return ok({ type: "capabilities", tools: toolProfiles() }, `${TOOLS.length} tools`);
  },
};

/* ------------------------------------------------------------------ *
 * Write tools. run() previews; execute() performs and verifies.
 * ------------------------------------------------------------------ */

function actionOutcome(action: OperatorAction): ToolOutcome {
  return {
    payload: { type: "action", action },
    summary: action.available
      ? `preview ready: ${action.label}`
      : (action.unavailable_reason ?? "unavailable"),
    ok: action.available,
  };
}

function previewAction(
  snapshot: AssetSnapshot,
  database: MarketplaceDatabase,
  options: {
    tool: string;
    label: string;
    impactAction: "flag_for_review" | "metadata_validation" | "publish" | "submit_for_review";
    args: ToolArgs;
    effects: string[];
  },
): ToolOutcome {
  const preview = previewFor(snapshot, options.impactAction, database);
  return actionOutcome({
    tool: options.tool,
    label: options.label,
    summary: preview.question,
    args: options.args,
    asset_version_id: snapshot.record.asset_version.asset_version_id,
    asset_name: snapshot.record.asset_version.name,
    effects: options.effects,
    preview,
    governance: governanceSummary(snapshot.projection),
    available: preview.available,
    unavailable_reason: preview.unavailable_reason,
    confirm_label: preview.confirm_label,
    reversible: preview.reversible,
    reversibility_note: preview.reversibility_note,
  });
}

const runGovernanceChecks: OperatorToolDefinition = {
  name: "runGovernanceChecks",
  group: "governance",
  kind: "write",
  summary:
    "Re-run the deterministic metadata and digest validation and append the result as evidence.",
  backedBy: "GovernanceService.runMetadataValidation",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return previewAction(snapshot, ctx.database, {
      tool: "runGovernanceChecks",
      label: "Run the governance checks",
      impactAction: "metadata_validation",
      args: { asset_version_id: snapshot.record.asset_version.asset_version_id, ...args },
      effects: [
        "Validates the canonical contract, the exact subject digest, and the permission decisions",
        "Appends one metadata_validation evidence record bound to the current digest",
        "Recomputes every gate and the readiness score",
        "Changes no lifecycle state and no frozen content",
      ],
    });
  },
  async execute(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    try {
      const evidence = governanceService(ctx.database).runMetadataValidation(assetVersionId);
      const after = loadSnapshot(ctx.database, assetVersionId, ctx.now);
      if (after === null) {
        return blocked(
          "The check ran but the result could not be verified",
          "The asset version could not be re-read after the write.",
        );
      }
      const passed = evidence.result === "passed";
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: passed ? "Governance checks passed" : "Governance checks recorded a failure",
          detail: evidence.details.summary,
          facts: [
            fact("Asset", after.record.asset_version.name),
            fact("Result", evidence.result, passed ? "positive" : "negative"),
            fact("Evidence recorded", evidence.evidence_id, "positive"),
            fact(
              "Required checks",
              `${governanceSummary(after.projection).passing} of ${governanceSummary(after.projection).required} passing`,
              governanceSummary(after.projection).blocking.length === 0
                ? "positive"
                : "warning",
            ),
            fact(
              "Readiness",
              `${snapshot.trust.score} → ${after.trust.score}`,
              after.trust.score >= snapshot.trust.score ? "positive" : "warning",
            ),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `evidence ${evidence.evidence_id} (${evidence.result})`,
      );
    } catch (error) {
      return governanceFailure(error, "The governance checks could not be run");
    }
  },
};

const submitForReview: OperatorToolDefinition = {
  name: "submitForReview",
  group: "governance",
  kind: "write",
  summary: "Move a draft into the review queue so a reviewer can pick it up.",
  backedBy: "GovernanceService.transition (draft → submitted)",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return previewAction(snapshot, ctx.database, {
      tool: "submitForReview",
      label: "Submit for review",
      impactAction: "submit_for_review",
      args: { asset_version_id: snapshot.record.asset_version.asset_version_id, ...args },
      effects: [
        "Appends a lifecycle event recording who submitted it and why",
        "Moves the version from draft to submitted",
        "Leaves it out of the public catalogue until a reviewer publishes it",
        "Changes no frozen content",
      ],
    });
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    const actor =
      typeof args.actor_name === "string" && args.actor_name.trim()
        ? args.actor_name.trim()
        : "Marketplace contributor";
    try {
      governanceService(ctx.database).transition(assetVersionId, {
        to_state: "submitted",
        actor_type: "team_member",
        actor_name: actor,
        reason: "Submitted for review from the AI Control Center after explicit approval.",
      });
      const after = loadSnapshot(ctx.database, assetVersionId, ctx.now);
      if (after === null || after.record.asset_version.lifecycle !== "submitted") {
        return blocked(
          "Submission could not be verified",
          "The lifecycle state did not read back as submitted.",
        );
      }
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: "Submitted for review",
          detail: `${after.record.asset_version.name} is now in the review queue. A reviewer decides what happens next.`,
          facts: [
            fact("Lifecycle", "draft → submitted", "positive"),
            fact("Submitted by", actor),
            fact("Public catalogue", "Still excluded", "neutral"),
            fact("Lifecycle event", "Recorded", "positive"),
          ],
          verified: true,
          links: [
            { label: "Review queue", href: "/governance" },
            { label: "Governance record", href: `/governance/${assetVersionId}` },
          ],
        },
        "lifecycle is submitted",
      );
    } catch (error) {
      return governanceFailure(error, "The asset could not be submitted");
    }
  },
};

const publishAsset: OperatorToolDefinition = {
  name: "publishAsset",
  group: "lifecycle",
  kind: "write",
  summary:
    "Publish a version that is in review and has passed every required gate, making it discoverable.",
  backedBy: "GovernanceService.transition (in_review → published)",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const reviewer = publishingReviewer(snapshot);
    const outcome = previewAction(snapshot, ctx.database, {
      tool: "publishAsset",
      label: "Publish",
      impactAction: "publish",
      args: {
        asset_version_id: snapshot.record.asset_version.asset_version_id,
        actor_name: reviewer,
        ...args,
      },
      effects: [
        "Changes lifecycle from in review to published",
        "Adds the version to the public catalogue and to discovery",
        "Appends a lifecycle event citing every passing gate's evidence",
        reviewer === null
          ? "Requires the named reviewer who passed the human review; none is on record"
          : `Must be performed by ${reviewer}, the reviewer who passed the current human review`,
        "Never alters frozen content",
      ],
    });

    if (outcome.payload.type === "action" && reviewer === null && outcome.payload.action.available) {
      outcome.payload.action.available = false;
      outcome.payload.action.unavailable_reason =
        "Publication requires the named reviewer who passed the current human review. No passing human review is on record.";
      return { ...outcome, ok: false, summary: outcome.payload.action.unavailable_reason };
    }
    return outcome;
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    const reviewer =
      publishingReviewer(snapshot) ??
      (typeof args.actor_name === "string" ? args.actor_name : null);
    if (reviewer === null) {
      return blocked(
        "Publication is blocked",
        "Publication requires the named reviewer who passed the current human review. No passing human review is on record.",
        governanceSummary(snapshot.projection).blocking,
        [{ label: "Governance record", href: `/governance/${assetVersionId}` }],
      );
    }
    try {
      governanceService(ctx.database).transition(assetVersionId, {
        to_state: "published",
        actor_type: "demo_reviewer",
        actor_name: reviewer,
        reason: "Published from the AI Control Center after explicit reviewer approval.",
        confirm_publication: true,
      });
      const after = loadSnapshot(ctx.database, assetVersionId, ctx.now);
      if (after === null || after.record.asset_version.lifecycle !== "published") {
        return blocked(
          "Publication could not be verified",
          "The lifecycle state did not read back as published.",
        );
      }
      const inCatalog = new CatalogRepository(ctx.database)
        .listPublished()
        .some((record) => record.asset_version.asset_version_id === assetVersionId);
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: "Published",
          detail: `${after.record.asset_version.name} is now in the public catalogue.`,
          facts: [
            fact("Lifecycle", "in review → published", "positive"),
            fact("Published by", reviewer),
            fact(
              "Public catalogue",
              inCatalog ? "Listed" : "Not listed",
              inCatalog ? "positive" : "negative",
            ),
            fact("Discovery", inCatalog ? "Returned in results" : "Excluded", inCatalog ? "positive" : "warning"),
            fact("Readiness", String(after.trust.score), "positive"),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `lifecycle is published; catalogue listing ${inCatalog}`,
      );
    } catch (error) {
      return governanceFailure(error, "The asset could not be published");
    }
  },
};

const flagAsset: OperatorToolDefinition = {
  name: "flagAsset",
  group: "lifecycle",
  kind: "write",
  summary:
    "Take a published version out of the catalogue and discovery until it has been re-reviewed.",
  backedBy: "GovernanceService.transition (published → deprecated)",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    return previewAction(snapshot, ctx.database, {
      tool: "flagAsset",
      label: "Flag for re-review",
      impactAction: "flag_for_review",
      args: { asset_version_id: snapshot.record.asset_version.asset_version_id, ...args },
      effects: [
        "Changes lifecycle from published to deprecated",
        "Removes the version from the public catalogue and from discovery",
        "Appends a lifecycle event with the reason",
        "Retains every evidence record and every saved run",
        "Cannot be undone in place: restoring requires publishing a new reviewed version",
      ],
    });
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    const reason =
      typeof args.reason === "string" && args.reason.trim().length > 0
        ? args.reason.trim()
        : "Flagged from the AI Control Center: current content is not covered by current review evidence.";
    try {
      governanceService(ctx.database).transition(assetVersionId, {
        to_state: "deprecated",
        actor_type: "demo_reviewer",
        actor_name:
          typeof args.actor_name === "string" && args.actor_name.trim()
            ? args.actor_name.trim()
            : "Marketplace reviewer",
        reason,
      });
      const after = loadSnapshot(ctx.database, assetVersionId, ctx.now);
      if (after === null || after.record.asset_version.lifecycle !== "deprecated") {
        return blocked(
          "The flag could not be verified",
          "The lifecycle state did not read back as deprecated.",
        );
      }
      const stillListed = new CatalogRepository(ctx.database)
        .listPublished()
        .some((record) => record.asset_version.asset_version_id === assetVersionId);
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: "Flagged for re-review",
          detail: `${after.record.asset_version.name} has been removed from the catalogue until it is re-reviewed.`,
          facts: [
            fact("Lifecycle", "published → deprecated", "warning"),
            fact(
              "Public catalogue",
              stillListed ? "Still listed" : "Removed",
              stillListed ? "negative" : "positive",
            ),
            fact("Discovery", stillListed ? "Still returned" : "Excluded", stillListed ? "negative" : "positive"),
            fact("Evidence", `${after.evidence.length} records retained`, "positive"),
            fact("Saved runs", `${after.executions.length} retained`, "positive"),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `lifecycle is deprecated; still listed ${stillListed}`,
      );
    } catch (error) {
      return governanceFailure(error, "The asset could not be flagged");
    }
  },
};

const archiveAsset: OperatorToolDefinition = {
  name: "archiveAsset",
  group: "lifecycle",
  kind: "write",
  summary:
    "Not available: this system has no separate archive state. Retirement is modelled as deprecation.",
  backedBy: "No backing transition exists",
  needsAsset: true,
  available: false,
  unavailableReason:
    "There is no archive lifecycle state in this product. The lifecycle is draft → submitted → in review → changes requested → published → deprecated, and deprecation is how a version is retired. Use \"flag for re-review\" instead, which deprecates the version and keeps every record.",
  async run(_args, ctx) {
    void ctx;
    return blocked(
      "Archiving is not a capability of this system",
      archiveAsset.unavailableReason ?? "Unavailable.",
      [
        "Deprecation retires a version and keeps all evidence and runs.",
        "Nothing in this product deletes an asset, by design: the ledger is append-only.",
      ],
      [{ label: "See the lifecycle", href: "/governance" }],
    );
  },
};

const createVersion: OperatorToolDefinition = {
  name: "createVersion",
  group: "lifecycle",
  kind: "write",
  summary:
    "Create a new editable draft version from a published one, so content can be changed without touching frozen content.",
  backedBy: "GovernanceService.createDraftFromPublished",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = nextVersion(
      snapshot.record.asset_version.version,
      typeof args.version === "string" ? args.version : null,
    );
    const publishable = snapshot.record.asset_version.published_at !== null;
    return actionOutcome({
      tool: "createVersion",
      label: `Create version ${version}`,
      summary: `Copy ${snapshot.record.asset_version.name} ${snapshot.record.asset_version.version} into a new editable draft ${version}?`,
      args: {
        asset_version_id: snapshot.record.asset_version.asset_version_id,
        version,
      },
      asset_version_id: snapshot.record.asset_version.asset_version_id,
      asset_name: snapshot.record.asset_version.name,
      effects: [
        `Creates a new draft version ${version} of the same asset`,
        "Copies the current content; the published version is not modified",
        "Appends a lifecycle event recording the new draft",
        "The new draft carries no evidence: every check starts again",
      ],
      preview: null,
      governance: governanceSummary(snapshot.projection),
      available: publishable,
      unavailable_reason: publishable
        ? null
        : "Only a version that has been published can be copied into a new edit draft.",
      confirm_label: `Create draft ${version}`,
      reversible: false,
      reversibility_note:
        "Versions are append-only. A draft can be left unsubmitted, but it is never removed.",
    });
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = nextVersion(
      snapshot.record.asset_version.version,
      typeof args.version === "string" ? args.version : null,
    );
    try {
      const created = governanceService(ctx.database).createDraftFromPublished(
        snapshot.record.asset_version.asset_version_id,
        {
          version,
          actor_name: "Marketplace contributor",
          reason: "New edit draft created from the AI Control Center after explicit approval.",
        },
      );
      const after = loadSnapshot(
        ctx.database,
        created.asset_version.asset_version_id,
        ctx.now,
      );
      if (after === null) {
        return blocked(
          "The draft could not be verified",
          "The new version could not be re-read after the write.",
        );
      }
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: `Draft ${version} created`,
          detail: `${after.record.asset_version.name} ${version} is an editable draft. The published version is unchanged.`,
          facts: [
            fact("New version", version, "positive"),
            fact("Lifecycle", after.record.asset_version.lifecycle, "neutral"),
            fact("Evidence", "0 records — checks start again", "warning"),
            fact("Published version", "Unchanged", "positive"),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `created ${created.asset_version.asset_version_id}`,
      );
    } catch (error) {
      return governanceFailure(error, "The new version could not be created");
    }
  },
};

const updateAsset: OperatorToolDefinition = {
  name: "updateAsset",
  group: "lifecycle",
  kind: "write",
  summary:
    "Change the metadata of a draft — summary, description, capabilities, use cases, limitations.",
  backedBy: "GovernanceService.updateEditableDraft",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const patch = readPatch(args);
    const editable =
      snapshot.record.asset_version.lifecycle === "draft" ||
      snapshot.record.asset_version.lifecycle === "changes_requested";
    const fields = Object.keys(patch);
    return actionOutcome({
      tool: "updateAsset",
      label: "Update the draft",
      summary:
        fields.length === 0
          ? `Change ${snapshot.record.asset_version.name}? Tell me what the new text should say.`
          : `Update ${fields.join(", ")} on ${snapshot.record.asset_version.name}?`,
      args: {
        asset_version_id: snapshot.record.asset_version.asset_version_id,
        ...patch,
      },
      asset_version_id: snapshot.record.asset_version.asset_version_id,
      asset_name: snapshot.record.asset_version.name,
      effects:
        fields.length === 0
          ? ["Nothing to apply: no new field values were given"]
          : [
              `Replaces ${fields.join(", ")} on the draft`,
              "Leaves identity, semantic version, and created time untouched",
              "Cannot add executable behaviour: only a maintainer can allowlist an executor",
              "Published content is never edited in place",
            ],
      preview: null,
      governance: governanceSummary(snapshot.projection),
      available: editable && fields.length > 0,
      unavailable_reason: !editable
        ? "Only a draft or changes-requested version can be edited. Published content is immutable; create a new version instead."
        : fields.length === 0
          ? "Tell me what the new value should be, for example: update the description to \"…\"."
          : null,
      confirm_label: "Apply update",
      reversible: false,
      reversibility_note:
        "Draft edits replace the stored content. Earlier draft text is not retained.",
    });
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const patch = readPatch(args);
    if (Object.keys(patch).length === 0) {
      return blocked(
        "Nothing to update",
        "No new field values were supplied.",
        ["Say what the new text should be, for example: update the summary to \"…\"."],
      );
    }
    const version = snapshot.record.asset_version;
    const {
      lifecycle: _lifecycle,
      subject_digest: _digest,
      published_at: _published,
      deprecated_at: _deprecated,
      replacement_version: _replacement,
      ...content
    } = version;
    const next = AssetVersionContentSchema.safeParse({ ...content, ...patch });
    if (!next.success) {
      return blocked(
        "The update is not valid",
        "The new values do not satisfy the asset-version contract.",
        next.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    try {
      governanceService(ctx.database).updateEditableDraft(
        version.asset_version_id,
        next.data,
      );
      const after = loadSnapshot(ctx.database, version.asset_version_id, ctx.now);
      if (after === null) {
        return blocked(
          "The update could not be verified",
          "The version could not be re-read after the write.",
        );
      }
      const applied = Object.keys(patch).filter((key) => {
        const before = JSON.stringify((content as Record<string, unknown>)[key]);
        const now = JSON.stringify(
          (after.record.asset_version as unknown as Record<string, unknown>)[key],
        );
        return before !== now;
      });
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: applied.length > 0 ? "Draft updated" : "No change was needed",
          detail:
            applied.length > 0
              ? `${applied.join(", ")} now read back with the new values.`
              : "The stored values already matched what you asked for.",
          facts: [
            fact("Asset", after.record.asset_version.name),
            fact("Fields changed", applied.length > 0 ? applied.join(", ") : "none", applied.length > 0 ? "positive" : "neutral"),
            fact("Lifecycle", after.record.asset_version.lifecycle),
          ],
          verified: true,
          links: assetLinks(after),
        },
        applied.length > 0 ? `updated ${applied.join(", ")}` : "no fields changed",
      );
    } catch (error) {
      return governanceFailure(error, "The draft could not be updated");
    }
  },
};

const createAsset: OperatorToolDefinition = {
  name: "createAsset",
  group: "lifecycle",
  kind: "write",
  summary:
    "Create a new contribution as a non-runnable draft, ready for validation and review.",
  backedBy: "GovernanceService.createContribution",
  needsAsset: false,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const draft = readDraft(args);
    if (draft === null) {
      return blocked(
        "I do not have enough to create a contribution yet",
        "A contribution needs at least a name, a summary, and what it does.",
        ["Describe the asset you want to contribute and I will draft the metadata."],
      );
    }
    const duplicates = rankByText(
      listPublishedRecords(ctx.database),
      [draft.name, draft.summary, ...draft.capabilities].join(". "),
    )
      .filter((candidate) => candidate.score > 0.1)
      .slice(0, 3)
      .map((candidate) =>
        toAssetCard(candidate.record, {
          matchedFields: candidate.matchedFields,
        }),
      );

    return actionOutcome({
      tool: "createAsset",
      label: "Create the draft",
      summary: `Create "${draft.name}" as a non-runnable draft?`,
      args: { draft: draft as unknown as Record<string, unknown> },
      asset_version_id: null,
      asset_name: draft.name,
      effects: [
        `Creates asset "${draft.name}" at version ${draft.version} in the draft state`,
        "Records access, tool-use, and packaging permission as confirmed on your approval",
        "Marks the source as created during this event",
        "Creates it non-runnable: only a maintainer can allowlist executable behaviour",
        duplicates.length > 0
          ? `${duplicates.length} published ${duplicates.length === 1 ? "asset" : "assets"} already overlap with this description`
          : "No published asset overlaps with this description",
        "Appends a lifecycle event recording the draft",
      ],
      preview: null,
      governance: null,
      available: true,
      unavailable_reason: null,
      confirm_label: "Create draft",
      reversible: false,
      reversibility_note:
        "Assets are append-only. A draft can be left unsubmitted, but it is never removed.",
    });
  },
  async execute(args, ctx) {
    const draft = readDraft(args);
    if (draft === null) {
      return blocked(
        "The contribution is incomplete",
        "A contribution needs at least a name, a summary, and what it does.",
      );
    }
    try {
      const created = governanceService(ctx.database).createContribution(
        contributionPayload(draft),
      );
      const after = loadSnapshot(
        ctx.database,
        created.asset_version.asset_version_id,
        ctx.now,
      );
      if (after === null) {
        return blocked(
          "The draft could not be verified",
          "The new contribution could not be re-read after the write.",
        );
      }
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: "Draft created",
          detail: `${after.record.asset_version.name} exists as a draft. It is not in the catalogue and nobody can find it yet.`,
          facts: [
            fact("Asset version", after.record.asset_version.asset_version_id, "positive"),
            fact("Lifecycle", after.record.asset_version.lifecycle, "neutral"),
            fact("Availability", after.record.asset_version.availability.replaceAll("_", " ")),
            fact("Public catalogue", "Not listed", "neutral"),
            fact("Next step", "Validate, then submit for review", "warning"),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `created ${created.asset_version.asset_version_id}`,
      );
    } catch (error) {
      return governanceFailure(error, "The contribution could not be created");
    }
  },
};

const freezeAsset: OperatorToolDefinition = {
  name: "freezeAsset",
  group: "governance",
  kind: "write",
  summary:
    "Lock a draft's content by computing its subject digest, so checks can be bound to exactly this content.",
  backedBy: "GovernanceService.freezeVersion",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = snapshot.record.asset_version;
    const editable =
      version.lifecycle === "draft" || version.lifecycle === "changes_requested";
    const frozen = version.subject_digest !== null;
    return actionOutcome({
      tool: "freezeAsset",
      label: "Lock the content",
      summary: `Freeze the content of ${version.name} ${version.version} so checks can be bound to it?`,
      args: { asset_version_id: version.asset_version_id, ...args },
      asset_version_id: version.asset_version_id,
      asset_name: version.name,
      effects: [
        "Computes the sha256 subject digest over the exact immutable content",
        "Stores the digest; the database refuses any later change to it",
        "Makes the version eligible for evidence: nothing can be checked before this",
        "The content can never be edited again — a change means a new version",
      ],
      preview: null,
      governance: governanceSummary(snapshot.projection),
      available: editable && !frozen,
      unavailable_reason: frozen
        ? "This version is already frozen. Its digest can never change."
        : editable
          ? null
          : `Only a draft or changes-requested version can be frozen; this one is ${version.lifecycle.replaceAll("_", " ")}.`,
      confirm_label: "Lock content",
      reversible: false,
      reversibility_note:
        "Freezing is one-way and enforced by the database. Editing after this requires a new version.",
    });
  },
  async execute(_args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const assetVersionId = snapshot.record.asset_version.asset_version_id;
    try {
      governanceService(ctx.database).freezeVersion(assetVersionId);
      const after = loadSnapshot(ctx.database, assetVersionId, ctx.now);
      if (after === null || after.record.asset_version.subject_digest === null) {
        return blocked(
          "The freeze could not be verified",
          "The subject digest did not read back after the write.",
        );
      }
      const digest = after.record.asset_version.subject_digest;
      return ok(
        {
          type: "completed",
          assetVersionId: after.record.asset_version.asset_version_id,
          title: "Content locked",
          detail: `${after.record.asset_version.name} now has a subject digest. Every check from here is bound to exactly this content.`,
          facts: [
            fact("Subject digest", `${digest.slice(0, 18)}…${digest.slice(-6)}`, "positive"),
            fact("Content", "Immutable from now on", "positive"),
            fact("Lifecycle", after.record.asset_version.lifecycle),
            fact("Next step", "Run the governance checks", "warning"),
          ],
          verified: true,
          links: assetLinks(after),
        },
        `frozen at ${digest.slice(0, 18)}`,
      );
    } catch (error) {
      return governanceFailure(error, "The content could not be locked");
    }
  },
};

const runAsset: OperatorToolDefinition = {
  name: "runAsset",
  group: "execution",
  kind: "write",
  summary:
    "Run a runnable asset on one of its own test scenarios and save the execution record.",
  backedBy: "ExecutionService.executePublic",
  needsAsset: true,
  available: true,
  unavailableReason: null,
  async run(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = snapshot.record.asset_version;
    const scenario = pickScenario(snapshot, args);
    const runnable = version.availability === "runnable";

    return actionOutcome({
      tool: "runAsset",
      label: "Run it",
      summary: runnable
        ? `Run ${version.name} on the "${scenario?.label ?? "first"}" scenario?`
        : `${version.name} is ${version.availability.replaceAll("_", " ")} and cannot be run here.`,
      args: {
        asset_version_id: version.asset_version_id,
        scenario_id: scenario?.scenario_id ?? null,
      },
      asset_version_id: version.asset_version_id,
      asset_name: version.name,
      effects: [
        `Runs the server-allowlisted executor bound to this exact frozen version`,
        scenario === undefined
          ? "Uses the asset's own input fixture"
          : `Uses the stored input fixture for "${scenario.label}"`,
        "Saves one execution record with a unique execution ID and the definition digest",
        "Validates the output against the asset's output schema",
        "Changes no lifecycle state and no catalogue listing",
      ],
      preview: null,
      governance: governanceSummary(snapshot.projection),
      available: runnable && scenario !== undefined,
      unavailable_reason: !runnable
        ? `This version is ${version.availability.replaceAll("_", " ")}. Only a runnable version with an allowlisted executor can be run here.`
        : scenario === undefined
          ? "This version has no stored test scenario to run against."
          : null,
      confirm_label: "Run now",
      reversible: false,
      reversibility_note:
        "Execution records are append-only and are kept as provenance. Running does not change the asset.",
    });
  },
  async execute(args, ctx) {
    const snapshot = requireSnapshot(ctx);
    if (snapshot === null) return NO_ASSET;
    const version = snapshot.record.asset_version;
    const scenario = pickScenario(snapshot, args);
    if (version.availability !== "runnable" || scenario === undefined) {
      return blocked(
        "This asset cannot be run here",
        version.availability !== "runnable"
          ? `${version.name} is ${version.availability.replaceAll("_", " ")}, not runnable.`
          : `${version.name} has no stored test scenario to run against.`,
        [],
        [{ label: "Open asset", href: `/assets/${version.asset_version_id}` }],
      );
    }

    try {
      assertExecutionCatalogReadiness(ctx.database, serverExecutorRegistry);
      const service = new ExecutionService(
        new CatalogRepository(ctx.database),
        new ExecutionRepository(ctx.database),
        serverExecutorRegistry,
        new SystemClock(),
        new CryptoIdGenerator(),
      );
      const result = await service.executePublic({
        asset_version_id: version.asset_version_id,
        scenario_label: scenario.label,
        input: scenario.input_fixture,
      });
      if (result.kind === "request_error") {
        return blocked(
          "The run was rejected",
          result.error.message,
          [],
          [{ label: "Open asset", href: `/assets/${version.asset_version_id}` }],
        );
      }
      const record = result.record;
      const verified = new ExecutionRepository(ctx.database).getById(record.execution_id);
      const succeeded = record.status === "succeeded";
      return ok(
        {
          type: "completed",
          assetVersionId: version.asset_version_id,
          title: succeeded ? "Run complete" : `Run ${record.status}`,
          detail: succeeded
            ? `${version.name} ran on "${scenario.label}" and the output passed its schema.`
            : (record.rejection_reason ??
              record.error?.message ??
              `The run finished with status ${record.status}.`),
          facts: [
            fact("Execution ID", record.execution_id, succeeded ? "positive" : "warning"),
            fact("Status", record.status, succeeded ? "positive" : "negative"),
            fact("Frozen version", `${version.name} ${record.asset_version}`),
            fact("Executor", record.executor_key ?? "not resolved"),
            fact(
              "Saved",
              verified === null ? "Not found on re-read" : "Persisted and re-read",
              verified === null ? "negative" : "positive",
            ),
          ],
          verified: verified !== null,
          links: [
            { label: "Open the run page", href: `/assets/${version.asset_version_id}/try` },
            { label: "Open asset", href: `/assets/${version.asset_version_id}` },
          ],
        },
        `${record.execution_id}: ${record.status}`,
      );
    } catch (error) {
      return blocked(
        "The run could not be started",
        error instanceof Error && error.message
          ? error.message
          : "Execution is temporarily unavailable.",
      );
    }
  },
};

/* ------------------------------------------------------------------ *
 * Argument readers.
 * ------------------------------------------------------------------ */

const PATCH_TEXT_FIELDS = [
  "name",
  "summary",
  "description",
  "usage_instructions",
  "setup_expectations",
  "maintenance_expectations",
  "owner",
] as const;

const PATCH_LIST_FIELDS = [
  "capabilities",
  "use_cases",
  "domains",
  "audiences",
  "limitations",
] as const;

function readPatch(args: ToolArgs): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of PATCH_TEXT_FIELDS) {
    const value = args[field];
    if (typeof value === "string" && value.trim().length > 0) patch[field] = value.trim();
  }
  for (const field of PATCH_LIST_FIELDS) {
    const value = args[field];
    if (Array.isArray(value)) {
      const list = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (list.length > 0) patch[field] = list;
    }
  }
  return patch;
}

function readDraft(args: ToolArgs): ContributionDraftFields | null {
  const raw = (args.draft ?? args) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  const list = (key: string): string[] =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[])
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  const name = text("name");
  const summary = text("summary");
  if (name.length === 0 || summary.length === 0) return null;

  const capabilities = list("capabilities");
  const useCases = list("use_cases");
  if (capabilities.length === 0 || useCases.length === 0) return null;

  const slug =
    text("slug") ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);

  const assetType = text("asset_type");
  const allowed = [
    "skill",
    "workflow",
    "agent",
    "template",
    "dashboard",
    "plugin",
    "other",
  ] as const;

  return {
    slug: slug.length > 0 ? slug : "new-contribution",
    name,
    summary,
    owner: text("owner") || "Marketplace contributor",
    asset_type: (allowed as readonly string[]).includes(assetType)
      ? (assetType as ContributionDraftFields["asset_type"])
      : "agent",
    version: text("version") || "1.0.0",
    description: text("description") || summary,
    capabilities,
    use_cases: useCases,
    domains: list("domains").length > 0 ? list("domains") : ["property operations"],
    audiences: list("audiences").length > 0 ? list("audiences") : ["operations teams"],
    limitations:
      list("limitations").length > 0
        ? list("limitations")
        : ["Not reviewed yet; no evidence has been collected for this draft."],
    usage_instructions:
      text("usage_instructions") ||
      "Describe how a colleague should use this asset, step by step, before submitting it for review.",
    setup_expectations:
      text("setup_expectations") ||
      "State what a team must have in place before they can use this asset.",
    maintenance_expectations:
      text("maintenance_expectations") ||
      "State who keeps this current and how often it should be reviewed.",
  };
}

const EMPTY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

function contributionPayload(draft: ContributionDraftFields): Record<string, unknown> {
  return {
    slug: draft.slug,
    actor_name: draft.owner,
    content: {
      version: draft.version,
      name: draft.name,
      summary: draft.summary,
      owner: draft.owner,
      asset_type: draft.asset_type,
      execution_kind: "none",
      description: draft.description,
      audiences: draft.audiences,
      domains: draft.domains,
      capabilities: draft.capabilities,
      use_cases: draft.use_cases,
      input_schema: EMPTY_SCHEMA,
      output_schema: EMPTY_SCHEMA,
      limitations: draft.limitations,
      usage_instructions: draft.usage_instructions,
      setup_expectations: draft.setup_expectations,
      maintenance_expectations: draft.maintenance_expectations,
      test_scenarios: [],
      availability: "reference_only",
      source_class: "created_during_event",
      source_reference: "Synthetic material created during this event.",
      license_id: null,
      attribution: null,
      permission_evidence_id: null,
      access_permission: "confirmed",
      tool_use_permission: "confirmed",
      final_package_permission: "confirmed",
    },
  };
}

function pickScenario(
  snapshot: AssetSnapshot,
  args: ToolArgs,
): AssetSnapshot["record"]["asset_version"]["test_scenarios"][number] | undefined {
  const scenarios = snapshot.record.asset_version.test_scenarios;
  const requested =
    typeof args.scenario_id === "string"
      ? args.scenario_id
      : typeof args.scenario_label === "string"
        ? args.scenario_label
        : null;
  if (requested !== null) {
    const match = scenarios.find(
      (scenario) =>
        scenario.scenario_id === requested ||
        scenario.label.toLowerCase() === requested.toLowerCase(),
    );
    if (match !== undefined) return match;
  }
  return scenarios.at(0);
}

function nextVersion(current: string, requested: string | null): string {
  if (requested !== null && /^\d+\.\d+\.\d+/.test(requested.trim())) {
    return requested.trim();
  }
  const parts = current.split(".");
  const major = Number(parts[0] ?? 1);
  const minor = Number(parts[1] ?? 0);
  return `${Number.isFinite(major) ? major : 1}.${(Number.isFinite(minor) ? minor : 0) + 1}.0`;
}

/* ------------------------------------------------------------------ *
 * Registry.
 * ------------------------------------------------------------------ */

export const TOOLS: readonly OperatorToolDefinition[] = [
  searchAssets,
  getAsset,
  findAlternatives,
  compareAssets,
  investigateAsset,
  getEvidence,
  getLifecycle,
  getTrust,
  getImpact,
  getExecutionHistory,
  getExecutionStatus,
  getGovernanceStatus,
  getReviewQueue,
  getReuseIntelligence,
  getTrustDrift,
  getMarketplaceOverview,
  getAgentInformation,
  getProjectInformation,
  listCapabilities,
  freezeAsset,
  runGovernanceChecks,
  submitForReview,
  publishAsset,
  flagAsset,
  createVersion,
  updateAsset,
  createAsset,
  runAsset,
  archiveAsset,
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): OperatorToolDefinition | null {
  return BY_NAME.get(name) ?? null;
}

export function toolProfiles(): ToolProfile[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    group: tool.group,
    kind: tool.kind,
    summary: tool.summary,
    backed_by: tool.backedBy,
    confirm_required: tool.kind === "write",
    available: tool.available,
    unavailable_reason: tool.unavailableReason,
  }));
}

export const GROUP_LABEL: Record<OperatorToolGroup, string> = {
  discovery: "Discovery",
  investigation: "Investigation",
  governance: "Governance",
  lifecycle: "Lifecycle",
  execution: "Execution",
  intelligence: "Intelligence",
};

