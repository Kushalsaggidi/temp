import Link from "next/link";
import type { Metadata } from "next";

import { StepChart } from "@/components/charts/step-chart";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { AppShell } from "@/components/shell/app-shell";
import { IconAlert, IconArrowDown, IconCheck } from "@/components/ui/icons";
import { loadTrustDrift } from "@/modules/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recent changes",
  description: "Assets whose required checks no longer cover the version people receive.",
};

export default async function DriftPage() {
  const drift = loadTrustDrift();
  const count = drift.entries.length;

  return (
    <AppShell
      area="drift"
      crumbs={[{ label: "Recent changes" }]}
      attentionCount={count}
    >
      <header className="page-head">
        <h1>
          {count === 0
            ? "Nothing has slipped since its last check"
            : `${count} ${count === 1 ? "asset has" : "assets have"} changed since ${count === 1 ? "it was" : "they were"} last checked`}
        </h1>
        <p>
          These were fine when they were last checked, but something has changed since.
          Nothing here is broken. It means a check should be redone before anyone relies on
          the asset.
        </p>
      </header>

      {count === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <IconCheck style={{ width: 20, height: 20, color: "var(--success)" }} />
          </span>
          <h3>Everything is up to date</h3>
          <p>
            All {drift.scanned} published assets have current checks that cover the content
            people receive. This page will list anything that falls behind.
          </p>
          <Link className="btn btn--sm btn--secondary" href="/marketplace">
            Browse the marketplace
          </Link>
        </div>
      ) : (
        <>
          <section className="panel">
            <div className="panel__head">
              <h2>What changed</h2>
              <span className="t-caption" style={{ marginLeft: "auto" }}>
                {drift.scanned} published assets checked
              </span>
            </div>
            <div>
              {drift.entries.map((entry) => (
                <div className="drift-row" key={entry.asset_version_id}>
                  <span
                    className={`drift-row__delta drift-row__delta--${entry.severity}`}
                    aria-label={`Down ${Math.abs(entry.delta)} points`}
                  >
                    <IconArrowDown style={{ width: 14, height: 14 }} />
                    {Math.abs(entry.delta)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="attention__title">
                      <Link href={`/assets/${entry.asset_version_id}`}>{entry.name}</Link>
                    </p>
                    <p className="t-small">{entry.reason}</p>
                  </div>
                  <span className="pill pill--warning">
                    <span className="pill__dot" />
                    {entry.from_score} → {entry.to_score}
                  </span>
                  <div className="attention__actions">
                    <InvestigateButton
                      assetVersionId={entry.asset_version_id}
                      assetName={entry.name}
                      variant="primary"
                      label="Check readiness"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2>How each one changed</h2>
              <p>Only the moments the system actually recorded are shown.</p>
            </div>
            <div className="two-col">
              {drift.entries.map((entry) => (
                <div className="panel" key={`chart-${entry.asset_version_id}`}>
                  <div className="panel__head">
                    <h3>{entry.name}</h3>
                  </div>
                  <div className="panel__body">
                    <StepChart
                      steps={entry.steps}
                      caption="Score at each recorded point. The line holds flat between them because no score was measured in between."
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="notice" style={{ marginTop: "var(--sp-8)" }}>
        <IconAlert className="notice__icon" />
        <span>{drift.method}</span>
      </div>
    </AppShell>
  );
}
