import type { TrustScore } from "@/contracts";
import { GateStrip } from "@/components/ui/gate-strip";
import { IconAlert, IconCheck, IconExternal, IconLayers, IconUser } from "@/components/ui/icons";
import { TrustBreakdown, TrustRing } from "@/components/ui/trust-ring";
import type { GovernanceDetail } from "@/modules/governance";

const EVIDENCE_TONE: Record<string, string> = {
  passed: "success",
  not_applicable: "success",
  informational: "info",
  stale_digest: "warning",
  stale_artifact: "warning",
  superseded: "info",
  failed: "danger",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * The governance control centre. Gates, trust, evidence, and lifecycle are the
 * primary surfaces; the raw record stays available under technical details.
 */
export function GovernancePanel({
  detail,
  trust,
}: {
  detail: GovernanceDetail;
  trust: TrustScore;
}) {
  const { record, projection } = detail;
  const version = record.asset_version;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <section className="card card--pad">
        <div style={{ display: "flex", gap: "var(--sp-5)", alignItems: "flex-start", flexWrap: "wrap" }}>
          <TrustRing trust={trust} size="lg" showMeta={false} />
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <p className={`t-label tone-${trust.band}`}>{trust.label}</p>
            <h1 style={{ marginTop: 2 }}>{version.name}</h1>
            <p className="t-small" style={{ marginTop: "var(--sp-2)" }}>
              {version.summary}
            </p>
            <div className="tag-row" style={{ marginTop: "var(--sp-3)" }}>
              <span className="pill">v{version.version}</span>
              <span className="pill">{version.lifecycle.replaceAll("_", " ")}</span>
              <span className="pill">{version.availability.replaceAll("_", " ")}</span>
              {projection.badges.map((badge) => (
                <span
                  className={`pill pill--${badge.tone === "positive" ? "success" : badge.tone === "negative" ? "danger" : badge.tone === "warning" ? "warning" : "info"}`}
                  key={badge.key}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "var(--sp-5)", paddingTop: "var(--sp-5)", borderTop: "1px solid var(--border-subtle)" }}>
          <p className="t-label" style={{ marginBottom: "var(--sp-3)" }}>
            Trust breakdown
          </p>
          <TrustBreakdown trust={trust} />
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>Publication gates</h2>
          <span
            className={`pill pill--${projection.canPublish ? "success" : "warning"}`}
            style={{ marginLeft: "auto" }}
          >
            {projection.canPublish ? <IconCheck style={{ width: 11, height: 11 }} /> : <IconAlert style={{ width: 11, height: 11 }} />}
            {projection.canPublish ? "All gates pass" : "Publication blocked"}
          </span>
        </div>
        <div className="panel__body">
          <GateStrip gates={projection.gates} />
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>Evidence</h2>
          <span className="t-caption" style={{ marginLeft: "auto" }}>
            Stored separately from lifecycle
          </span>
        </div>
        <div className="panel__body">
          {projection.evidence.length === 0 ? (
            <div className="notice notice--warning">
              <IconAlert className="notice__icon" />
              <span>No evidence has been recorded for this version.</span>
            </div>
          ) : (
            <ul className="evidence-list">
              {projection.evidence.map(({ evidence, state, label }) => (
                <li className="evidence" key={evidence.evidence_id} id={`evidence-${evidence.evidence_id}`}>
                  <div className="evidence__top">
                    <span className="evidence__type">
                      {evidence.evidence_type.replaceAll("_", " ")}
                    </span>
                    <span className={`pill pill--${EVIDENCE_TONE[state] ?? "info"}`}>
                      <span className="pill__dot" />
                      {label}
                    </span>
                    <time className="evidence__time" dateTime={evidence.timestamp}>
                      {formatTime(evidence.timestamp)}
                    </time>
                  </div>
                  <p className="evidence__summary">{evidence.details.summary}</p>
                  <p className="t-caption" style={{ marginTop: "var(--sp-2)" }}>
                    Scope: {evidence.scope}
                  </p>
                  {evidence.reviewer ? (
                    <p className="t-caption" style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <IconUser style={{ width: 12, height: 12 }} />
                      {evidence.reviewer.name}
                      {evidence.reviewer.role ? ` · ${evidence.reviewer.role}` : ""}
                    </p>
                  ) : null}

                  <ul
                    className="checklist"
                    style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px dashed var(--border)" }}
                  >
                    {evidence.details.assertions.map((assertion) => (
                      <li key={assertion.name} style={{ fontSize: "0.8125rem" }}>
                        {assertion.passed ? (
                          <IconCheck />
                        ) : (
                          <IconAlert style={{ color: "var(--danger)" }} />
                        )}
                        <span>{assertion.name}</span>
                      </li>
                    ))}
                  </ul>

                  <p
                    className={`evidence__digest${state === "stale_digest" ? " evidence__digest--mismatch" : ""}`}
                  >
                    {evidence.subject_digest}
                    {state === "stale_digest" ? " · does not match current version" : ""}
                  </p>

                  <details className="tech">
                    <summary>Technical details</summary>
                    <pre>{JSON.stringify(evidence, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <IconLayers style={{ width: 16, height: 16, color: "var(--text-muted)" }} />
          <h2>Lifecycle and evidence history</h2>
        </div>
        <div className="panel__body">
          <ul className="timeline">
            {detail.history.map((item) => (
              <li
                className={`tl-item tl-item--${item.kind === "lifecycle" ? "lifecycle" : "positive"}`}
                key={`${item.kind}-${item.id}`}
              >
                <span className="tl-item__dot" aria-hidden="true" />
                <div className="tl-item__body">
                  <p className="tl-item__title">
                    {item.title}
                    <span className="pill">{item.kind}</span>
                  </p>
                  <p className="tl-item__meta">
                    <time dateTime={item.timestamp}>{formatTime(item.timestamp)}</time> ·{" "}
                    {item.actor}
                  </p>
                  <p className="tl-item__detail">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel__foot">
          Lifecycle events and evidence are append-only. Publication changes lifecycle
          only; it never mutates frozen content.
        </div>
      </section>

      <details className="tech">
        <summary>
          <IconExternal style={{ width: 13, height: 13 }} />
          Raw version record
        </summary>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </div>
  );
}
