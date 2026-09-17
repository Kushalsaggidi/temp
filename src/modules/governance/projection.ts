import type {
  AssetVersionRecord,
  Evidence,
  EvidenceType,
  ExecutionRecord,
  LifecycleEvent,
} from "@/contracts";
import type { ExecutorLookup } from "@/shared/ports";
import { computeSubjectDigest } from "@/shared/integrity";

export const SECURITY_ACCEPTANCE_ASSERTION =
  "Named prepublication reviewer accepted the scoped security and data-handling review";

export type EvidenceAssessmentState =
  | "passed"
  | "failed"
  | "not_applicable"
  | "informational"
  | "stale_digest"
  | "stale_artifact"
  | "superseded";

export interface EvidenceAssessment {
  evidence: Evidence;
  state: EvidenceAssessmentState;
  label: string;
  gateEligible: boolean;
}

export type ReviewStatus =
  | "not_reviewed"
  | "passed"
  | "failed_or_needs_changes"
  | "expired_needs_refresh";

export type GateStatus = "passed" | "missing" | "failed" | "stale" | "not_required";

export interface GovernanceGate {
  key:
    | "frozen_subject"
    | "permission_fields"
    | "metadata_validation"
    | "human_review"
    | "source_permission"
    | "executor_binding"
    | "functional_test"
    | "guardrail_test"
    | "security_review";
  label: string;
  required: boolean;
  status: GateStatus;
  message: string;
  evidenceId?: string;
}

export interface GovernanceBadge {
  key: string;
  label: string;
  tone: "neutral" | "positive" | "negative" | "warning";
}

export interface GovernanceHistoryItem {
  id: string;
  kind: "lifecycle" | "evidence";
  timestamp: string;
  title: string;
  detail: string;
  actor: string;
}

export interface GovernanceProjection {
  reviewStatus: ReviewStatus;
  reviewStatusLabel: string;
  canPublish: boolean;
  gates: GovernanceGate[];
  badges: GovernanceBadge[];
  evidence: EvidenceAssessment[];
}

export interface GovernanceExecutionReader {
  getById(executionId: string): ExecutionRecord | null;
}

function newestFirst(left: Evidence, right: Evidence): number {
  const time = Date.parse(right.timestamp) - Date.parse(left.timestamp);
  return time === 0 ? right.evidence_id.localeCompare(left.evidence_id) : time;
}

function latestEvidenceByType(evidence: readonly Evidence[]): Map<EvidenceType, Evidence> {
  const latest = new Map<EvidenceType, Evidence>();
  for (const record of [...evidence].sort(newestFirst)) {
    if (!latest.has(record.evidence_type)) latest.set(record.evidence_type, record);
  }
  return latest;
}

function hasPassingAssertions(evidence: Evidence): boolean {
  return (
    evidence.details.assertions.length > 0 &&
    evidence.details.assertions.every((assertion) => assertion.passed)
  );
}

export function assessEvidence(
  record: AssetVersionRecord,
  evidence: readonly Evidence[],
): EvidenceAssessment[] {
  const latest = latestEvidenceByType(evidence);
  return [...evidence].sort(newestFirst).map((item) => {
    if (latest.get(item.evidence_type)?.evidence_id !== item.evidence_id) {
      return {
        evidence: item,
        state: "superseded",
        label: "Superseded / stale",
        gateEligible: false,
      };
    }
    if (
      record.asset_version.subject_digest === null ||
      item.subject_digest !== record.asset_version.subject_digest
    ) {
      return {
        evidence: item,
        state: "stale_digest",
        label: "Digest mismatch / needs refresh",
        gateEligible: false,
      };
    }
    if (item.artifact_version !== record.asset_version.version) {
      return {
        evidence: item,
        state: "stale_artifact",
        label: "Artifact version mismatch / needs refresh",
        gateEligible: false,
      };
    }
    if (item.result === "passed" && hasPassingAssertions(item)) {
      return { evidence: item, state: "passed", label: "Passed", gateEligible: true };
    }
    if (item.result === "not_applicable" && hasPassingAssertions(item)) {
      return {
        evidence: item,
        state: "not_applicable",
        label: "Documented not applicable",
        gateEligible: true,
      };
    }
    if (item.result === "informational") {
      return {
        evidence: item,
        state: "informational",
        label: "Informational only",
        gateEligible: false,
      };
    }
    return {
      evidence: item,
      state: "failed",
      label:
        item.result === "needs_changes" ? "Needs changes" : "Failed / non-passing",
      gateEligible: false,
    };
  });
}

