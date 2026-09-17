import {
  AssetVersionContentSchema,
  InvestigationReportSchema,
  type AssetVersionRecord,
  type ChangeSignal,
  type Evidence,
  type EvidenceReference,
  type ExecutionRecord,
  type InvestigationReport,
  type RecommendedAction,
  type SignalSeverity,
  type TrustScore,
} from "@/contracts";
import {
  buildGovernanceProjection,
  type EvidenceAssessment,
  type GovernanceExecutionReader,
  type GovernanceProjection,
} from "@/modules/governance";
import type { ExecutorLookup } from "@/shared/ports";

import { computeTrustScore } from "./trust";

export interface InvestigationSubject {
  record: AssetVersionRecord;
  evidence: Evidence[];
  executions: ExecutionRecord[];
  /** The previous published version of the same asset, when one exists. */
  previous: { record: AssetVersionRecord; evidence: Evidence[] } | null;
}

export interface InvestigationInference {
  inference: string;
  recommendation: string;
  state: "ready" | "disabled" | "unavailable";
  modelOrConfig: string | null;
  reason: string | null;
}

export interface InvestigationInferenceProvider {
  infer(input: {
    assetName: string;
    severity: SignalSeverity;
    observations: string[];
    signals: ChangeSignal[];
    changedFields: string[];
  }): Promise<InvestigationInference>;
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

function readableType(value: string): string {
  return value.replaceAll("_", " ");
}

const SIGNAL_LABEL: Record<string, string> = {
  human_review: "Reviewed by a person",
  security_review: "Security reviewed",
  source_permission: "Source approved",
};

const PLAIN_STATUS: Record<string, string> = {
  passed: "complete",
  missing: "not done",
  failed: "incomplete",
  stale: "needs redoing",
};

/** What a blocked check means for the reader, per check and per status. */
const GATE_OBSERVATION: Record<string, Partial<Record<string, string>>> = {
  frozen_subject: {
    missing: "This version was not locked before review, so a review cannot be tied to it.",
    failed: "The stored lock does not match this version content.",
  },
  permission_fields: {
    failed: "Permissions are incomplete: access, tool use, or sharing has not been confirmed.",
    missing: "Permissions are incomplete: access, tool use, or sharing has not been confirmed.",
  },
  metadata_validation: {
    missing: "The asset details have not been checked against the published content.",
    stale: "The details check was done on different content and needs redoing.",
  },
  human_review: {
    missing: "No person has reviewed the version published today.",
    stale: "The review on record was done on different content and needs redoing.",
    failed: "The recorded review did not pass.",
  },
  source_permission: {
    missing: "The source this was built from has not been approved.",
    stale: "The source approval was recorded against different content.",
  },
  executor_binding: {
    missing: "The run setup has not been verified against reviewed code.",
    failed: "The run setup does not match the reviewed code.",
  },
  functional_test: {
    missing: "This version has not been tested on a real example.",
    stale: "The test on record was run against different content.",
  },
  guardrail_test: {
    missing: "Safe-failure behaviour has not been tested for this version.",
    stale: "The safe-failure test was run against different content.",
  },
  security_review: {
    missing: "No security review is recorded for the version published today.",
    stale: "The security review on record was done on different content.",
    failed: "The recorded security review did not pass.",
  },
};

function contentOf(record: AssetVersionRecord): Record<string, unknown> {
  const {
    lifecycle: _lifecycle,
    subject_digest: _subjectDigest,
    published_at: _publishedAt,
    deprecated_at: _deprecatedAt,
    replacement_version: _replacementVersion,
    ...content
  } = record.asset_version;
  return AssetVersionContentSchema.parse(content) as unknown as Record<string, unknown>;
}

/** Fields whose identity always differs between versions and carry no meaning here. */
const IGNORED_DIFF_FIELDS = new Set(["asset_version_id", "version", "created_at"]);

export function changedContentFields(
  current: AssetVersionRecord,
  previous: AssetVersionRecord,
): string[] {
  const left = contentOf(previous);
  const right = contentOf(current);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (IGNORED_DIFF_FIELDS.has(key)) continue;
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) changed.push(key);
  }
  return changed.sort();
}

function shortDigest(value: string | null): string {
  if (value === null) return "not frozen";
  return `${value.slice(0, 11)}…${value.slice(-4)}`;
}

