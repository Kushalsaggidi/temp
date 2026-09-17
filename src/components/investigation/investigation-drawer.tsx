"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type {
  AlternativesResult,
  ChangeSignal,
  EvidenceReference,
  ImpactActionKey,
  ImpactGraph,
  ImpactPreview,
  InvestigationReport,
} from "@/contracts";
import {
  IconAlert,
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconExternal,
  IconLayers,
  IconMinus,
  IconSparkle,
  IconX,
} from "@/components/ui/icons";
import { TRUST_EXPLAINER, evidenceStateLabel } from "@/components/ui/language";
import { TrustBreakdown, TrustRing } from "@/components/ui/trust-ring";

import { AlternativesList } from "./alternatives";
import { ImpactGraphView } from "./impact-graph";
import { ImpactPreviewDialog } from "./impact-preview";
import type { InvestigationState } from "./investigation-provider";

const DIRECTION_ICON = { down: IconArrowDown, up: IconArrowUp, flat: IconMinus } as const;

const ACTION_KEYS = new Set<string>(["flag_for_review", "metadata_validation", "publish"]);

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function Section({
  title,
  stage,
  children,
  aside,
}: {
  title: string;
  stage: number;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className={`drawer-section stage-${stage}`}>
      <div className="drawer-section__head">
        <h3>{title}</h3>
        <span className="drawer-section__rule" />
        {aside}
      </div>
      {children}
    </section>
  );
}

function SignalRow({ signal }: { signal: ChangeSignal }) {
  const Glyph = DIRECTION_ICON[signal.direction];
  return (
    <li className={`signal signal--${signal.severity}${signal.technical ? " signal--technical" : ""}`}>
      <span className="signal__label">
        {signal.label}
        <span className="signal__note">{signal.detail}</span>
      </span>
      <span className="signal__values">
        <span className="signal__before">{signal.before}</span>
        <IconArrowRight className="signal__arrow" style={{ width: 13, height: 13 }} />
        <span className="signal__after">{signal.after}</span>
        <Glyph
          style={{
            width: 13,
            height: 13,
            color:
              signal.direction === "down"
                ? "var(--danger)"
                : signal.direction === "up"
                  ? "var(--success)"
                  : "var(--text-muted)",
          }}
        />
      </span>
    </li>
  );
}

function EvidenceCard({ item }: { item: EvidenceReference }) {
  const tone =
    item.tone === "positive"
      ? "success"
      : item.tone === "warning"
        ? "warning"
        : item.tone === "negative"
          ? "danger"
          : "info";
  return (
    <li className="evidence">
      <div className="evidence__top">
        <span className="evidence__type">{item.evidence_type}</span>
        <span className={`pill pill--${tone}`}>
          <span className="pill__dot" />
          {evidenceStateLabel(item.state)}
        </span>
        <time className="evidence__time" dateTime={item.timestamp}>
          {formatTime(item.timestamp)}
        </time>
      </div>
      <p className="evidence__summary">{item.summary}</p>
      {item.reviewer ? (
        <p className="t-caption" style={{ marginTop: "var(--sp-2)" }}>
          Checked by {item.reviewer}
        </p>
      ) : null}
      {!item.digest_matches_current ? (
        <p className="t-caption" style={{ marginTop: "var(--sp-2)", color: "var(--warning)" }}>
          This check was done on different content than the version published today.
        </p>
      ) : null}
      <details className="tech" style={{ marginTop: "var(--sp-3)" }}>
        <summary>View technical details</summary>
        <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
          <dl className="definition">
            <div>
              <dt>Record ID</dt>
              <dd className="t-mono">{item.evidence_id}</dd>
            </div>
            <div>
              <dt>Content fingerprint</dt>
              <dd className="t-mono">{item.subject_digest}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{item.scope}</dd>
            </div>
          </dl>
          <Link className="evidence__link" href={item.href}>
            Open the full record <IconExternal style={{ width: 12, height: 12 }} />
          </Link>
        </div>
      </details>
    </li>
  );
}

function Working({ assetName }: { assetName: string }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <p className="working__title">
        <IconSparkle className="spin" style={{ width: 16, height: 16 }} />
        Checking {assetName}…
      </p>
      <ul className="working__steps">
        <li>Reading the required checks</li>
        <li>Comparing against earlier versions</li>
        <li>Collecting the supporting records</li>
        <li>Preparing the summary</li>
      </ul>
    </div>
  );
}

type Tab = "summary" | "related" | "alternatives";