function gateFromEvidence(
  key: GovernanceGate["key"],
  label: string,
  assessment: EvidenceAssessment | undefined,
): GovernanceGate {
  if (assessment === undefined) {
    return {
      key,
      label,
      required: true,
      status: "missing",
      message: `${label} evidence has not been recorded.`,
    };
  }
  if (assessment.state === "passed") {
    return {
      key,
      label,
      required: true,
      status: "passed",
      message: `${label} evidence is current and passing.`,
      evidenceId: assessment.evidence.evidence_id,
    };
  }
  const stale = assessment.state === "stale_digest" ||
    assessment.state === "stale_artifact" ||
    assessment.state === "superseded";
  return {
    key,
    label,
    required: true,
    status: stale ? "stale" : "failed",
    message: `${label} evidence is ${assessment.label.toLowerCase()} and cannot satisfy publication.`,
    evidenceId: assessment.evidence.evidence_id,
  };
}

function latestAssessment(
  assessments: readonly EvidenceAssessment[],
  type: EvidenceType,
): EvidenceAssessment | undefined {
  return assessments.find((item) => item.evidence.evidence_type === type);
}

function reviewStatusFor(
  assessment: EvidenceAssessment | undefined,
): Pick<GovernanceProjection, "reviewStatus" | "reviewStatusLabel"> {
  if (assessment === undefined || assessment.state === "informational") {
    return { reviewStatus: "not_reviewed", reviewStatusLabel: "Not reviewed" };
  }
  if (assessment.state === "passed") {
    return { reviewStatus: "passed", reviewStatusLabel: "Review passed" };
  }
  if (
    assessment.state === "stale_digest" ||
    assessment.state === "stale_artifact" ||
    assessment.state === "superseded"
  ) {
    return {
      reviewStatus: "expired_needs_refresh",
      reviewStatusLabel: "Review expired / needs refresh",
    };
  }
  return {
    reviewStatus: "failed_or_needs_changes",
    reviewStatusLabel: "Review failed / needs changes",
  };
}

function sourceNotApplicableIsValid(
  record: AssetVersionRecord,
  assessment: EvidenceAssessment,
): boolean {
  const item = assessment.evidence;
  if (
    assessment.state !== "not_applicable" ||
    record.asset_version.source_class !== "created_during_event"
  ) {
    return false;
  }
  const documentation = [
    record.asset_version.source_reference ?? "",
    record.asset_version.summary,
    record.asset_version.description,
    item.scope,
    item.details.summary,
    JSON.stringify(item.observed),
  ].join(" ");
  return /synthetic/i.test(documentation) && /not[ _-]?applicable/i.test(documentation);
}

function verifyExecutionEvidence(
  record: AssetVersionRecord,
  assessment: EvidenceAssessment | undefined,
  executionReader: GovernanceExecutionReader | undefined,
  type: "functional_test" | "guardrail_test",
): GovernanceGate {
  const base = gateFromEvidence(
    type,
    type === "functional_test" ? "Typical functional test" : "Failure / guardrail test",
    assessment,
  );
  if (base.status !== "passed" || assessment === undefined) return base;
  if (executionReader === undefined || assessment.evidence.execution_ids.length === 0) {
    return {
      ...base,
      status: "failed",
      message: `${base.label} evidence lacks verifiable persisted execution records.`,
    };
  }
  const executions = assessment.evidence.execution_ids.map((id) =>
    executionReader.getById(id),
  );
  const matches = executions.every(
    (execution) =>
      execution !== null &&
      execution.asset_id === record.asset.asset_id &&
      execution.asset_version_id === record.asset_version.asset_version_id &&
      execution.asset_version === record.asset_version.version &&
      execution.purpose === "prepublication_test" &&
      ["succeeded", "failed", "invalid", "blocked"].includes(execution.status),
  );
  const functionalSucceeded =
    type !== "functional_test" ||
    executions.every((execution) => execution?.status === "succeeded");
  if (!matches || !functionalSucceeded) {
    return {
      ...base,
      status: "failed",
      message: `${base.label} evidence does not match successful, persisted prepublication execution provenance.`,
    };
  }
  return base;
}

