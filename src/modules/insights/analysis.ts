import {
  AlternativesResultSchema,
  ComparisonSchema,
  MarketplaceMetricsSchema,
  ReuseIntelligenceSchema,
  TrustDriftSchema,
  type Alternative,
  type AlternativesResult,
  type AssetVersionRecord,
  type CompareRow,
  type Comparison,
  type DriftEntry,
  type DriftStep,
  type Evidence,
  type ExecutionRecord,
  type LifecycleEvent,
  type MarketplaceMetrics,
  type MetricBucket,
  type ReuseIntelligence,
  type ScenarioUsage,
  type TrustScore,
  type TrustDrift,
} from "@/contracts";
import type { GovernanceProjection } from "@/modules/governance";
import { FRESHNESS_ATTENTION_HOURS } from "@/modules/investigation";

/* ------------------------------------------------------------------ *
 * Alternatives
 * ------------------------------------------------------------------ */

export interface AlternativeCandidate {
  record: AssetVersionRecord;
  similarity: number;
  matchedCapabilities: string[];
  trust: TrustScore;
  lastReviewed: string | null;
}

/**
 * Ranks published alternatives that already exist in the catalog. "Safer" means
 * strictly higher trust than the subject; the ranking itself comes from the same
 * deterministic retrieval discovery uses.
 */
export function buildAlternatives(
  subject: { assetVersionId: string; trust: TrustScore },
  candidates: AlternativeCandidate[],
  now: Date = new Date(),
): AlternativesResult {
  const alternatives: Alternative[] = candidates
    .filter((candidate) => candidate.record.asset_version.asset_version_id !== subject.assetVersionId)
    .map((candidate) => {
      const version = candidate.record.asset_version;
      const ageHours =
        candidate.lastReviewed === null
          ? Number.POSITIVE_INFINITY
          : (now.getTime() - Date.parse(candidate.lastReviewed)) / 3_600_000;
      return {
        asset_version_id: version.asset_version_id,
        asset_id: version.asset_id,
        name: version.name,
        summary: version.summary,
        owner: version.owner,
        similarity: candidate.similarity,
        matched_capabilities: candidate.matchedCapabilities,
        trust: candidate.trust,
        runnable: version.availability === "runnable",
        evidence_fresh: ageHours <= FRESHNESS_ATTENTION_HOURS,
        last_reviewed: candidate.lastReviewed,
        safer: candidate.trust.score > subject.trust.score,
      };
    })
    .sort(
      (left, right) =>
        Number(right.safer) - Number(left.safer) ||
        right.trust.score - left.trust.score ||
        right.similarity - left.similarity,
    )
    .slice(0, 4);

  const safer = alternatives.filter((alternative) => alternative.safer).length;
  const observation =
    alternatives.length === 0
      ? "No other published asset does this job."
      : safer === 0
        ? `${alternatives.length} other published asset${alternatives.length === 1 ? " does" : "s do"} a similar job, but none is better checked than this one.`
        : `${safer} of ${alternatives.length} asset${alternatives.length === 1 ? " that does" : "s that do"} a similar job ${safer === 1 ? "is" : "are"} better checked than this one.`;

  return AlternativesResultSchema.parse({
    asset_version_id: subject.assetVersionId,
    subject_trust: subject.trust.score,
    alternatives,
    observation,
  });
}

/* ------------------------------------------------------------------ *
 * Reuse intelligence
 * ------------------------------------------------------------------ */

/** Dimensions the execution record does not store, stated rather than invented. */
const NOT_RECORDED = [
  "We do not record who ran an asset, so usage is grouped by the job it was used for rather than by team.",
];