function gateStatusWord(projection: GovernanceProjection, key: string): string {
  const gate = projection.gates.find((candidate) => candidate.key === key);
  if (!gate) return "unknown";
  if (gate.status === "not_required") return "not required";
  return gate.status;
}

function buildSignals(
  subject: InvestigationSubject,
  trust: TrustScore,
  baselineTrust: TrustScore | null,
  projection: GovernanceProjection,
  previousProjection: GovernanceProjection | null,
): ChangeSignal[] {
  const signals: ChangeSignal[] = [];
  const version = subject.record.asset_version;
  const previous = subject.previous?.record.asset_version ?? null;

  if (baselineTrust !== null && previous !== null) {
    const delta = trust.score - baselineTrust.score;
    signals.push({
      key: "trust",
      label: "Trust score",
      before: String(baselineTrust.score),
      after: String(trust.score),
      direction: delta < 0 ? "down" : delta > 0 ? "up" : "flat",
      severity: delta <= -20 ? "critical" : delta < 0 ? "warning" : "info",
      detail: `The same checks, counted on version ${previous.version} and on version ${version.version}.`,
      technical: false,
    });
  }

  if (previousProjection !== null && previous !== null) {
    for (const key of ["human_review", "security_review", "source_permission"] as const) {
      const before = gateStatusWord(previousProjection, key);
      const after = gateStatusWord(projection, key);
      if (before === after) continue;
      // "not required" is a scope change, never a loss of assurance.
      if (after === "not required" || before === "not required") continue;
      const degraded = before === "passed" && after !== "passed";
      signals.push({
        key,
        label: SIGNAL_LABEL[key],
        before: PLAIN_STATUS[before] ?? before,
        after: PLAIN_STATUS[after] ?? after,
        direction: degraded ? "down" : "up",
        severity: degraded ? "critical" : "info",
        detail: `Compared with version ${previous.version}.`,
        technical: false,
      });
    }

    signals.push({
      key: "digest",
      label: "Content version",
      before: shortDigest(previous.subject_digest),
      after: shortDigest(version.subject_digest),
      direction: "flat",
      severity: "warning",
      detail:
        "A fingerprint of the exact content. Checks are tied to the fingerprint they were done against, so a different fingerprint means the checks do not apply.",
      technical: true,
    });
  }

  const succeeded = subject.executions.filter((record) => record.status === "succeeded").length;
  const rejected = subject.executions.length - succeeded;
  if (subject.executions.length > 0) {
    signals.push({
      key: "runs",
      label: "Recorded runs",
      before: `${succeeded} worked`,
      after: `${rejected} were rejected`,
      direction: "flat",
      severity: rejected > succeeded ? "warning" : "info",
      detail: "Saved runs of this exact version.",
      technical: false,
    });
  }

  const freshness = trust.dimensions.find((dimension) => dimension.key === "freshness");
  if (freshness && freshness.status !== "passed") {
    signals.push({
      key: "freshness",
      label: "Last checked",
      before: "up to date",
      after: freshness.status === "failed" ? "never checked" : "out of date",
      direction: "down",
      severity: freshness.status === "failed" ? "critical" : "warning",
      detail: freshness.detail,
      technical: false,
    });
  }

  return signals;
}

function buildObservations(
  subject: InvestigationSubject,
  projection: GovernanceProjection,
  changedFields: string[],
): string[] {
  const version = subject.record.asset_version;
  const observations: string[] = [];

  const blocking = projection.gates.filter(
    (gate) => gate.status === "missing" || gate.status === "failed" || gate.status === "stale",
  );
  for (const gate of blocking) {
    observations.push(GATE_OBSERVATION[gate.key]?.[gate.status] ?? `${gate.label}: ${gate.message}`);
  }

  const previous = subject.previous;
  if (previous !== null) {
    observations.push(
      `Version ${version.version} is the version people get today. The ${previous.evidence.length} check${previous.evidence.length === 1 ? "" : "s"} on record were done on version ${previous.record.asset_version.version}, which has different content.`,
    );
    if (changedFields.length > 0) {
      observations.push(
        `These parts of the asset changed after that review: ${changedFields.map(readableType).join(", ")}.`,
      );
    }
  }

  if (blocking.length === 0 && previous === null) {
    observations.push(
      "Every required check has been completed for the version published today.",
    );
  }

  if (subject.executions.length > 0) {
    observations.push(
      `${subject.executions.length} saved run${subject.executions.length === 1 ? "" : "s"} of this exact version.`,
    );
  }

  return observations;
}

