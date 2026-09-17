import Link from "next/link";
import type { Metadata } from "next";

import { InvestigateButton } from "@/components/investigation/investigate-button";
import { AppShell } from "@/components/shell/app-shell";
import { IconAlert, IconCheck } from "@/components/ui/icons";
import { TrustRing } from "@/components/ui/trust-ring";
import { withGovernanceService } from "@/modules/governance";
import { GOVERNANCE_PURPOSE, readinessFor } from "@/components/ui/language";
import { computeTrustScore } from "@/modules/investigation";

export const metadata: Metadata = {
  title: "Governance",
  robots: { index: false, follow: false },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GovernanceQueuePage() {
  const items = await withGovernanceService((service) => service.listQueue());
  const scored = items
    .map((item) => ({ ...item, trust: computeTrustScore(item.projection) }))
    .sort((left, right) => left.trust.score - right.trust.score);
  // Count the versions people actually receive today: current published only.
  const currentPublished = scored.filter(
    (item) =>
      item.record.asset_version.lifecycle === "published" &&
      item.record.asset_version.deprecated_at === null &&
      item.record.asset.current_published_version_id ===
        item.record.asset_version.asset_version_id,
  );
  const blocked = currentPublished.filter(
    (item) =>
      item.projection.gates.filter(
        (gate) =>
          gate.status === "missing" || gate.status === "failed" || gate.status === "stale",
      ).length > 0,
  ).length;
  const others = scored.length - currentPublished.length;

  return (
    <AppShell area="governance" crumbs={[{ label: "Governance" }]} attentionCount={blocked}>
      <header className="page-head">
        <div className="page-head__row">
          <div>
            <h1>
              {blocked === 0
                ? "Every published asset has completed its checks"
                : `${blocked} ${blocked === 1 ? "asset has" : "assets have"} checks still to complete`}
            </h1>
            <p>{GOVERNANCE_PURPOSE}</p>
          </div>
        </div>
      </header>

      <div className="notice" style={{ marginBottom: "var(--sp-5)" }}>
        <IconAlert className="notice__icon" />
        <span>
          This is a prototype. Reviewer names are typed in by hand, so they record who said
          they checked something rather than a verified approval.
        </span>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2>Every asset and its checks</h2>
          <span className="t-caption" style={{ marginLeft: "auto" }}>
            {currentPublished.length} in the catalogue
            {others > 0 ? ` · ${others} older or unpublished` : ""}
          </span>
        </div>
        <div className="attention">
          {scored.map(({ record, projection, trust }) => {
            const version = record.asset_version;
            return (
              <div className="attention__row" key={version.asset_version_id}>
                <TrustRing trust={trust} size="sm" showMeta={false} />
                <div className="attention__body">
                  <p className="attention__title">
                    <Link href={`/governance/${version.asset_version_id}`}>{version.name}</Link>
                  </p>
                  <p className="attention__detail">
                    v{version.version} ·{" "}
                    {version.lifecycle === "published"
                      ? readinessFor(trust.band).label
                      : "Not published yet"}
                  </p>
                </div>
                <span
                  className={`pill pill--${
                    version.lifecycle !== "published"
                      ? "info"
                      : projection.canPublish
                        ? "success"
                        : "warning"
                  }`}
                >
                  {projection.canPublish ? (
                    <IconCheck style={{ width: 11, height: 11 }} />
                  ) : (
                    <IconAlert style={{ width: 11, height: 11 }} />
                  )}
                  {trust.passing_gates} of {trust.required_gates} checks done
                </span>
                <div className="attention__actions">
                  <InvestigateButton
                    assetVersionId={version.asset_version_id}
                    assetName={version.name}
                    label="Check readiness"
                  />
                  <Link className="btn btn--sm btn--tertiary" href={`/governance/${version.asset_version_id}`}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
