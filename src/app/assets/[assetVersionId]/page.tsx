import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReuseIntelligencePanel } from "@/components/marketplace/reuse-intelligence";
import { AssetAssistant } from "@/components/investigation/asset-assistant";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { GateStrip } from "@/components/ui/gate-strip";
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconGovernance,
  IconRun,
} from "@/components/ui/icons";
import { TrustBreakdown, TrustRing } from "@/components/ui/trust-ring";
import { TRUST_EXPLAINER, readinessFor, relativeTime } from "@/components/ui/language";
import { AssetVersionIdSchema } from "@/contracts";
import { withCatalogService } from "@/modules/catalog";
import { withGovernanceService } from "@/modules/governance";
import { computeTrustScore } from "@/modules/investigation";
import { loadReuseIntelligence } from "@/modules/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetVersionId: string }>;
}) {
  const { assetVersionId } = await params;
  const parsed = AssetVersionIdSchema.safeParse(assetVersionId);
  if (!parsed.success) notFound();

  const record = await withCatalogService((service) =>
    service.getAdminVersionById(parsed.data),
  );
  if (
    !record ||
    record.asset_version.lifecycle !== "published" ||
    record.asset_version.deprecated_at !== null
  ) {
    notFound();
  }

  const detail = await withGovernanceService((service) => service.getDetail(parsed.data));
  const trust = computeTrustScore(detail.projection);
  const reuse = loadReuseIntelligence(parsed.data);
  const readiness = readinessFor(trust.band);
  const lastChecked =
    detail.evidence.map((row) => row.timestamp).sort().at(-1) ?? null;
  const nextStep =
    readiness.key === "ready"
      ? "You can use this now. Read the limitations before you rely on it."
      : readiness.key === "ready_with_review"
        ? "Usable, but read the limitations and check anything it does not cover."
        : "Check what is missing before you rely on this.";

  const { asset, asset_version: version } = record;
  const runnable =
    asset.current_published_version_id === version.asset_version_id &&
    version.availability === "runnable" &&
    version.executor_key !== undefined &&
    version.definition_digest !== undefined;

  return (
    <AppShell
      area="marketplace"
      crumbs={[{ label: "Marketplace", href: "/marketplace" }, { label: version.name }]}
      actions={
        runnable ? (
          <Link className="btn btn--sm" href={`/assets/${version.asset_version_id}/try`}>
            <IconRun className="btn__icon" />
            Try it
          </Link>
        ) : null
      }
    >
      <SetAiContext
        surface="asset"
        label={version.name}
        assetVersionId={version.asset_version_id}
        assetName={version.name}
      />
      <header className="page-head">
        <p className="t-label">{version.asset_type}</p>
        <h1 style={{ marginTop: "var(--sp-2)" }}>{version.name}</h1>
        <p className="t-lead" style={{ marginTop: "var(--sp-3)" }}>
          {version.summary}
        </p>

        <div className="fact-row">
          <span>
            Made for <strong>{version.audiences.join(", ")}</strong>
          </span>
          <span>
            Looked after by <strong>{version.owner}</strong>
          </span>
          <span>
            Last <strong>{relativeTime(lastChecked, Date.now()).replace("checked ", "")}</strong>
          </span>
        </div>

        <div className={`readiness readiness--${readiness.key}`} style={{ marginTop: "var(--sp-5)" }}>
          <TrustRing trust={trust} size="lg" showMeta={false} />
          <div className="readiness__body">
            <p className="readiness__label">{readiness.label}</p>
            <p className="readiness__meaning">{readiness.meaning}</p>
            <p className="readiness__next">
              <IconArrowRight style={{ width: 14, height: 14, flex: "none" }} />
              {nextStep}
            </p>
          </div>
          <div className="readiness__actions">
            {runnable ? (
              <Link className="btn" href={`/assets/${version.asset_version_id}/try`}>
                <IconRun className="btn__icon" />
                Try it
              </Link>
            ) : null}
            <InvestigateButton
              assetVersionId={version.asset_version_id}
              assetName={version.name}
              variant={runnable ? "secondary" : "primary"}
              size="md"
              label={readiness.key === "ready" ? "Check readiness" : "Why it needs attention"}
            />
          </div>
        </div>

        <div className="tag-row" style={{ marginTop: "var(--sp-4)" }}>
          {version.domains.map((domain) => (
            <span className="tag" key={domain}>
              {domain}
            </span>
          ))}
        </div>
      </header>

      <div className="detail">
        <div>
          <section className="detail__block">
            <h2>What it helps you do</h2>
            <p className="t-body" style={{ marginTop: "var(--sp-3)" }}>
              {version.description}
            </p>
            <div className="two-col" style={{ marginTop: "var(--sp-5)" }}>
              <DetailList title="Capabilities" items={version.capabilities} />
              <DetailList title="Common uses" items={version.use_cases} />
            </div>
          </section>

          <section className="detail__block">
            <h2>What you put in, what you get back</h2>
            <p className="t-small" style={{ marginTop: "var(--sp-2)" }}>
              Useful if you plan to adapt this for your own process.
            </p>
            <div className="two-col" style={{ marginTop: "var(--sp-4)" }}>
              <SchemaCard title="Expected inputs" schema={version.input_schema} />
              <SchemaCard title="Expected outputs" schema={version.output_schema} />
            </div>
          </section>

          <section className="detail__block">
            <h2>What it will not do</h2>
            <div className="notice notice--warning" style={{ marginTop: "var(--sp-3)" }}>
              <IconAlert className="notice__icon" />
              <div>
                <strong>A person still needs to check the result</strong>
                <p style={{ marginTop: 2 }}>{version.limitations[0]}</p>
              </div>
            </div>
            <ul className="checklist checklist--warning" style={{ marginTop: "var(--sp-4)" }}>
              {version.limitations.map((limitation) => (
                <li key={limitation}>
                  <IconAlert />
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
            <div className="two-col" style={{ marginTop: "var(--sp-5)" }}>
              <div className="card card--pad">
                <h3>Setup</h3>
                <p className="t-small" style={{ marginTop: "var(--sp-2)" }}>
                  {version.setup_expectations}
                </p>
              </div>
              <div className="card card--pad">
                <h3>Maintenance</h3>
                <p className="t-small" style={{ marginTop: "var(--sp-2)" }}>
                  {version.maintenance_expectations}
                </p>
              </div>
            </div>
          </section>

          {reuse && reuse.total > 0 ? (
            <section className="detail__block">
              <div className="section__head">
                <h2>How people use this</h2>
                <p>Counted from saved runs of this exact version.</p>
              </div>
              <ReuseIntelligencePanel reuse={reuse} />
            </section>
          ) : null}

          <section className="detail__block">
            <div className="section__head">
              <h2>Checks and permissions</h2>
              <Link className="section__link" href={`/governance/${version.asset_version_id}`}>
                View the full record
              </Link>
            </div>
            <div className="panel panel__body">
              <GateStrip gates={detail.projection.gates} />
            </div>
            <dl className="definition" style={{ marginTop: "var(--sp-5)" }}>
              <Meta label="Owner" value={version.owner} />
              <Meta label="Source class" value={version.source_class.replaceAll("_", " ")} />
              <Meta label="Source reference" value={version.source_reference ?? "Not supplied"} />
              <Meta
                label="License / attribution"
                value={version.license_id ?? version.attribution ?? "Not applicable"}
              />
              <Meta
                label="Permissions"
                value={`Access: ${version.access_permission}; tool use: ${version.tool_use_permission}; final package: ${version.final_package_permission}`}
              />

            </dl>

            <details className="tech" style={{ marginTop: "var(--sp-4)" }}>
              <summary>View technical details</summary>
              <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
                <dl className="definition">
                  <Meta
                    label="Content fingerprint"
                    value={
                      <span className="t-mono">
                        {version.subject_digest ?? "not locked"}
                      </span>
                    }
                  />
                  <Meta label="Version ID" value={<span className="t-mono">{version.asset_version_id}</span>} />
                  {version.executor_key ? (
                    <Meta label="Executor" value={<span className="t-mono">{version.executor_key}</span>} />
                  ) : null}
                </dl>
                <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
                  The fingerprint identifies this exact content. Checks are tied to it, so a
                  check done on different content does not apply here.
                </p>
              </div>
            </details>
          </section>
        </div>

        <aside className="detail__aside">
          <div className="card card--pad">
            <p className="t-label">Readiness</p>
            <p className="t-caption" style={{ marginTop: "var(--sp-2)" }}>
              {TRUST_EXPLAINER}
            </p>
            <div style={{ marginTop: "var(--sp-4)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
              <TrustBreakdown trust={trust} />
            </div>
            <Link
              className="btn btn--secondary btn--block"
              href={`/governance/${version.asset_version_id}`}
              style={{ marginTop: "var(--sp-4)" }}
            >
              <IconGovernance className="btn__icon" />
              See every check
            </Link>
          </div>

          <AssetAssistant
            assetVersionId={version.asset_version_id}
            assetName={version.name}
            capability={version.capabilities[0] ?? version.name}
            runnable={runnable}
          />

          <div className="card card--pad">
            <p className="t-label">Details</p>
            <dl className="definition" style={{ marginTop: "var(--sp-3)" }}>
              <Meta label="Version" value={version.version} />
              <Meta label="Status" value={version.lifecycle === "published" ? "Published" : version.lifecycle} />
              <Meta
                label="How you use it"
                value={runnable ? "Run it here" : "Copy and adapt it"}
              />
            </dl>
            <Link
              className="btn btn--sm btn--tertiary"
              href={`/discovery?q=${encodeURIComponent(version.capabilities[0] ?? version.name)}`}
              style={{ marginTop: "var(--sp-3)" }}
            >
              Find similar assets <IconArrowRight className="btn__icon" />
            </Link>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="checklist" style={{ marginTop: "var(--sp-3)" }}>
        {items.map((item) => (
          <li key={item}>
            <IconCheck />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SchemaCard({ title, schema }: { title: string; schema: Record<string, unknown> }) {
  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? Object.entries(schema.properties as Record<string, unknown>)
      : [];

  return (
    <div className="panel">
      <div className="panel__head">
        <h3>{title}</h3>
      </div>
      <div className="panel__body">
        {properties.length > 0 ? (
          <dl className="definition">
            {properties.map(([name, definition]) => (
              <div key={name}>
                <dt>
                  <code>{name}</code>
                </dt>
                <dd className="t-caption">{schemaType(definition)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="t-small">Structured object defined by the version schema.</p>
        )}
        <details className="tech">
          <summary>View technical details</summary>
          <pre>{JSON.stringify(schema, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

function schemaType(value: unknown): string {
  if (typeof value !== "object" || value === null || !("type" in value)) return "field";
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : "field";
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