function buildEvidenceTrail(
  assessments: readonly EvidenceAssessment[],
  currentDigest: string | null,
  assetVersionId: string,
): EvidenceReference[] {
  return assessments.slice(0, 8).map((assessment) => ({
    evidence_id: assessment.evidence.evidence_id,
    evidence_type: readableType(assessment.evidence.evidence_type),
    state: assessment.state,
    state_label: assessment.label,
    tone: EVIDENCE_TONE[assessment.state] ?? "neutral",
    subject_digest: assessment.evidence.subject_digest,
    digest_matches_current: assessment.evidence.subject_digest === currentDigest,
    timestamp: assessment.evidence.timestamp,
    reviewer: assessment.evidence.reviewer?.name ?? assessment.evidence.actor_name ?? null,
    summary: assessment.evidence.details.summary,
    scope: assessment.evidence.scope,
    href: `/governance/${assetVersionId}#evidence-${assessment.evidence.evidence_id}`,
  }));
}

function buildActions(
  subject: InvestigationSubject,
  projection: GovernanceProjection,
): RecommendedAction[] {
  const version = subject.record.asset_version;
  const actions: RecommendedAction[] = [];
  const published = version.lifecycle === "published";

  actions.push({
    key: "metadata_validation",
    label: "Run the checks again",
    description:
      "Re-checks the asset details against the version published today and saves the result.",
    emphasis: projection.canPublish ? "secondary" : "primary",
    endpoint: `/api/governance/versions/${version.asset_version_id}/checks/metadata`,
    method: "POST",
    body: {},
    effect: "Saves a new automatic check against the current version.",
  });

  if (published) {
    actions.push({
      key: "flag_for_review",
      label: "Review the current version",
      description:
        "Takes this version out of search until a reviewer has checked the content people get today.",
      emphasis: "primary",
      endpoint: `/api/governance/versions/${version.asset_version_id}/transitions`,
      method: "POST",
      body: {
        to_state: "deprecated",
        actor_type: "demo_reviewer",
        actor_name: "Marketplace reviewer",
        reason: "Flagged from an investigation: current content is not covered by current review evidence.",
      },
      effect: "Records the decision and removes the version from the catalogue and search.",
    });
  }

  actions.push({
    key: "open_governance",
    label: "View the full governance record",
    description: "Shows every check, who did it, and when, behind this summary.",
    emphasis: "secondary",
    endpoint: null,
    method: null,
    body: null,
    effect: "Opens the full record for this version.",
  });

  actions.push({
    key: "find_similar",
    label: "Find a ready-to-use alternative",
    description: "Looks for other published assets that do the same job and are ready to use.",
    emphasis: "secondary",
    endpoint: null,
    method: null,
    body: null,
    effect: "Opens search using this asset capabilities.",
  });

  return actions;
}

function severityFor(trust: TrustScore, signals: ChangeSignal[]): SignalSeverity {
  if (signals.some((signal) => signal.severity === "critical")) return "critical";
  if (trust.band === "attention" || trust.band === "blocked") return "critical";
  if (signals.some((signal) => signal.severity === "warning")) return "warning";
  return "info";
}

/**
 * One short sentence a non-expert can act on. Supporting detail lives in the
 * observations below it, never in the headline.
 */
function headlineFor(
  subject: InvestigationSubject,
  trust: TrustScore,
  severity: SignalSeverity,
): string {
  void trust;
  if (severity === "info") return "This version has passed all of its required checks.";
  if (subject.previous !== null) return "This version has not passed the required checks.";
  return "This version is missing some required checks.";
}

/** The second line: why, in one sentence. */
function subheadlineFor(subject: InvestigationSubject, severity: SignalSeverity): string {
  if (severity === "info") {
    return "The checks on record were done on exactly the content published today.";
  }
  if (subject.previous !== null) {
    return "The available review applies to an older version, not the version currently published.";
  }
  return "Some checks have not been completed for the version published today.";
}

