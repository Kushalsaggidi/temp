import Link from "next/link";
import type { Metadata } from "next";

import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { IconAlert, IconEmpty } from "@/components/ui/icons";
import { TrustRing } from "@/components/ui/trust-ring";
import type { CompareRow } from "@/contracts";
import { loadComparison } from "@/modules/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare assets",
  description: "See the factual differences between two or more assets side by side.",
};

const GROUP_LABEL: Record<CompareRow["group"], string> = {
  trust: "Readiness",
  governance: "Checks",
  contract: "How you use it",
  capability: "What it does",
};

const TONE_CLASS = {
  positive: "pill--success",
  warning: "pill--warning",
  negative: "pill--danger",
  neutral: "",
} as const;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const requested = (ids ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);

  const comparison = requested.length >= 2 ? loadComparison(requested) : null;

  if (comparison === null) {
    return (
      <AppShell area="marketplace" crumbs={[{ label: "Compare" }]}>
        <header className="page-head">
          <h1>Compare assets</h1>
          <p>Pick two assets to see their differences side by side.</p>
        </header>
        <div className="empty">
          <span className="empty__icon">
            <IconEmpty style={{ width: 20, height: 20 }} />
          </span>
          <h3>Nothing to compare yet</h3>
          <p>
            Open an asset, choose <strong>Check readiness</strong>, then pick{" "}
            <strong>Compare</strong> on any alternative. You can also compare straight from
            the marketplace.
          </p>
          <Link className="btn btn--sm" href="/marketplace">
            Browse the marketplace
          </Link>
        </div>
      </AppShell>
    );
  }

  const groups: CompareRow["group"][] = ["trust", "governance", "contract", "capability"];

  return (
    <AppShell area="marketplace" wide crumbs={[{ label: "Compare" }]}>
      <SetAiContext
        surface="compare"
        label={comparison.subjects.map((subject) => subject.name).join(" vs ")}
        assetVersionId={comparison.subjects[0]?.asset_version_id ?? null}
        assetName={comparison.subjects[0]?.name ?? null}
        compareIds={comparison.subjects.map((subject) => subject.asset_version_id)}
      />
      <header className="page-head">
        <h1>Compare assets</h1>
        <p>
          {comparison.observation} Rows that differ are highlighted so you can see what
          actually sets them apart.
        </p>
      </header>

      <div className="panel">
        <div className="compare-scroll">
          <table className="compare-table">
            <caption className="t-caption" style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "left" }}>
              {comparison.differing_rows} of {comparison.rows.length} attributes differ.
            </caption>
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                {comparison.subjects.map((subject) => (
                  <th scope="col" key={subject.asset_version_id}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                      <TrustRing trust={subject.trust} size="sm" showMeta={false} />
                      <span style={{ minWidth: 0 }}>
                        <Link href={`/assets/${subject.asset_version_id}`}>{subject.name}</Link>
                        <span className="t-caption" style={{ display: "block", fontWeight: 400 }}>
                          v{subject.version} · {subject.trust.label}
                        </span>
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => {
              const rows = comparison.rows.filter((row) => row.group === group);
              if (rows.length === 0) return null;
              return (
                <tbody key={group}>
                  <tr className="compare-group">
                    <th scope="colgroup" colSpan={comparison.subjects.length + 1}>
                      {GROUP_LABEL[group]}
                    </th>
                  </tr>
                  {rows.map((row) => (
                    <tr key={`${group}-${row.label}`} className={row.differs ? "is-different" : undefined}>
                      <th scope="row">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={`${row.label}-${index}`}>
                          <span className={`pill ${TONE_CLASS[value.tone]}`}>
                            <span className="pill__dot" />
                            {value.display}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>

      <div className="notice" style={{ marginTop: "var(--sp-6)" }}>
        <IconAlert className="notice__icon" />
        <span>
          This page shows what each asset holds today. It does not pick a winner — the right
          choice depends on what you need it for.
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-6)", flexWrap: "wrap" }}>
        {comparison.subjects.map((subject) => (
          <Link
            className="btn btn--secondary btn--sm"
            href={`/assets/${subject.asset_version_id}`}
            key={subject.asset_version_id}
          >
            Open {subject.name}
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