export function buildReuseIntelligence(
  assetVersionId: string,
  executions: readonly ExecutionRecord[],
  reuseProved: boolean,
): ReuseIntelligence {
  const succeeded = executions.filter((record) => record.status === "succeeded");
  const rejected = executions.filter((record) => record.status !== "succeeded");
  const byScenario = new Map<string, ExecutionRecord[]>();
  for (const record of executions) {
    const key = record.scenario_label ?? "Ad-hoc run";
    byScenario.set(key, [...(byScenario.get(key) ?? []), record]);
  }

  const scenarios: ScenarioUsage[] = [...byScenario.entries()]
    .map(([label, records]) => ({
      label,
      runs: records.length,
      succeeded: records.filter((record) => record.status === "succeeded").length,
      last_run:
        records
          .map((record) => record.started_at)
          .sort()
          .at(-1) ?? null,
    }))
    .sort((left, right) => right.runs - left.runs);

  const times = executions.map((record) => record.started_at).sort();
  const userRuns = executions.filter((record) => record.purpose === "user_run").length;

  const observation =
    executions.length === 0
      ? "Nobody has run this version yet."
      : `Run ${executions.length} time${executions.length === 1 ? "" : "s"} for ${scenarios.length} different job${scenarios.length === 1 ? "" : "s"}. ${succeeded.length} worked and ${rejected.length} ${rejected.length === 1 ? "was" : "were"} turned away for missing information.`;

  return ReuseIntelligenceSchema.parse({
    asset_version_id: assetVersionId,
    total: executions.length,
    succeeded: succeeded.length,
    rejected: rejected.length,
    user_runs: userRuns,
    prepublication_runs: executions.length - userRuns,
    distinct_scenarios: scenarios.length,
    scenarios,
    first_run: times.at(0) ?? null,
    last_run: times.at(-1) ?? null,
    reuse_proved: reuseProved,
    observation,
    not_recorded: NOT_RECORDED,
  });
}

/* ------------------------------------------------------------------ *
 * Trust drift
 * ------------------------------------------------------------------ */

export interface DriftCandidate {
  record: AssetVersionRecord;
  trust: TrustScore;
  events: LifecycleEvent[];
  evidence: Evidence[];
  previous: { record: AssetVersionRecord; trust: TrustScore } | null;
  /**
   * The same gates scored at the instant the newest evidence was recorded. It is
   * computed, not estimated, so an aging-evidence baseline is as real as a
   * previous-version baseline.
   */
  trustAtNewestEvidence: { score: number; timestamp: string } | null;
}

const DRIFT_METHOD =
  "Scores are worked out from the checks recorded on each published version. Only the moments the system actually recorded are shown, so nothing in between is guessed.";

/**
 * Detects versions whose trust fell relative to an earlier documented state.
 * Two sources qualify: a previous published version of the same asset, and
 * evidence that has aged past the freshness threshold. Nothing is extrapolated.
 */
export function detectTrustDrift(
  candidates: DriftCandidate[],
  now: Date = new Date(),
): TrustDrift {
  const entries: DriftEntry[] = [];

  for (const candidate of candidates) {
    const version = candidate.record.asset_version;
    const steps: DriftStep[] = [];
    let from = candidate.trust.score;
    let reason = "";

    if (candidate.previous !== null) {
      const previousVersion = candidate.previous.record.asset_version;
      from = candidate.previous.trust.score;
      steps.push({
        label: `v${previousVersion.version} reviewed`,
        timestamp: previousVersion.published_at ?? previousVersion.created_at,
        score: candidate.previous.trust.score,
        detail: `Version ${previousVersion.version} was published with ${candidate.previous.trust.passing_gates} of ${candidate.previous.trust.required_gates} required checks complete.`,
        asset_version: previousVersion.version,
      });
      steps.push({
        label: `v${version.version} published`,
        timestamp: version.published_at ?? version.created_at,
        score: candidate.trust.score,
        detail: `Version ${version.version} has ${candidate.trust.passing_gates} of ${candidate.trust.required_gates} required checks complete, and its content is different from version ${previousVersion.version}.`,
        asset_version: version.version,
      });
      reason = `The review on record was done on version ${previousVersion.version}. The version people get today has different content.`;
    }

    const freshness = candidate.trust.dimensions.find(
      (dimension) => dimension.key === "freshness",
    );
    const baseline = candidate.trustAtNewestEvidence;
    if (candidate.previous === null && freshness?.status === "attention" && baseline !== null) {
      // The documented pre-aging state: the same gates, scored at the instant the
      // newest evidence was recorded. Both endpoints are computed, never guessed.
      steps.push({
        label: "Last checked",
        timestamp: baseline.timestamp,
        score: baseline.score,
        detail: "The same checks, scored at the moment they were last done.",
        asset_version: version.version,
      });
      steps.push({
        label: "Today",
        timestamp: now.toISOString(),
        score: candidate.trust.score,
        detail: freshness.detail,
        asset_version: version.version,
      });
      from = baseline.score;
      reason = `It has not been checked in over ${Math.round(FRESHNESS_ATTENTION_HOURS / 24)} days. ${freshness.detail}`;
    }

    const delta = candidate.trust.score - from;
    if (delta >= 0 || steps.length < 2) continue;

    entries.push({
      asset_id: version.asset_id,
      asset_version_id: version.asset_version_id,
      name: version.name,
      from_score: from,
      to_score: candidate.trust.score,
      delta,
      reason,
      severity: delta <= -20 ? "critical" : delta <= -10 ? "warning" : "info",
      steps: steps.sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    });
  }

  return TrustDriftSchema.parse({
    generated_at: now.toISOString(),
    entries: entries.sort((left, right) => left.delta - right.delta),
    scanned: candidates.length,
    method: DRIFT_METHOD,
  });
}

