import Link from "next/link";

import { BarChart, ChartCard, StackedBar } from "@/components/charts/bar-chart";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { AppShell } from "@/components/shell/app-shell";
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconDiscovery,
  IconMarketplace,
  IconRun,
  IconShield,
  IconSparkle,
} from "@/components/ui/icons";
import { TRUST_EXPLAINER, relativeTime } from "@/components/ui/language";
import { TrustRing } from "@/components/ui/trust-ring";
import { withGovernanceService } from "@/modules/governance";
import { loadMarketplaceMetrics, loadTrustDrift } from "@/modules/insights";
import { listPublishedTrustSummaries } from "@/modules/investigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const now = Date.now();
  const summaries = await listPublishedTrustSummaries();
  const metrics = loadMarketplaceMetrics();
  const drift = loadTrustDrift();
  const history = await withGovernanceService((service) =>
    service
      .listQueue()
      .map((item) => item.record)
      .filter((record) => record.asset_version.published_at !== null),
  );

  const published = summaries.length;
  const runnable = summaries.filter(
    (item) => item.record.asset_version.availability === "runnable",
  ).length;
  const ready = summaries.filter((item) => item.trust.band === "strong").length;
  // One definition, used by the stat, the list, and the governance page alike.
  const attention = summaries.filter((item) => item.blocking_gates.length > 0);

  const recent = [...history]
    .sort((left, right) =>
      String(right.asset_version.published_at).localeCompare(
        String(left.asset_version.published_at),
      ),
    )
    .slice(0, 5);

  return (
    <AppShell area="overview" attentionCount={drift.entries.length}>
      <header className="page-head">
        <h1 className="t-display">Find. Verify. Reuse.</h1>
        <p className="t-lead" style={{ marginTop: "var(--sp-3)", maxWidth: "56ch" }}>
          Find trusted AI tools and templates across RealPage. Check that they are ready to
          use before starting from scratch.
        </p>
      </header>

      <section aria-labelledby="start-heading">
        <h2 id="start-heading" className="t-label" style={{ marginBottom: "var(--sp-3)" }}>
          Where to start
        </h2>

        <Link className="start-card start-card--ai" href="/control">
          <span className="start-card__icon">
            <IconSparkle style={{ width: 19, height: 19 }} />
          </span>
          <span className="start-card__body">
            <strong>Just tell it what you want to accomplish</strong>
            <span className="start-card__hint">
              The AI Control Center finds, investigates, compares, and prepares work for
              review. It asks before it changes anything.
            </span>
          </span>
          <IconArrowRight className="start-card__go" />
        </Link>

        <div className="two-col" style={{ marginTop: "var(--sp-4)" }}>
          <Link className="start-card" href="/discovery">
            <span className="start-card__icon">
              <IconDiscovery style={{ width: 19, height: 19 }} />
            </span>
            <span className="start-card__body">
              <strong>Tell us what you need</strong>
              <span className="start-card__hint">
                Describe the job in your own words and we will show you what already exists.
              </span>
            </span>
            <IconArrowRight className="start-card__go" />
          </Link>

          <Link className="start-card" href="/marketplace">
            <span className="start-card__icon">
              <IconMarketplace style={{ width: 19, height: 19 }} />
            </span>
            <span className="start-card__body">
              <strong>Browse all assets</strong>
              <span className="start-card__hint">
                See all {published} published tools and templates and filter by what you need.
              </span>
            </span>
            <IconArrowRight className="start-card__go" />
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="health-heading">
        <div className="section__head">
          <h2 id="health-heading">How the catalogue looks today</h2>
        </div>
        <div className="stats">
          <Link className="stat" href="/marketplace">
            <span className="stat__value t-num">{published}</span>
            <span className="stat__label">Assets available</span>
            <span className="stat__hint">Published and open to everyone</span>
          </Link>
          <Link className="stat" href="/marketplace?view=reviewed">
            <span className="stat__value t-num">{ready}</span>
            <span className="stat__label">Ready to use</span>
            <span className="stat__hint">All required checks complete</span>
          </Link>
          <Link className="stat" href="/marketplace?view=runnable">
            <span className="stat__value t-num">{runnable}</span>
            <span className="stat__label">Can be run here</span>
            <span className="stat__hint">Try it without installing anything</span>
          </Link>
          <Link className={`stat${attention.length > 0 ? " stat--alert" : ""}`} href="/governance">
            <span className="stat__value t-num">{attention.length}</span>
            <span className="stat__label">Need attention</span>
            <span className="stat__hint">At least one required check is incomplete</span>
          </Link>
        </div>
      </section>

      {attention.length > 0 ? (
        <section className="section" aria-labelledby="attention-heading">
          <div className="section__head">
            <h2 id="attention-heading">
              {attention.length} {attention.length === 1 ? "asset needs" : "assets need"}{" "}
              attention
            </h2>
            <p>Published, but some required checks are missing.</p>
            <Link className="section__link" href="/governance">
              See all checks
            </Link>
          </div>
          <div className="panel attention">
            {attention.slice(0, 4).map(({ record, trust, last_reviewed, blocking_gates }) => {
              const version = record.asset_version;
              return (
                <div className="attention__row" key={version.asset_version_id}>
                  <span className="attention__icon">
                    <IconAlert style={{ width: 16, height: 16 }} />
                  </span>
                  <div className="attention__body">
                    <p className="attention__title">{version.name}</p>
                    <p className="attention__detail">
                      {blocking_gates.length}{" "}
                      {blocking_gates.length === 1 ? "check" : "checks"} still needed ·{" "}
                      {relativeTime(last_reviewed, now)}
                    </p>
                  </div>
                  <TrustRing trust={trust} size="sm" showMeta={false} />
                  <div className="attention__actions">
                    <InvestigateButton
                      assetVersionId={version.asset_version_id}
                      assetName={version.name}
                      variant="primary"
                      label="Check readiness"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="closer-look">
        <div className="section__head">
          <h2 id="closer-look">A closer look</h2>
          <p>{TRUST_EXPLAINER}</p>
        </div>

        <div className="two-col">
          <ChartCard
            title="How ready are our assets?"
            question="A higher score means less for you to check yourself."
          >
            <BarChart
              data={metrics.trust_bands.map((bucket) => ({
                label: bucket.label,
                value: bucket.value,
                tone: bucket.tone,
              }))}
              caption="Assets grouped by readiness score."
              tableLabel="Score range"
              valueLabel="Assets"
            />
          </ChartCard>

          <ChartCard
            title="Where do checks get stuck?"
            question="Every required check across every published asset."
          >
            <StackedBar
              data={metrics.gate_health.map((bucket) => ({
                label:
                  bucket.label === "Passed"
                    ? "Complete"
                    : bucket.label === "Stale"
                      ? "Needs redoing"
                      : bucket.label === "Failed"
                        ? "Incomplete"
                        : "Not done",
                value: bucket.value,
                tone: bucket.tone,
              }))}
              caption="Required checks by status."
            />
          </ChartCard>
        </div>

        {metrics.usage.length > 0 ? (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <ChartCard
              title="Which assets do people actually use?"
              question="Counted from saved runs, so it reflects real use rather than page views."
            >
              <BarChart
                data={metrics.usage.map((item) => ({
                  label: item.name,
                  value: item.runs,
                  tone: "brand",
                  note: `${item.succeeded} worked`,
                }))}
                caption={`${metrics.total_runs} saved runs across the catalogue.`}
                tableLabel="Asset"
                valueLabel="Times run"
              />
            </ChartCard>
          </div>
        ) : null}
      </section>

      <div className="two-col section">
        <section aria-labelledby="ranked-heading">
          <div className="section__head">
            <h2 id="ranked-heading">Best checked right now</h2>
            <Link className="section__link" href="/marketplace">
              All assets
            </Link>
          </div>
          <div className="panel">
            {[...summaries]
              .sort((left, right) => right.trust.score - left.trust.score)
              .slice(0, 6)
              .map(({ record, trust, last_reviewed }) => {
                const version = record.asset_version;
                return (
                  <div className="attention__row" key={version.asset_version_id}>
                    <TrustRing trust={trust} size="sm" showMeta={false} />
                    <div className="attention__body">
                      <p className="attention__title">
                        <Link href={`/assets/${version.asset_version_id}`}>{version.name}</Link>
                      </p>
                      <p className="attention__detail">{relativeTime(last_reviewed, now)}</p>
                    </div>
                    {version.availability === "runnable" ? (
                      <span className="pill pill--brand">
                        <IconRun style={{ width: 11, height: 11 }} />
                        Can be run
                      </span>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </section>

        <section aria-labelledby="activity-heading">
          <div className="section__head">
            <h2 id="activity-heading">Recently added</h2>
          </div>
          <div className="panel panel__body">
            <ul className="timeline">
              {recent.map((record) => {
                const version = record.asset_version;
                return (
                  <li className="tl-item tl-item--lifecycle" key={version.asset_version_id}>
                    <span className="tl-item__dot" aria-hidden="true" />
                    <div className="tl-item__body">
                      <p className="tl-item__title">
                        <Link href={`/assets/${version.asset_version_id}`}>{version.name}</Link>
                        <span className="pill">
                          <IconCheck style={{ width: 11, height: 11 }} />
                          Added
                        </span>
                      </p>
                      <p className="tl-item__meta">By {version.owner}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      <section className="section">
        <div
          className="card card--pad"
          style={{ display: "flex", gap: "var(--sp-5)", alignItems: "center", flexWrap: "wrap" }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 40,
              height: 40,
              borderRadius: "var(--r-md)",
              background: "var(--brand-soft)",
              color: "var(--brand)",
              flex: "none",
            }}
          >
            <IconShield style={{ width: 20, height: 20 }} />
          </span>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <h2>Built something worth sharing?</h2>
            <p className="t-small" style={{ marginTop: 2 }}>
              We will check whether something similar already exists, then walk you through
              what reviewers need to know.
            </p>
          </div>
          <Link className="btn" href="/contribute">
            Share an asset <IconArrowRight className="btn__icon" />
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
