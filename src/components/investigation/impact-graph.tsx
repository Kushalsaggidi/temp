"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { GraphNode, ImpactGraph } from "@/contracts";
import {
  IconAlert,
  IconDocument,
  IconLayers,
  IconRun,
  IconShield,
  IconUser,
} from "@/components/ui/icons";

const KIND_ICON = {
  asset: IconLayers,
  version: IconDocument,
  evidence: IconShield,
  execution: IconRun,
  scenario: IconDocument,
  owner: IconUser,
  related_asset: IconLayers,
} as const;

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  asset: "Asset",
  version: "Version",
  evidence: "Check",
  execution: "Run",
  scenario: "Scenario",
  owner: "Owner",
  related_asset: "Related asset",
};

/** Column order left to right, so the layout reads as a dependency flow. */
const COLUMNS: GraphNode["kind"][][] = [
  ["asset", "owner"],
  ["version"],
  ["evidence", "scenario", "related_asset"],
  ["execution"],
];

export function ImpactGraphView({ graph }: { graph: ImpactGraph }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = graph.nodes.find((node) => node.id === openId) ?? null;

  const columns = useMemo(
    () =>
      COLUMNS.map((kinds) => graph.nodes.filter((node) => kinds.includes(node.kind))).filter(
        (column) => column.length > 0,
      ),
    [graph.nodes],
  );

  const degreeOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
      counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return counts;
  }, [graph.edges]);

  return (
    <div>
      <p className="t-small" style={{ marginBottom: "var(--sp-4)" }}>
        {graph.summary}
      </p>

      <div className="graph" role="group" aria-label="Related records">
        {columns.map((column, columnIndex) => (
          <div className="graph__col" key={columnIndex}>
            {column.map((node, nodeIndex) => {
              const Glyph = KIND_ICON[node.kind];
              const selected = openId === node.id;
              return (
                <button
                  className={`graph__node graph__node--${node.tone}${node.affected ? " is-affected" : ""}${selected ? " is-selected" : ""}`}
                  type="button"
                  key={node.id}
                  aria-pressed={selected}
                  style={{ animationDelay: `${(columnIndex * 3 + nodeIndex) * 45}ms` }}
                  onClick={() => setOpenId(selected ? null : node.id)}
                >
                  <Glyph className="graph__icon" />
                  <span className="graph__body">
                    <span className="graph__label">{node.label}</span>
                    {node.sublabel ? (
                      <span className="graph__sub">{node.sublabel}</span>
                    ) : null}
                  </span>
                  {node.affected ? (
                    <IconAlert className="graph__flag" aria-label="Affected by a change" />
                  ) : null}
                  {(degreeOf.get(node.id) ?? 0) > 1 ? (
                    <span className="graph__degree t-num">{degreeOf.get(node.id)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {open ? (
        <div className="graph-detail" role="status">
          <div className="graph-detail__head">
            <span className="pill">{KIND_LABEL[open.kind]}</span>
            <strong>{open.label}</strong>
            {open.href ? (
              <Link className="btn btn--sm btn--tertiary" href={open.href} style={{ marginLeft: "auto" }}>
                Open
              </Link>
            ) : null}
          </div>
          <dl className="definition">
            {open.detail.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className={item.value.startsWith("sha256:") ? "t-mono" : undefined}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
          Select any item to see its details. Items marked with a warning are the ones a
          change here would affect.
        </p>
      )}

      {graph.edges.some((edge) => edge.derived) ? (
        <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
          Related assets are worked out by matching capabilities. Everything else is a
          stored link.
        </p>
      ) : null}
    </div>
  );
}