/* ------------------------------------------------------------------ *
 * Comparison
 * ------------------------------------------------------------------ */

export interface CompareInput {
  record: AssetVersionRecord;
  trust: TrustScore;
  projection: GovernanceProjection;
  lastReviewed: string | null;
  executions: number;
  similarity: number | null;
}

function row(
  label: string,
  group: CompareRow["group"],
  values: { display: string; tone: CompareRow["values"][number]["tone"] }[],
): CompareRow {
  return {
    label,
    group,
    values,
    differs: new Set(values.map((value) => value.display)).size > 1,
  };
}

/**
 * A factual side-by-side. It never declares a winner: each row states what each
 * version actually holds and marks whether the row differs.
 */
export function buildComparison(inputs: CompareInput[], now: Date = new Date()): Comparison {
  const capabilities = [
    ...new Set(inputs.flatMap((input) => input.record.asset_version.capabilities)),
  ].sort();

  const rows: CompareRow[] = [
    row(
      "Readiness score",
      "trust",
      inputs.map((input) => ({
        display: String(input.trust.score),
        tone:
          input.trust.band === "strong"
            ? "positive"
            : input.trust.band === "adequate"
              ? "neutral"
              : input.trust.band === "attention"
                ? "warning"
                : "negative",
      })),
    ),
    row(
      "Checks complete",
      "trust",
      inputs.map((input) => ({
        display: `${input.trust.passing_gates} of ${input.trust.required_gates}`,
        tone: input.trust.passing_gates === input.trust.required_gates ? "positive" : "warning",
      })),
    ),
    row(
      "Last checked",
      "governance",
      inputs.map((input) => {
        const dimension = input.trust.dimensions.find((item) => item.key === "freshness");
        return {
          display:
            input.lastReviewed === null
              ? "Never checked"
              : dimension?.status === "passed"
                ? "Up to date"
                : "Out of date",
          tone:
            input.lastReviewed === null
              ? "negative"
              : dimension?.status === "passed"
                ? "positive"
                : "warning",
        };
      }),
    ),
    row(
      "Reviewed by a person",
      "governance",
      inputs.map((input) => {
        const gate = input.projection.gates.find((item) => item.key === "human_review");
        return {
          display: gate ? gate.status.replaceAll("_", " ") : "unknown",
          tone: gate?.status === "passed" ? "positive" : "negative",
        };
      }),
    ),
    row(
      "Security reviewed",
      "governance",
      inputs.map((input) => {
        const gate = input.projection.gates.find((item) => item.key === "security_review");
        return {
          display: gate ? gate.status.replaceAll("_", " ") : "unknown",
          tone:
            gate?.status === "passed"
              ? "positive"
              : gate?.status === "not_required"
                ? "neutral"
                : "warning",
        };
      }),
    ),
    row(
      "Can be run directly",
      "contract",
      inputs.map((input) => ({
        display: input.record.asset_version.availability === "runnable" ? "Yes" : "No",
        tone: input.record.asset_version.availability === "runnable" ? "positive" : "neutral",
      })),
    ),
    row(
      "Times run",
      "contract",
      inputs.map((input) => ({
        display: String(input.executions),
        tone: input.executions > 0 ? "positive" : "neutral",
      })),
    ),
    row(
      "Owner",
      "governance",
      inputs.map((input) => ({ display: input.record.asset_version.owner, tone: "neutral" })),
    ),
    ...(inputs.some((input) => input.similarity !== null)
      ? [
          row(
            "Does the same job",
            "capability",
            inputs.map((input) => ({
              display: input.similarity === null ? "subject" : `${input.similarity}%`,
              tone: "neutral" as const,
            })),
          ),
        ]
      : []),
    ...capabilities.map((capability) =>
      row(
        capability,
        "capability",
        inputs.map((input) => ({
          display: input.record.asset_version.capabilities.includes(capability) ? "Yes" : "No",
          tone: input.record.asset_version.capabilities.includes(capability)
            ? ("positive" as const)
            : ("neutral" as const),
        })),
      ),
    ),
  ];

  const differing = rows.filter((item) => item.differs).length;
  void now;

  return ComparisonSchema.parse({
    subjects: inputs.map((input) => ({
      asset_version_id: input.record.asset_version.asset_version_id,
      name: input.record.asset_version.name,
      version: input.record.asset_version.version,
      owner: input.record.asset_version.owner,
      trust: input.trust,
      subject_digest: input.record.asset_version.subject_digest,
    })),
    rows,
    differing_rows: differing,
    observation: `${differing} of ${rows.length} things are different between these assets.`,
  });
}

