import {
  ImpactPreviewSchema,
  type AffectedEntity,
  type AssetVersionRecord,
  type Evidence,
  type ExecutionRecord,
  type ImpactActionKey,
  type ImpactPreview,
  type StateFact,
} from "@/contracts";
import type { GovernanceProjection } from "@/modules/governance";

export interface ImpactSubject {
  record: AssetVersionRecord;
  evidence: Evidence[];
  executions: ExecutionRecord[];
  projection: GovernanceProjection;
  /** Other current published versions, used to state the catalog effect exactly. */
  publishedCount: number;
}

const FLAG_REASON =
  "Flagged from an investigation: current content is not covered by current review evidence.";

function fact(label: string, value: string, tone: StateFact["tone"]): StateFact {
  return { label, value, tone };
}

function inPublicCatalog(subject: ImpactSubject): boolean {
  const version = subject.record.asset_version;
  return (
    version.lifecycle === "published" &&
    version.deprecated_at === null &&
    subject.record.asset.current_published_version_id === version.asset_version_id
  );
}

function affectedRecords(subject: ImpactSubject, atRisk: boolean): AffectedEntity[] {
  const succeeded = subject.executions.filter((record) => record.status === "succeeded");
  const entries: AffectedEntity[] = [
    {
      label: "Evidence records",
      count: subject.evidence.length,
      detail: "Retained. Evidence is append-only and is never deleted by a lifecycle change.",
      at_risk: false,
    },
  ];

  if (subject.executions.length > 0) {
    entries.push({
      label: "Persisted executions",
      count: subject.executions.length,
      detail: `Retained, including ${succeeded.length} succeeded. Past runs stay auditable.`,
      at_risk: false,
    });
  }

  entries.push({
    label: "Public catalog entries",
    count: inPublicCatalog(subject) ? 1 : 0,
    detail: atRisk
      ? `This version leaves the public catalog, taking it from ${subject.publishedCount} to ${subject.publishedCount - 1}.`
      : "Unchanged by this action.",
    at_risk: atRisk && inPublicCatalog(subject),
  });

  return entries;
}

/**
 * Builds a deterministic before/after for one action. Every fact is read from
 * persisted state or from a transition rule the governance service enforces; no
 * consequence here is estimated.
 */
