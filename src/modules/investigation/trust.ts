import type { TrustDimension, TrustScore } from "@/contracts";
import type { EvidenceAssessment, GateStatus, GovernanceGate, GovernanceProjection } from "@/modules/governance";

/**
 * Gate weights. Every weight belongs to a required gate, so a reference-only
 * version is never penalised for execution gates it is not expected to hold.
 */
export const GATE_WEIGHTS: Record<GovernanceGate["key"], number> = {
  frozen_subject: 15,
  permission_fields: 10,
  metadata_validation: 10,
  human_review: 25,
  source_permission: 10,
  executor_binding: 10,
  functional_test: 10,
  guardrail_test: 5,
  security_review: 15,
};

/** A stale gate retains partial credit: the work was done, against other content. */
export const STATUS_FACTOR: Record<GateStatus, number> = {
  passed: 1,
  stale: 0.25,
  failed: 0,
  missing: 0,
  not_required: 0,
};

/** Evidence older than this reads as needing a refresh rather than as current. */
export const FRESHNESS_ATTENTION_HOURS = 72;

/**
 * Score thresholds are unchanged; only the wording is. The label is what a
 * non-expert reads, so it says whether the asset can be used rather than naming
 * an internal grade.
 */
export const TRUST_BANDS: readonly {
  band: TrustScore["band"];
  label: string;
  minimum: number;
}[] = [
  { band: "strong", label: "Ready to use", minimum: 85 },
  { band: "adequate", label: "Ready with review", minimum: 65 },
  { band: "attention", label: "Checks needed", minimum: 40 },
  { band: "blocked", label: "Not ready to use", minimum: 0 },
];

function bandFor(score: number): { band: TrustScore["band"]; label: string } {
  const match =
    TRUST_BANDS.find((candidate) => score >= candidate.minimum) ?? TRUST_BANDS[3]!;
  return { band: match.band, label: match.label };
}

function dimension(
  key: TrustDimension["key"],
  label: string,
  gates: GovernanceGate[],
): TrustDimension {
  const required = gates.filter((gate) => gate.status !== "not_required");
  if (required.length === 0) {
    return { key, label, status: "not_required", detail: "Not required for this asset type." };
  }
  const failed = required.filter((gate) => gate.status === "failed" || gate.status === "missing");
  const stale = required.filter((gate) => gate.status === "stale");
  if (failed.length > 0) {
    return {
      key,
      label,
      status: "failed",
      detail: failed.map((gate) => `${gate.label}: ${gate.status}`).join("; "),
    };
  }
  if (stale.length > 0) {
    return {
      key,
      label,
      status: "attention",
      detail: stale.map((gate) => `${gate.label}: needs refresh`).join("; "),
    };
  }
  return { key, label, status: "passed", detail: "Current and passing." };
}

function hoursSince(timestamp: string, now: Date): number {
  return (now.getTime() - Date.parse(timestamp)) / 3_600_000;
}

export function newestEvidenceTimestamp(
  assessments: readonly EvidenceAssessment[],
): string | null {
  const times = assessments
    .filter((assessment) => assessment.state !== "superseded")
    .map((assessment) => assessment.evidence.timestamp)
    .sort();
  return times.at(-1) ?? null;
}

/**
 * Derives a trust score from the governance gates that already exist. It adds
 * no judgement of its own: every point traces back to a gate the governance
 * projection computed from persisted, digest-bound evidence.
 */
export function computeTrustScore(
  projection: GovernanceProjection,
  now: Date = new Date(),
): TrustScore {
  const required = projection.gates.filter((gate) => gate.status !== "not_required");
  const totalWeight = required.reduce((sum, gate) => sum + GATE_WEIGHTS[gate.key], 0);
  const earned = required.reduce(
    (sum, gate) => sum + GATE_WEIGHTS[gate.key] * STATUS_FACTOR[gate.status],
    0,
  );
  const rawScore = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);

  const newest = newestEvidenceTimestamp(projection.evidence);
  const age = newest === null ? null : hoursSince(newest, now);
  const freshness: TrustDimension =
    newest === null
      ? {
          key: "freshness",
          label: "Freshness",
          status: "failed",
          detail: "No evidence has been recorded for this version.",
        }
      : age !== null && age > FRESHNESS_ATTENTION_HOURS
        ? {
            key: "freshness",
            label: "Freshness",
            status: "attention",
            detail: `Newest evidence is ${Math.round(age / 24)} days old.`,
          }
        : {
            key: "freshness",
            label: "Freshness",
            status: "passed",
            detail:
              age !== null && age < 1
                ? "Reviewed within the last hour."
                : `Reviewed ${Math.max(1, Math.round(age ?? 0))} hours ago.`,
          };

  const gateByKey = (key: GovernanceGate["key"]) =>
    projection.gates.filter((gate) => gate.key === key);

  const dimensions: TrustDimension[] = [
    dimension("governance", "Governance", [
      ...gateByKey("frozen_subject"),
      ...gateByKey("permission_fields"),
    ]),
    dimension("review", "Human review", gateByKey("human_review")),
    dimension("evidence", "Evidence", [
      ...gateByKey("metadata_validation"),
      ...gateByKey("source_permission"),
      ...gateByKey("functional_test"),
      ...gateByKey("guardrail_test"),
    ]),
    dimension("security", "Security", [
      ...gateByKey("security_review"),
      ...gateByKey("executor_binding"),
    ]),
    freshness,
  ];

  // Stale evidence caps the headline score so an old approval never reads as current.
  const score = freshness.status === "attention" ? Math.min(rawScore, 79) : rawScore;
  const { band, label } = bandFor(score);

  return {
    score,
    band,
    label,
    dimensions,
    required_gates: required.length,
    passing_gates: required.filter((gate) => gate.status === "passed").length,
  };
}
