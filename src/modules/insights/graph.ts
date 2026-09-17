import {
  ImpactGraphSchema,
  type AssetVersionRecord,
  type Evidence,
  type ExecutionRecord,
  type GraphEdge,
  type GraphNode,
  type ImpactGraph,
} from "@/contracts";
import type { EvidenceAssessment } from "@/modules/governance";

export interface GraphSubject {
  record: AssetVersionRecord;
  assessments: readonly EvidenceAssessment[];
  executions: ExecutionRecord[];
  /** Other published versions that share a capability, from the discovery ranker. */
  related: { asset_version_id: string; name: string; similarity: number }[];
  /** Earlier published versions of the same asset. */
  siblings: AssetVersionRecord[];
}

const EVIDENCE_TONE: Record<string, GraphNode["tone"]> = {
  passed: "positive",
  not_applicable: "positive",
  informational: "neutral",
  stale_digest: "warning",
  stale_artifact: "warning",
  superseded: "neutral",
  failed: "negative",
};

function shortDigest(value: string | null): string {
  return value === null ? "not frozen" : `${value.slice(7, 15)}…`;
}

function evidenceNode(assessment: EvidenceAssessment, affected: boolean): GraphNode {
  const { evidence } = assessment;
  return {
    id: evidence.evidence_id,
    kind: "evidence",
    label: evidence.evidence_type.replaceAll("_", " "),
    sublabel: assessment.label,
    tone: EVIDENCE_TONE[assessment.state] ?? "neutral",
    affected,
    href: null,
    detail: [
      { label: "Evidence ID", value: evidence.evidence_id },
      { label: "Result", value: evidence.result.replaceAll("_", " ") },
      { label: "Subject digest", value: evidence.subject_digest },
      { label: "Recorded", value: evidence.timestamp },
      ...(evidence.reviewer ? [{ label: "Reviewer", value: evidence.reviewer.name }] : []),
    ],
  };
}

function executionNode(record: ExecutionRecord, affected: boolean): GraphNode {
  return {
    id: record.execution_id,
    kind: "execution",
    label: record.scenario_label ?? "Run",
    sublabel: record.status,
    tone:
      record.status === "succeeded"
        ? "positive"
        : record.status === "invalid" || record.status === "blocked"
          ? "warning"
          : "negative",
    affected,
    href: null,
    detail: [
      { label: "Execution ID", value: record.execution_id },
      { label: "Purpose", value: record.purpose.replaceAll("_", " ") },
      { label: "Status", value: record.status },
      { label: "Started", value: record.started_at },
      ...(record.executor_key ? [{ label: "Executor", value: record.executor_key }] : []),
    ],
  };
}

/**
 * Builds the dependency view from rows that actually exist. A relationship is
 * included only when it is stored (evidence, executions, versions of an asset) or
 * derived by the same deterministic ranker discovery uses, which is labelled as
 * derived so a reviewer can tell the two apart.
 */