export function InvestigationDrawer({
  state,
  onClose,
  onAction,
}: {
  state: Exclude<InvestigationState, { phase: "idle" }>;
  onClose: () => void;
  onAction: (
    endpoint: string,
    body: Record<string, unknown>,
    label: string,
  ) => Promise<boolean>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [graph, setGraph] = useState<ImpactGraph | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativesResult | null>(null);
  const [loadingTab, setLoadingTab] = useState(false);
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [pending, setPending] = useState(false);
  const now = useRef(Date.now()).current;

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const report = state.phase === "ready" ? state.report : null;
  const assetVersionId = state.assetVersionId;

  // Related records and alternatives load only when their tab is opened.
  useEffect(() => {
    if (report === null) return;
    if (tab === "related" && graph === null) void fetchView("graph");
    if (tab === "alternatives" && alternatives === null) void fetchView("alternatives");

    async function fetchView(view: "graph" | "alternatives") {
      setLoadingTab(true);
      try {
        const response = await fetch(`/api/insights/${assetVersionId}?view=${view}`);
        if (!response.ok) return;
        const body = await response.json();
        if (view === "graph") setGraph(body as ImpactGraph);
        else setAlternatives(body as AlternativesResult);
      } catch {
        // The tab shows its own empty state; the summary stays usable.
      } finally {
        setLoadingTab(false);
      }
    }
  }, [tab, report, graph, alternatives, assetVersionId]);

  async function openPreview(actionKey: string) {
    setPending(true);
    try {
      const response = await fetch(
        `/api/insights/${assetVersionId}?view=impact&action=${actionKey as ImpactActionKey}`,
      );
      if (!response.ok) return;
      setPreview((await response.json()) as ImpactPreview);
    } catch {
      // Falls through: without a preview the action is not offered.
    } finally {
      setPending(false);
    }
  }

  const delta = report?.baseline != null ? report.trust.score - report.baseline.score : null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Readiness check: ${state.assetName}`}
        ref={panel}
        tabIndex={-1}
      >
        <header className="drawer__head">
          <div style={{ minWidth: 0 }}>
            <p className="drawer__eyebrow">Readiness check</p>
            <p className="drawer__title">{state.assetName}</p>
          </div>
          <button className="drawer__close" type="button" onClick={onClose} aria-label="Close">
            <IconX style={{ width: 15, height: 15 }} />
          </button>
        </header>

        {report ? (
          <div className="drawer__tabs" role="tablist" aria-label="Readiness views">
            {(
              [
                ["summary", "Summary"],
                ["related", "What it affects"],
                ["alternatives", "Alternatives"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                className="drawer__tab"
                type="button"
                role="tab"
                key={key}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="drawer__body">
          {state.phase === "loading" ? <Working assetName={state.assetName} /> : null}

          {state.phase === "error" ? (
            <div className="notice notice--danger">
              <IconAlert className="notice__icon" />
              <div>
                <strong>We could not check this asset</strong>
                <p style={{ marginTop: 2 }}>{state.message}</p>
              </div>
            </div>
          ) : null}

          {report && tab === "summary" ? (
            <>
              {/* 1. Overall status */}
              <div className="card card--pad drawer-section stage-1">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
                  <TrustRing trust={report.trust} size="lg" showMeta={false} />
                  <div style={{ minWidth: 0 }}>
                    <p className={`t-label tone-${report.trust.band}`}>{report.trust.label}</p>
                    <p style={{ fontSize: "0.9375rem", fontWeight: 600, marginTop: 2 }}>
                      {report.headline}
                    </p>
                    <p className="t-small" style={{ marginTop: "var(--sp-2)" }}>
                      {report.subheadline}
                    </p>
                  </div>
                </div>
                <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
                  {TRUST_EXPLAINER}
                  {delta !== null && report.baseline
                    ? ` Version ${report.baseline.asset_version} scored ${report.baseline.score}.`
                    : ""}
                </p>
                <details className="tech" style={{ marginTop: "var(--sp-3)" }}>
                  <summary>See which checks are complete</summary>
                  <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
                    <TrustBreakdown trust={report.trust} />
                  </div>
                </details>
              </div>

              {/* 2. What happened */}
              {report.signals.length > 0 ? (
                <Section title="What changed" stage={2}>
                  <ul className="signals">
                    {report.signals.map((signal) => (
                      <SignalRow signal={signal} key={signal.key} />
                    ))}
                  </ul>
                </Section>
              ) : null}

              {/* 3. Why it matters */}
              <Section title="Why it matters" stage={3}>
                <div className={`notice notice--${report.severity === "info" ? "info" : "warning"}`}>
                  <IconAlert className="notice__icon" />
                  <p>{report.impact}</p>
                </div>

                <div className="register register--observation" style={{ marginTop: "var(--sp-3)" }}>
                  <div className="register__head">
                    <span className="register__title">What we found</span>
                    <span className="t-caption">From saved records</span>
                  </div>
                  <ul>
                    {report.observations.map((observation) => (
                      <li key={observation}>{observation}</li>
                    ))}
                  </ul>
                </div>

                <div className="register register--inference">
                  <div className="register__head">
                    <span className="ai-mark">
                      <IconSparkle style={{ width: 12, height: 12 }} />
                      AI explanation
                    </span>
                    <span className="unverified">Not verified</span>
                  </div>
                  <p>{report.inference}</p>
                  <p className="t-caption" style={{ marginTop: "var(--sp-2)" }}>
                    {report.ai.state === "ready"
                      ? "This is a suggestion based on the findings above. It cannot change what the records say."
                      : report.ai.reason}
                  </p>
                </div>
              </Section>

              {/* 4. Recommended actions */}
              <Section title="Recommended actions" stage={4}>
                <p className="t-small" style={{ marginBottom: "var(--sp-3)" }}>
                  {report.recommendation}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {report.actions.map((action) => (
                    <div className="action-row" key={action.key}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontSize: "0.8125rem", fontWeight: 560 }}>{action.label}</p>
                        <p className="t-caption">{action.description}</p>
                      </div>
                      {action.endpoint && ACTION_KEYS.has(action.key) ? (
                        <button
                          className={`btn btn--sm${action.emphasis === "secondary" ? " btn--secondary" : ""}`}
                          type="button"
                          disabled={pending}
                          onClick={() => void openPreview(action.key)}
                        >
                          {pending ? "…" : "Continue"}
                        </button>
                      ) : (
                        <Link
                          className="btn btn--sm btn--secondary"
                          href={
                            action.key === "find_similar"
                              ? `/discovery?q=${encodeURIComponent(report.asset_name)}`
                              : `/governance/${report.asset_version_id}`
                          }
                          onClick={
                            action.key === "find_similar"
                              ? (event) => {
                                  event.preventDefault();
                                  setTab("alternatives");
                                }
                              : onClose
                          }
                        >
                          {action.key === "find_similar" ? "Show" : "Open"}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
                <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
                  You will see exactly what an action changes before it happens. Nothing runs
                  on its own.
                </p>
              </Section>

              {/* 5. Supporting evidence */}
              <Section
                title="Supporting evidence"
                stage={5}
                aside={
                  <Link
                    className="t-caption"
                    href={`/governance/${report.asset_version_id}`}
                    style={{ color: "var(--brand)", fontWeight: 560 }}
                  >
                    View all
                  </Link>
                }
              >
                {report.evidence.length === 0 ? (
                  <div className="notice notice--warning">
                    <IconAlert className="notice__icon" />
                    <span>No checks have been recorded for this version yet.</span>
                  </div>
                ) : (
                  <ul className="evidence-list">
                    {report.evidence.map((item) => (
                      <EvidenceCard item={item} key={item.evidence_id} />
                    ))}
                  </ul>
                )}
              </Section>
            </>
          ) : null}

          {report && tab === "related" ? (
            <Section title="What this affects" stage={1}>
              {loadingTab || graph === null ? (
                <div className="skeleton-stack">
                  <div className="skeleton skeleton--title" />
                  <div className="skeleton skeleton--card" />
                </div>
              ) : (
                <ImpactGraphView graph={graph} />
              )}
            </Section>
          ) : null}

          {report && tab === "alternatives" ? (
            <Section title="Other assets that do this job" stage={1}>
              {loadingTab || alternatives === null ? (
                <div className="skeleton-stack">
                  <div className="skeleton skeleton--title" />
                  <div className="skeleton skeleton--card" />
                </div>
              ) : (
                <AlternativesList
                  result={alternatives}
                  subjectName={state.assetName}
                  now={now}
                  onClose={onClose}
                />
              )}
            </Section>
          ) : null}
        </div>

        <footer className="drawer__foot">
          {report && tab === "summary" && report.severity !== "info" ? (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => setTab("alternatives")}
              style={{ flex: 1 }}
            >
              <IconLayers className="btn__icon" />
              Find an alternative
            </button>
          ) : null}
          <button
            className="btn btn--secondary"
            type="button"
            onClick={onClose}
            style={{ flex: 1 }}
          >
            Close
          </button>
        </footer>
      </div>

      {preview ? (
        <ImpactPreviewDialog
          preview={preview}
          busy={pending}
          onCancel={() => setPreview(null)}
          onConfirm={async () => {
            if (!preview.endpoint) return;
            setPending(true);
            const ok = await onAction(preview.endpoint, preview.body ?? {}, preview.title);
            setPending(false);
            if (ok) setPreview(null);
          }}
        />
      ) : null}
    </>
  );
}