function buildImpact(
  subject: InvestigationSubject,
  severity: SignalSeverity,
  projection: GovernanceProjection,
): string {
  void projection;
  const version = subject.record.asset_version;
  if (severity === "info") {
    return `You can use ${version.name} as it is. The checks on record cover exactly what you receive.`;
  }
  const published =
    version.lifecycle === "published" &&
    subject.record.asset.current_published_version_id === version.asset_version_id;
  if (published) {
    return "This asset appears in search, but people should not rely on it until the current version has been reviewed.";
  }
  return "This version is not in the catalogue, so nobody can adopt it until the missing checks are completed.";
}

/** Deterministic fallback used whenever the optional model is unavailable. */
export function deterministicInference(
  subject: InvestigationSubject,
  severity: SignalSeverity,
  changedFields: string[],
): { inference: string; recommendation: string } {
  const version = subject.record.asset_version;
  if (severity === "info") {
    return {
      inference:
        "The checks on record describe the same content people receive, so nothing looks out of step.",
      recommendation: `Check ${version.name} again the next time its content changes.`,
    };
  }
  const fieldText =
    changedFields.length > 0
      ? ` The parts that changed (${changedFields.join(", ")}) suggest the asset was extended after its last review.`
      : "";
  return {
    inference: `The most likely explanation is that the content was updated and republished without repeating the review.${fieldText}`,
    recommendation:
      "Run the checks again on the current version, then ask a reviewer to review it before anyone else relies on it.",
  };
}

/**
 * Builds a complete investigation report. Deterministic facts, model
 * interpretation, and recommended actions stay in separate fields so the UI can
 * never present an inference as a verified observation.
 */
export async function buildInvestigationReport(
  subject: InvestigationSubject,
  options: {
    executorLookup?: ExecutorLookup;
    /** Required for the execution gates: without it a passing test reads as missing. */
    executionReader?: GovernanceExecutionReader;
    provider?: InvestigationInferenceProvider;
    now?: Date;
  } = {},
): Promise<InvestigationReport> {
  const now = options.now ?? new Date();
  const version = subject.record.asset_version;
  const projection = buildGovernanceProjection(
    subject.record,
    subject.evidence,
    options.executorLookup,
    options.executionReader,
  );
  const trust = computeTrustScore(projection, now);

  const previousProjection =
    subject.previous === null
      ? null
      : buildGovernanceProjection(
          subject.previous.record,
          subject.previous.evidence,
          options.executorLookup,
          options.executionReader,
        );
  const baselineTrust =
    previousProjection === null ? null : computeTrustScore(previousProjection, now);

  const changedFields =
    subject.previous === null
      ? []
      : changedContentFields(subject.record, subject.previous.record);

  const signals = buildSignals(subject, trust, baselineTrust, projection, previousProjection);
  const severity = severityFor(trust, signals);
  const observations = buildObservations(subject, projection, changedFields);

  const fallback = deterministicInference(subject, severity, changedFields);
  let inference = fallback.inference;
  let recommendation = fallback.recommendation;
  let ai: InvestigationReport["ai"] = {
    state: "disabled",
    model_or_config: null,
    reason: "Optional AI is disabled; the deterministic interpretation is shown.",
  };

  if (options.provider) {
    const result = await options.provider.infer({
      assetName: version.name,
      severity,
      observations,
      signals,
      changedFields,
    });
    if (result.state === "ready") {
      inference = result.inference;
      recommendation = result.recommendation;
    }
    ai = {
      state: result.state,
      model_or_config: result.modelOrConfig,
      reason: result.reason,
    };
  }

  return InvestigationReportSchema.parse({
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    asset_name: version.name,
    asset_version: version.version,
    generated_at: now.toISOString(),
    severity,
    headline: headlineFor(subject, trust, severity),
    subheadline: subheadlineFor(subject, severity),
    trust,
    baseline:
      subject.previous === null || baselineTrust === null
        ? null
        : {
            asset_version_id: subject.previous.record.asset_version.asset_version_id,
            asset_version: subject.previous.record.asset_version.version,
            score: baselineTrust.score,
            subject_digest: subject.previous.record.asset_version.subject_digest,
          },
    signals,
    observations,
    inference,
    recommendation,
    impact: buildImpact(subject, severity, projection),
    changed_fields: changedFields,
    evidence: buildEvidenceTrail(projection.evidence, version.subject_digest, version.asset_version_id),
    actions: buildActions(subject, projection),
    ai,
  });
}