export function buildImpactPreview(
  subject: ImpactSubject,
  action: ImpactActionKey,
): ImpactPreview {
  const version = subject.record.asset_version;
  const published = inPublicCatalog(subject);
  const blocking = subject.projection.gates.filter(
    (gate) => gate.status === "missing" || gate.status === "failed" || gate.status === "stale",
  );

  const base = {
    action,
    current_state: [
      fact(
        "Lifecycle",
        version.lifecycle.replaceAll("_", " "),
        version.lifecycle === "published" ? "positive" : "neutral",
      ),
      fact(
        "Public catalog",
        published ? "Listed" : "Not listed",
        published ? "positive" : "neutral",
      ),
      fact(
        "Discovery",
        published ? "Returned in results" : "Excluded from results",
        published ? "positive" : "neutral",
      ),
      fact(
        "Required gates",
        `${subject.projection.gates.filter((gate) => gate.status === "passed").length} of ${subject.projection.gates.filter((gate) => gate.status !== "not_required").length} passing`,
        blocking.length === 0 ? "positive" : "warning",
      ),
    ],
  };

  if (action === "flag_for_review") {
    const available = version.lifecycle === "published";
    return ImpactPreviewSchema.parse({
      ...base,
      title: "Flag for re-review",
      question: `Remove ${version.name} from public discovery until it is re-reviewed?`,
      available,
      unavailable_reason: available
        ? null
        : "Only a published version can be flagged for re-review.",
      resulting_state: [
        fact("Lifecycle", "deprecated", "warning"),
        fact("Public catalog", "Removed", "negative"),
        fact("Discovery", "Excluded from results", "negative"),
        fact("Existing evidence", "Retained in full", "positive"),
      ],
      affected: affectedRecords(subject, true),
      reversible: false,
      reversibility_note:
        "Deprecation is recorded as an append-only lifecycle event and cannot be undone in place. Restoring the asset requires publishing a new reviewed version.",
      confirm_label: "Flag for re-review",
      endpoint: available
        ? `/api/governance/versions/${version.asset_version_id}/transitions`
        : null,
      body: available
        ? {
            to_state: "deprecated",
            actor_type: "demo_reviewer",
            actor_name: "Marketplace reviewer",
            reason: FLAG_REASON,
          }
        : null,
    });
  }

  if (action === "metadata_validation") {
    return ImpactPreviewSchema.parse({
      ...base,
      title: "Re-run metadata validation",
      question: `Re-validate ${version.name} against its current subject digest?`,
      available: true,
      unavailable_reason: null,
      resulting_state: [
        fact("Lifecycle", version.lifecycle.replaceAll("_", " "), "neutral"),
        fact("Public catalog", published ? "Unchanged" : "Unchanged", "neutral"),
        fact("Evidence", "One new metadata_validation record appended", "positive"),
        fact("Gates", "Recomputed against the current digest", "positive"),
      ],
      affected: affectedRecords(subject, false),
      reversible: false,
      reversibility_note:
        "Evidence is append-only. The new record is added; nothing existing is modified or removed.",
      confirm_label: "Run validation",
      endpoint: `/api/governance/versions/${version.asset_version_id}/checks/metadata`,
      body: {},
    });
  }

  if (action === "submit_for_review") {
    const available = version.lifecycle === "draft";
    return ImpactPreviewSchema.parse({
      ...base,
      title: "Submit for review",
      question: `Move ${version.name} into the review queue?`,
      available,
      unavailable_reason: available ? null : "Only a draft can be submitted for review.",
      resulting_state: [
        fact("Lifecycle", "submitted", "neutral"),
        fact("Public catalog", "Still excluded", "neutral"),
        fact("Reviewer action", "Required before publication", "warning"),
      ],
      affected: affectedRecords(subject, false),
      reversible: false,
      reversibility_note: "Lifecycle events are append-only and recorded with an actor and reason.",
      confirm_label: "Submit",
      endpoint: available
        ? `/api/governance/versions/${version.asset_version_id}/transitions`
        : null,
      body: available
        ? {
            to_state: "submitted",
            actor_type: "team_member",
            actor_name: "Marketplace contributor",
            reason: "Submitted for prototype review from an impact preview.",
          }
        : null,
    });
  }

  const canPublish = subject.projection.canPublish && version.lifecycle === "in_review";
  return ImpactPreviewSchema.parse({
    ...base,
    title: "Publish",
    question: `Publish ${version.name} to the public catalog?`,
    available: canPublish,
    unavailable_reason: canPublish
      ? null
      : version.lifecycle !== "in_review"
        ? "Only a version in review can be published."
        : `Publication is blocked by ${blocking.length} gate${blocking.length === 1 ? "" : "s"}: ${blocking.map((gate) => gate.label).join(", ")}.`,
    resulting_state: [
      fact("Lifecycle", "published", "positive"),
      fact("Public catalog", `Listed, taking the catalog to ${subject.publishedCount + 1}`, "positive"),
      fact("Discovery", "Returned in results", "positive"),
      fact("Frozen content", "Unchanged. Publication alters lifecycle only.", "positive"),
    ],
    affected: affectedRecords(subject, false),
    reversible: false,
    reversibility_note:
      "Publication is append-only. A published version can later be deprecated, but its content can never be edited in place.",
    confirm_label: "Publish",
    endpoint: canPublish
      ? `/api/governance/versions/${version.asset_version_id}/transitions`
      : null,
    body: canPublish
      ? {
          to_state: "published",
          actor_type: "demo_reviewer",
          actor_name: "Marketplace reviewer",
          reason: "Published from an impact preview after every required gate passed.",
          confirm_publication: true,
        }
      : null,
  });
}