/* ------------------------------------------------------------------ *
 * Marketplace metrics
 * ------------------------------------------------------------------ */

export interface MetricsInput {
  summaries: {
    record: AssetVersionRecord;
    trust: TrustScore;
    projection: GovernanceProjection;
    executions: ExecutionRecord[];
  }[];
}

export function buildMarketplaceMetrics(input: MetricsInput): MarketplaceMetrics {
  const { summaries } = input;

  const governance: MetricBucket[] = [
    {
      label: "Published",
      value: summaries.length,
      tone: "brand",
      href: "/marketplace",
    },
    {
      label: "Fully verified",
      value: summaries.filter((item) => item.trust.band === "strong").length,
      tone: "positive",
      href: "/marketplace?view=reviewed",
    },
    {
      label: "Runnable",
      value: summaries.filter((item) => item.record.asset_version.availability === "runnable")
        .length,
      tone: "brand",
      href: "/marketplace?view=runnable",
    },
    {
      label: "Needs attention",
      value: summaries.filter(
        (item) => item.trust.band === "attention" || item.trust.band === "blocked",
      ).length,
      tone: "warning",
      href: "/under-construction",
    },
  ];

  const bands: { label: string; tone: MetricBucket["tone"]; test: (score: number) => boolean }[] = [
    { label: "85–100", tone: "positive", test: (score) => score >= 85 },
    { label: "65–84", tone: "brand", test: (score) => score >= 65 && score < 85 },
    { label: "40–64", tone: "warning", test: (score) => score >= 40 && score < 65 },
    { label: "0–39", tone: "negative", test: (score) => score < 40 },
  ];

  const trustBands: MetricBucket[] = bands.map((band) => ({
    label: band.label,
    value: summaries.filter((item) => band.test(item.trust.score)).length,
    tone: band.tone,
    href: null,
  }));

  const gateCounts = { passed: 0, stale: 0, failed: 0, missing: 0 };
  for (const summary of summaries) {
    for (const gate of summary.projection.gates) {
      if (gate.status === "not_required") continue;
      gateCounts[gate.status] += 1;
    }
  }

  const gateHealth: MetricBucket[] = [
    { label: "Passed", value: gateCounts.passed, tone: "positive", href: null },
    { label: "Stale", value: gateCounts.stale, tone: "warning", href: null },
    { label: "Failed", value: gateCounts.failed, tone: "negative", href: null },
    { label: "Missing", value: gateCounts.missing, tone: "neutral", href: null },
  ];

  const usage = summaries
    .map((item) => ({
      asset_version_id: item.record.asset_version.asset_version_id,
      name: item.record.asset_version.name,
      runs: item.executions.length,
      succeeded: item.executions.filter((record) => record.status === "succeeded").length,
    }))
    .filter((item) => item.runs > 0)
    .sort((left, right) => right.runs - left.runs)
    .slice(0, 6);

  return MarketplaceMetricsSchema.parse({
    published: summaries.length,
    governance,
    trust_bands: trustBands,
    gate_health: gateHealth,
    usage,
    total_runs: summaries.reduce((sum, item) => sum + item.executions.length, 0),
  });
}