function notRequiredGate(
  key: GovernanceGate["key"],
  label: string,
  message: string,
): GovernanceGate {
  return { key, label, required: false, status: "not_required", message };
}

export function buildGovernanceProjection(
  record: AssetVersionRecord,
  evidence: readonly Evidence[],
  executorLookup?: ExecutorLookup,
  executionReader?: GovernanceExecutionReader,
): GovernanceProjection {
  const assessments = assessEvidence(record, evidence);
  const human = latestAssessment(assessments, "human_review");
  const review = reviewStatusFor(human);
  const version = record.asset_version;
  let frozenStatus: GateStatus = "missing";
  let frozenMessage = "Freeze the final version content and subject digest before collecting evidence.";
  if (version.subject_digest !== null) {
    const { lifecycle, subject_digest, published_at, deprecated_at, replacement_version, ...content } = version;
    void lifecycle;
    void published_at;
    void deprecated_at;
    void replacement_version;
    const recomputed = computeSubjectDigest(content);
    frozenStatus = recomputed === subject_digest ? "passed" : "failed";
    frozenMessage = recomputed === subject_digest
      ? "The stored subject digest matches the exact immutable version content."
      : "The stored subject digest does not match the immutable version content.";
  }

  const permissionFieldsPassed = [
    version.access_permission,
    version.tool_use_permission,
    version.final_package_permission,
  ].every((permission) => permission !== "unconfirmed");

  const source = latestAssessment(assessments, "source_permission");
  let sourceGate = gateFromEvidence(
    "source_permission",
    "Source permission",
    source,
  );
  if (source?.state === "not_applicable") {
    const valid = sourceNotApplicableIsValid(record, source);
    sourceGate = {
      ...sourceGate,
      status: valid ? "passed" : "failed",
      message: valid
        ? "Source permission is documented as not applicable for event-created synthetic material."
        : "Not applicable is allowed only for documented event-created synthetic material.",
      evidenceId: source.evidence.evidence_id,
    };
  }

  const runnable = version.availability === "runnable";
  let executorGate: GovernanceGate;
  if (!runnable) {
    executorGate = notRequiredGate(
      "executor_binding",
      "Allowlisted executor binding",
      `${version.availability.replaceAll("_", " ")} versions do not require execution evidence and remain non-runnable.`,
    );
  } else {
    const executor =
      version.executor_key === undefined
        ? undefined
        : executorLookup?.find(version.executor_key);
    const valid =
      version.executor_key !== undefined &&
      version.definition_digest !== undefined &&
      executor !== undefined &&
      executor.key === version.executor_key &&
      executor.definitionDigest === version.definition_digest;
    executorGate = {
      key: "executor_binding",
      label: "Allowlisted executor binding",
      required: true,
      status: valid ? "passed" : "failed",
      message: valid
        ? "The executor is server-allowlisted and matches the frozen definition digest."
        : "The runnable version lacks a matching server-allowlisted executor and definition digest.",
    };
  }

  const functionalGate = runnable
    ? verifyExecutionEvidence(
        record,
        latestAssessment(assessments, "functional_test"),
        executionReader,
        "functional_test",
      )
    : notRequiredGate(
        "functional_test",
        "Typical functional test",
        "Execution evidence is not required for a non-runnable version.",
      );
  const guardrailGate = runnable
    ? verifyExecutionEvidence(
        record,
        latestAssessment(assessments, "guardrail_test"),
        executionReader,
        "guardrail_test",
      )
    : notRequiredGate(
        "guardrail_test",
        "Failure / guardrail test",
        "Execution evidence is not required for a non-runnable version.",
      );

  let securityGate: GovernanceGate;
  if (!runnable) {
    securityGate = notRequiredGate(
      "security_review",
      "Security and data-handling review",
      "A scoped execution security review is not required for a non-runnable version.",
    );
  } else {
    const security = latestAssessment(assessments, "security_review");
    securityGate = gateFromEvidence(
      "security_review",
      "Security and data-handling review",
      security,
    );
    if (securityGate.status === "passed" && security !== undefined) {
      const data = security.evidence.details.data;
      const reviewerName = human?.evidence.reviewer?.name;
      const accepted =
        security.evidence.actor_type !== "system" &&
        security.evidence.reviewer !== undefined &&
        /security/i.test(security.evidence.scope) &&
        /data/i.test(security.evidence.scope) &&
        security.evidence.details.assertions.some(
          (assertion) =>
            assertion.name === SECURITY_ACCEPTANCE_ASSERTION && assertion.passed,
        ) &&
        data?.prepublication_reviewer_accepted === true &&
        typeof data.prepublication_reviewer_name === "string" &&
        data.prepublication_reviewer_name === reviewerName &&
        security.evidence.reviewer.name === reviewerName;
      if (!accepted) {
        securityGate = {
          ...securityGate,
          status: "failed",
          message:
            "The named passing human reviewer must explicitly accept the scoped security and data-handling review.",
        };
      }
    }
  }

  const gates: GovernanceGate[] = [
    {
      key: "frozen_subject",
      label: "Frozen subject digest",
      required: true,
      status: frozenStatus,
      message: frozenMessage,
    },
    {
      key: "permission_fields",
      label: "Permission decisions",
      required: true,
      status: permissionFieldsPassed ? "passed" : "failed",
      message: permissionFieldsPassed
        ? "Access, tool-use, and final-package permission decisions are resolved."
        : "Resolve every unconfirmed access, tool-use, and final-package permission decision.",
    },
    gateFromEvidence(
      "metadata_validation",
      "Metadata validation",
      latestAssessment(assessments, "metadata_validation"),
    ),
    gateFromEvidence("human_review", "Human review", human),
    sourceGate,
    executorGate,
    functionalGate,
    guardrailGate,
    securityGate,
  ];

  const badges: GovernanceBadge[] = [
    {
      key: "lifecycle",
      label: version.lifecycle.replaceAll("_", " "),
      tone: version.lifecycle === "published" ? "positive" : "neutral",
    },
    {
      key: "review",
      label: review.reviewStatusLabel,
      tone:
        review.reviewStatus === "passed"
          ? "positive"
          : review.reviewStatus === "not_reviewed"
            ? "neutral"
            : "negative",
    },
    {
      key: "availability",
      label:
        version.availability === "runnable"
          ? executorGate.status === "passed"
            ? "Runnable executor allowlisted"
            : "Runnable metadata; executor not verified"
          : version.availability.replaceAll("_", " "),
      tone:
        version.availability === "runnable" && executorGate.status === "passed"
          ? "positive"
          : "neutral",
    },
  ];
  if (functionalGate.status === "passed") {
    badges.push({ key: "functional", label: "Functionally tested", tone: "positive" });
  }
  if (securityGate.status === "passed") {
    badges.push({ key: "security", label: "Security review passed", tone: "positive" });
  }

  return {
    ...review,
    canPublish: gates.every(
      (gate) => !gate.required || gate.status === "passed",
    ),
    gates,
    badges,
    evidence: assessments,
  };
}

export function buildGovernanceHistory(
  events: readonly LifecycleEvent[],
  evidence: readonly Evidence[],
): GovernanceHistoryItem[] {
  const eventItems: GovernanceHistoryItem[] = events.map((event) => ({
    id: event.event_id,
    kind: "lifecycle",
    timestamp: event.timestamp,
    title: `${event.from_state ?? "created"} → ${event.to_state}`,
    detail: event.reason,
    actor:
      event.actor_type === "system"
        ? "System"
        : `${event.actor_name ?? "Unnamed actor"} (${event.actor_type.replaceAll("_", " ")})`,
  }));
  const evidenceItems: GovernanceHistoryItem[] = evidence.map((item) => ({
    id: item.evidence_id,
    kind: "evidence",
    timestamp: item.timestamp,
    title: `${item.evidence_type.replaceAll("_", " ")} · ${item.result.replaceAll("_", " ")}`,
    detail: item.details.summary,
    actor:
      item.actor_type === "system"
        ? "System"
        : `${item.reviewer?.name ?? item.actor_name ?? "Unnamed actor"} (${item.actor_type.replaceAll("_", " ")})`,
  }));
  return [...eventItems, ...evidenceItems].sort(
    (left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
      right.id.localeCompare(left.id),
  );
}