export function buildImpactGraph(subject: GraphSubject): ImpactGraph {
  const version = subject.record.asset_version;
  const published =
    version.lifecycle === "published" &&
    version.deprecated_at === null &&
    subject.record.asset.current_published_version_id === version.asset_version_id;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: subject.record.asset.asset_id,
    kind: "asset",
    label: version.name,
    sublabel: subject.record.asset.slug,
    tone: "brand",
    affected: false,
    href: null,
    detail: [
      { label: "Asset ID", value: subject.record.asset.asset_id },
      {
        label: "Current published version",
        value: subject.record.asset.current_published_version_id ?? "none",
      },
    ],
  });

  nodes.push({
    id: version.asset_version_id,
    kind: "version",
    label: `v${version.version}`,
    sublabel: version.lifecycle.replaceAll("_", " "),
    tone: published ? "positive" : "neutral",
    affected: true,
    href: `/assets/${version.asset_version_id}`,
    detail: [
      { label: "Version ID", value: version.asset_version_id },
      { label: "Availability", value: version.availability.replaceAll("_", " ") },
      { label: "Subject digest", value: version.subject_digest ?? "not frozen" },
    ],
  });
  edges.push({
    from: subject.record.asset.asset_id,
    to: version.asset_version_id,
    label: "has version",
    derived: false,
  });

  nodes.push({
    id: `owner:${version.owner}`,
    kind: "owner",
    label: version.owner,
    sublabel: "Declared owner",
    tone: "neutral",
    affected: false,
    href: null,
    detail: [{ label: "Owner", value: version.owner }],
  });
  edges.push({
    from: version.asset_version_id,
    to: `owner:${version.owner}`,
    label: "owned by",
    derived: false,
  });

  for (const assessment of subject.assessments) {
    // Evidence bound to a different digest is the relationship that breaks first.
    const affected =
      assessment.state === "stale_digest" || assessment.state === "stale_artifact";
    nodes.push(evidenceNode(assessment, affected));
    edges.push({
      from: version.asset_version_id,
      to: assessment.evidence.evidence_id,
      label: "evidenced by",
      derived: false,
    });
  }

  for (const scenario of version.test_scenarios) {
    nodes.push({
      id: scenario.scenario_id,
      kind: "scenario",
      label: scenario.label,
      sublabel: "Frozen scenario",
      tone: "neutral",
      affected: false,
      href: null,
      detail: [
        { label: "Scenario ID", value: scenario.scenario_id },
        { label: "Description", value: scenario.description },
      ],
    });
    edges.push({
      from: version.asset_version_id,
      to: scenario.scenario_id,
      label: "defines",
      derived: false,
    });
  }

  for (const record of subject.executions) {
    nodes.push(executionNode(record, published));
    const scenarioNode = version.test_scenarios.find(
      (scenario) => scenario.label === record.scenario_label,
    );
    edges.push({
      from: scenarioNode ? scenarioNode.scenario_id : version.asset_version_id,
      to: record.execution_id,
      label: scenarioNode ? "executed as" : "ran",
      derived: false,
    });
  }

  for (const sibling of subject.siblings) {
    nodes.push({
      id: sibling.asset_version.asset_version_id,
      kind: "version",
      label: `v${sibling.asset_version.version}`,
      sublabel: "earlier published version",
      tone: "neutral",
      affected: false,
      href: `/governance/${sibling.asset_version.asset_version_id}`,
      detail: [
        { label: "Version ID", value: sibling.asset_version.asset_version_id },
        { label: "Subject digest", value: shortDigest(sibling.asset_version.subject_digest) },
      ],
    });
    edges.push({
      from: subject.record.asset.asset_id,
      to: sibling.asset_version.asset_version_id,
      label: "has version",
      derived: false,
    });
  }

  for (const related of subject.related.slice(0, 3)) {
    nodes.push({
      id: related.asset_version_id,
      kind: "related_asset",
      label: related.name,
      sublabel: `${related.similarity}% capability overlap`,
      tone: "neutral",
      affected: false,
      href: `/assets/${related.asset_version_id}`,
      detail: [
        { label: "Version ID", value: related.asset_version_id },
        { label: "Overlap", value: `${related.similarity}%` },
        { label: "Source", value: "Derived from the deterministic discovery ranker" },
      ],
    });
    edges.push({
      from: version.asset_version_id,
      to: related.asset_version_id,
      label: "covers similar work",
      derived: true,
    });
  }

  const affectedCount = nodes.filter((node) => node.affected).length;
  const staleEvidence = subject.assessments.filter(
    (assessment) =>
      assessment.state === "stale_digest" || assessment.state === "stale_artifact",
  ).length;

  const parts = [
    `${subject.assessments.length} evidence record${subject.assessments.length === 1 ? "" : "s"}`,
    `${subject.executions.length} execution${subject.executions.length === 1 ? "" : "s"}`,
    `${subject.related.length} related asset${subject.related.length === 1 ? "" : "s"}`,
  ];

  return ImpactGraphSchema.parse({
    asset_version_id: version.asset_version_id,
    nodes,
    edges,
    affected_count: affectedCount,
    summary:
      staleEvidence > 0
        ? `${parts.join(", ")}. ${staleEvidence} evidence relationship${staleEvidence === 1 ? "" : "s"} no longer match this version's digest.`
        : `${parts.join(", ")}. Every stored relationship matches this version's digest.`,
  });
}
