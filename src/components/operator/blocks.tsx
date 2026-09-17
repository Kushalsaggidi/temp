"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { BarChart, StackedBar } from "@/components/charts/bar-chart";
import { AlternativesList } from "@/components/investigation/alternatives";
import { ImpactGraphView } from "@/components/investigation/impact-graph";
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconExternal,
  IconLayers,
  IconMinus,
  IconRun,
  IconShield,
  IconSparkle,
  IconX,
} from "@/components/ui/icons";
import { relativeTime } from "@/components/ui/language";
import { TrustBreakdown, TrustRing } from "@/components/ui/trust-ring";
import type {
  OperatorAction,
  OperatorAssetCard,
  OperatorBlock,
  OperatorFact,
  OperatorPlan,
  OperatorSuggestion,
  OperatorTone,
} from "@/contracts";

const TONE_PILL: Record<OperatorTone, string> = {
  positive: "pill--success",
  warning: "pill--warning",
  negative: "pill--danger",
  neutral: "",
  brand: "pill--brand",
  ai: "pill--ai",
};

const STATUS_ICON = {
  pass: IconCheck,
  warn: IconAlert,
  fail: IconX,
  info: IconMinus,
} as const;

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function BlockShell({
  eyebrow,
  children,
  tone,
}: {
  eyebrow?: string;
  tone?: OperatorTone;
  children: ReactNode;
}) {
  return (
    <section className={`ab${tone ? ` ab--${tone}` : ""}`}>
      {eyebrow ? <p className="ab__eyebrow">{eyebrow}</p> : null}
      {children}
    </section>
  );
}

function Facts({ items }: { items: OperatorFact[] }) {
  return (
    <dl className="ab-facts">
      {items.map((item) => (
        <div className={`ab-fact ab-fact--${item.tone}`} key={`${item.label}-${item.value}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.hint ? <p className="ab-fact__hint">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

export function AssetCard({
  card,
  now,
  onSuggest,
}: {
  card: OperatorAssetCard;
  now: number;
  onSuggest?: (utterance: string) => void;
}) {
  return (
    <article className="ab-asset">
      <div className="ab-asset__top">
        {card.trust ? <TrustRing trust={card.trust} size="md" showMeta={false} /> : null}
        <div className="ab-asset__id">
          <Link className="ab-asset__name" href={card.href}>
            {card.name}
          </Link>
          <p className="ab-asset__meta">
            {card.owner} · v{card.version} · {card.asset_type}
          </p>
        </div>
        <div className="ab-asset__flags">
          {card.availability === "runnable" ? (
            <span className="pill pill--brand">
              <IconRun style={{ width: 11, height: 11 }} />
              Runnable
            </span>
          ) : null}
          {card.lifecycle !== "published" ? (
            <span className="pill pill--warning">
              <span className="pill__dot" />
              {card.lifecycle.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>
      </div>

      <p className="ab-asset__summary">{card.summary}</p>

      {card.matched_fields.length > 0 ? (
        <div className="matched-fields">
          {card.matched_fields.slice(0, 5).map((field) => (
            <span className="matched-field" key={field}>
              {field.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}

      <div className="ab-asset__foot">
        <span className="ab-asset__stat">
          <IconClock style={{ width: 12, height: 12 }} />
          {relativeTime(card.last_reviewed, now)}
        </span>
        {card.executions !== null ? (
          <span className="ab-asset__stat">
            <IconRun style={{ width: 12, height: 12 }} />
            {card.executions} saved {card.executions === 1 ? "run" : "runs"}
          </span>
        ) : null}
        {card.blocking_gates.length > 0 ? (
          <span className="ab-asset__stat ab-asset__stat--warn">
            <IconAlert style={{ width: 12, height: 12 }} />
            {card.blocking_gates.length} check
            {card.blocking_gates.length === 1 ? "" : "s"} outstanding
          </span>
        ) : (
          <span className="ab-asset__stat ab-asset__stat--ok">
            <IconCheck style={{ width: 12, height: 12 }} />
            All required checks current
          </span>
        )}
        <span className="ab-asset__spacer" />
        {onSuggest ? (
          <button
            className="btn btn--sm btn--tertiary"
            type="button"
            onClick={() => onSuggest(`Investigate "${card.name}"`)}
          >
            Investigate
          </button>
        ) : null}
        <Link className="btn btn--sm btn--secondary" href={card.href}>
          Open <IconExternal style={{ width: 11, height: 11 }} />
        </Link>
      </div>

      {card.rationale.length > 0 ? (
        <ul className="rationale">
          {card.rationale.slice(0, 3).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ActionPreview({
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  action: OperatorAction;
  busy: boolean;
  onConfirm: (action: OperatorAction) => void;
  onCancel: () => void;
}) {
  const preview = action.preview;
  return (
    <section className={`ab-action${action.available ? "" : " ab-action--blocked"}`}>
      <header className="ab-action__head">
        <span className="ab-action__badge">
          <IconShield style={{ width: 12, height: 12 }} />
          Action preview
        </span>
        <h3>{action.label}</h3>
        <span className="ab-action__tool t-mono">{action.tool}</span>
      </header>

      <p className="ab-action__question">{action.summary}</p>

      {preview !== null ? (
        <div className="ab-action__grid">
          <div className="ab-action__col">
            <p className="t-label">Now</p>
            <ul className="ab-action__facts">
              {preview.current_state.map((item) => (
                <li className={`ab-state ab-state--${item.tone}`} key={`now-${item.label}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </div>
          <span className="ab-action__arrow" aria-hidden="true">
            <IconArrowRight style={{ width: 16, height: 16 }} />
          </span>
          <div className="ab-action__col">
            <p className="t-label">After</p>
            <ul className="ab-action__facts">
              {preview.resulting_state.map((item) => (
                <li className={`ab-state ab-state--${item.tone}`} key={`next-${item.label}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="ab-action__effects">
        <p className="t-label">This will</p>
        <ul>
          {action.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </div>

      {preview !== null && preview.affected.length > 0 ? (
        <ul className="ab-action__affected">
          {preview.affected.map((entity) => (
            <li className={entity.at_risk ? "is-risk" : undefined} key={entity.label}>
              <strong className="t-num">{entity.count}</strong>
              <span>
                {entity.label}
                <em>{entity.detail}</em>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {action.governance !== null ? (
        <p className="ab-action__gov">
          <span className={`pill ${action.governance.blocking.length === 0 ? "pill--success" : "pill--warning"}`}>
            <span className="pill__dot" />
            Governance {action.governance.passing} / {action.governance.required} passing
          </span>
          {action.governance.blocking.length > 0 ? (
            <span className="t-caption">{action.governance.blocking.join(" · ")}</span>
          ) : null}
        </p>
      ) : null}

      <p className="ab-action__reversible">
        <IconAlert style={{ width: 13, height: 13 }} />
        {action.reversibility_note}
      </p>

      {action.available ? (
        <div className="ab-action__foot">
          <button className="btn btn--secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => onConfirm(action)}
            disabled={busy}
          >
            {busy ? "Working…" : `Approve & ${action.confirm_label.toLowerCase()}`}
          </button>
        </div>
      ) : (
        <div className="notice notice--warning" style={{ marginTop: "var(--sp-4)" }}>
          <IconAlert className="notice__icon" />
          <span>{action.unavailable_reason}</span>
        </div>
      )}
    </section>
  );
}

function PlanView({
  plan,
  onRun,
  running,
}: {
  plan: OperatorPlan;
  onRun?: (plan: OperatorPlan) => void;
  running: boolean;
}) {
  const done = plan.steps.filter((step) => step.status === "complete").length;
  const failed = plan.steps.some((step) => step.status === "failed" || step.status === "blocked");
  const finished = done === plan.steps.length;

  return (
    <section className="ab-plan">
      <header className="ab-plan__head">
        <span className="ab-plan__badge">Plan</span>
        <div style={{ minWidth: 0 }}>
          <h3>{plan.title}</h3>
          <p className="t-caption">{plan.goal}</p>
        </div>
        <span className="ab-plan__count t-num">
          {done}/{plan.steps.length}
        </span>
      </header>

      <ol className="ab-steps">
        {plan.steps.map((step) => (
          <li className={`ab-step ab-step--${step.status}`} key={step.key}>
            <span className="ab-step__index t-num">
              {String(step.index).padStart(2, "0")}
            </span>
            <span className="ab-step__mark" aria-hidden="true">
              {step.status === "complete" ? (
                <IconCheck style={{ width: 13, height: 13 }} />
              ) : step.status === "failed" || step.status === "blocked" ? (
                <IconX style={{ width: 13, height: 13 }} />
              ) : step.status === "running" ? (
                <span className="ab-step__spin" />
              ) : (
                <span className="ab-step__dot" />
              )}
            </span>
            <div className="ab-step__body">
              <p className="ab-step__title">
                {step.title}
                <span className={`pill ${step.kind === "write" ? "pill--warning" : ""}`}>
                  {step.kind}
                </span>
                {step.confirm_required ? (
                  <span className="pill pill--info">asks again</span>
                ) : null}
              </p>
              <p className="ab-step__detail">{step.outcome ?? step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {plan.note ? <p className="ab-plan__note">{plan.note}</p> : null}

      {onRun && !finished ? (
        <div className="ab-plan__foot">
          <p className="t-caption">
            Nothing has run yet. Every step is shown above before it happens.
          </p>
          <button className="btn" type="button" onClick={() => onRun(plan)} disabled={running}>
            {running ? "Running plan…" : failed ? "Retry plan" : "Execute plan"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function OperatorBlocks({
  blocks,
  now,
  busy = false,
  onSuggest,
  onConfirm,
  onCancel,
  onRunPlan,
}: {
  blocks: OperatorBlock[];
  now: number;
  busy?: boolean;
  onSuggest?: (utterance: string) => void;
  onConfirm?: (action: OperatorAction) => void;
  onCancel?: () => void;
  onRunPlan?: (plan: OperatorPlan) => void;
}) {
  return (
    <div className="ab-stack">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "headline":
            return (
              <header className={`ab-headline ab-headline--${block.tone}`} key={key}>
                {block.eyebrow ? <p className="ab__eyebrow">{block.eyebrow}</p> : null}
                <h2>{block.title}</h2>
                {block.detail ? <p>{block.detail}</p> : null}
              </header>
            );

          case "note":
            return (
              <p className={`ab-note ab-note--${block.tone}`} key={key}>
                {block.text}
              </p>
            );

          case "facts":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <Facts items={block.items} />
              </BlockShell>
            );

          case "assets":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                {block.caption ? <p className="ab__caption">{block.caption}</p> : null}
                <div className="ab-assets">
                  {block.items.map((card) => (
                    <AssetCard
                      card={card}
                      now={now}
                      onSuggest={onSuggest}
                      key={card.asset_version_id}
                    />
                  ))}
                </div>
              </BlockShell>
            );

          case "trust":
            return (
              <BlockShell eyebrow="Readiness" key={key}>
                <div className="ab-trust">
                  <TrustRing trust={block.trust} size="lg" />
                  <div className="ab-trust__body">
                    <TrustBreakdown trust={block.trust} />
                  </div>
                </div>
              </BlockShell>
            );

          case "signals":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <ul className="ab-signals">
                  {block.items.map((item, itemIndex) => {
                    const Glyph = STATUS_ICON[item.status];
                    return (
                      <li
                        className={`ab-signal ab-signal--${item.status}`}
                        key={`${item.label}-${itemIndex}`}
                      >
                        <Glyph className="ab-signal__icon" />
                        <div>
                          <p className="ab-signal__label">{item.label}</p>
                          <p className="ab-signal__detail">{item.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </BlockShell>
            );

          case "why":
            return (
              <BlockShell eyebrow="Why" key={key}>
                <p className="ab-why__question">{block.question}</p>
                <ol className="ab-chain">
                  {block.chain.map((link, linkIndex) => (
                    <li
                      className={`ab-chain__link ab-chain__link--${link.tone}`}
                      key={`${link.label}-${linkIndex}`}
                      style={{ animationDelay: `${linkIndex * 70}ms` }}
                    >
                      <span className="ab-chain__mark" aria-hidden="true" />
                      <div>
                        <p className="ab-chain__label">{link.label}</p>
                        <p className="ab-chain__detail">{link.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="ab-why__conclusion">{block.conclusion}</p>
              </BlockShell>
            );

          case "evidence":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <ul className="evidence-list">
                  {block.items.map((item) => (
                    <li className="evidence" key={item.evidence_id}>
                      <div className="evidence__top">
                        <span className="evidence__type">{item.evidence_type}</span>
                        <span
                          className={`pill ${
                            item.tone === "positive"
                              ? "pill--success"
                              : item.tone === "negative"
                                ? "pill--danger"
                                : item.tone === "warning"
                                  ? "pill--warning"
                                  : ""
                          }`}
                        >
                          <span className="pill__dot" />
                          {item.state_label}
                        </span>
                        <time className="evidence__time" dateTime={item.timestamp}>
                          {formatTime(item.timestamp)}
                        </time>
                      </div>
                      <p className="evidence__summary">{item.summary}</p>
                      <p
                        className={`evidence__digest${item.digest_matches_current ? "" : " evidence__digest--mismatch"}`}
                      >
                        {item.digest_matches_current
                          ? "Collected against the content published today"
                          : "Collected against different content"}
                        {item.reviewer ? ` · ${item.reviewer}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                {block.links.length > 0 ? (
                  <div className="ab__links">
                    {block.links.map((link) => (
                      <Link className="btn btn--sm btn--secondary" href={link.href} key={link.href}>
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </BlockShell>
            );

          case "timeline":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <ul className="timeline">
                  {block.items.map((item, itemIndex) => (
                    <li
                      className={`tl-item tl-item--${item.tone === "positive" ? "positive" : item.tone === "negative" ? "negative" : item.tone === "warning" ? "warning" : "lifecycle"}`}
                      key={`${item.timestamp}-${itemIndex}`}
                    >
                      <span className="tl-item__dot" aria-hidden="true" />
                      <div className="tl-item__body">
                        <p className="tl-item__title">{item.title}</p>
                        <p className="tl-item__detail">{item.detail}</p>
                        <p className="tl-item__meta">
                          {formatTime(item.timestamp)}
                          {item.actor ? ` · ${item.actor}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </BlockShell>
            );

          case "comparison":
            return (
              <BlockShell eyebrow="Side by side" key={key}>
                <div className="compare-scroll">
                  <table className="compare-table">
                    <thead>
                      <tr>
                        <th scope="col">Attribute</th>
                        {block.comparison.subjects.map((subject) => (
                          <th scope="col" key={subject.asset_version_id}>
                            <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                              <TrustRing trust={subject.trust} size="sm" showMeta={false} />
                              <span style={{ minWidth: 0 }}>
                                <Link href={`/assets/${subject.asset_version_id}`}>
                                  {subject.name}
                                </Link>
                                <span className="t-caption" style={{ display: "block", fontWeight: 400 }}>
                                  v{subject.version}
                                </span>
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.comparison.rows.map((row) => (
                        <tr key={row.label} className={row.differs ? "is-different" : undefined}>
                          <th scope="row">{row.label}</th>
                          {row.values.map((value, valueIndex) => (
                            <td key={`${row.label}-${valueIndex}`}>
                              <span className={`pill ${TONE_PILL[value.tone]}`}>
                                <span className="pill__dot" />
                                {value.display}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BlockShell>
            );

          case "graph":
            return (
              <BlockShell eyebrow="Connected records" key={key}>
                <ImpactGraphView graph={block.graph} />
              </BlockShell>
            );

          case "alternatives":
            return (
              <BlockShell eyebrow="Alternatives" key={key}>
                <AlternativesList
                  result={block.result}
                  subjectName={block.subject_name}
                  now={now}
                />
              </BlockShell>
            );

          case "reuse":
            return (
              <BlockShell eyebrow="Reuse" key={key}>
                <Facts
                  items={[
                    { label: "Total runs", value: String(block.reuse.total), tone: "brand", hint: null },
                    { label: "Succeeded", value: String(block.reuse.succeeded), tone: "positive", hint: null },
                    { label: "Turned away", value: String(block.reuse.rejected), tone: block.reuse.rejected > 0 ? "warning" : "neutral", hint: null },
                    { label: "By people", value: String(block.reuse.user_runs), tone: "neutral", hint: null },
                    { label: "Pre-publication tests", value: String(block.reuse.prepublication_runs), tone: "neutral", hint: null },
                    {
                      label: "Reuse proved",
                      value: block.reuse.reuse_proved ? "Yes" : "Not yet",
                      tone: block.reuse.reuse_proved ? "positive" : "neutral",
                      hint: null,
                    },
                  ]}
                />
              </BlockShell>
            );

          case "drift":
            return (
              <BlockShell eyebrow="What slipped" key={key}>
                <ul className="ab-drift">
                  {block.drift.entries.map((entry) => (
                    <li className={`ab-drift__row ab-drift__row--${entry.severity}`} key={entry.asset_version_id}>
                      <span className="ab-drift__delta t-num">−{Math.abs(entry.delta)}</span>
                      <div className="ab-drift__body">
                        <p className="ab-drift__name">
                          <Link href={`/assets/${entry.asset_version_id}`}>{entry.name}</Link>
                        </p>
                        <p className="ab-drift__reason">{entry.reason}</p>
                      </div>
                      <span className="pill pill--warning">
                        <span className="pill__dot" />
                        {entry.from_score} → {entry.to_score}
                      </span>
                      {onSuggest ? (
                        <button
                          className="btn btn--sm btn--tertiary"
                          type="button"
                          onClick={() => onSuggest(`Investigate "${entry.name}"`)}
                        >
                          Investigate
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </BlockShell>
            );

          case "chart":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <p className="ab__caption">{block.question}</p>
                {block.variant === "stacked" ? (
                  <StackedBar
                    data={block.data.map((item) => ({
                      label: item.label,
                      value: item.value,
                      tone: item.tone === "ai" ? "brand" : item.tone,
                    }))}
                    caption={block.caption}
                  />
                ) : (
                  <BarChart
                    data={block.data.map((item) => ({
                      label: item.label,
                      value: item.value,
                      tone: item.tone === "ai" ? "brand" : item.tone,
                      ...(item.note ? { note: item.note } : {}),
                    }))}
                    caption={block.caption}
                    tableLabel={block.table_label}
                    valueLabel={block.value_label}
                  />
                )}
              </BlockShell>
            );

          case "action_preview":
            return (
              <ActionPreview
                action={block.action}
                busy={busy}
                onConfirm={onConfirm ?? (() => undefined)}
                onCancel={onCancel ?? (() => undefined)}
                key={key}
              />
            );

          case "plan":
            return (
              <PlanView plan={block.plan} onRun={onRunPlan} running={busy} key={key} />
            );

          case "completion":
            return (
              <section className="ab-done" key={key}>
                <header className="ab-done__head">
                  <span className="ab-done__mark" aria-hidden="true">
                    <IconCheck style={{ width: 16, height: 16 }} />
                  </span>
                  <div>
                    <h3>{block.title}</h3>
                    <p>{block.detail}</p>
                  </div>
                </header>
                <Facts items={block.facts} />
                <p className="ab-done__verified">
                  {block.verified
                    ? "Verified: the resulting state was read back from the database after the change."
                    : "Not verified: the resulting state could not be read back."}
                </p>
                {block.links.length > 0 ? (
                  <div className="ab__links">
                    {block.links.map((link) => (
                      <Link className="btn btn--sm btn--secondary" href={link.href} key={link.href}>
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </section>
            );

          case "blocked":
            return (
              <section className="ab-blocked" key={key}>
                <header className="ab-blocked__head">
                  <IconAlert style={{ width: 16, height: 16 }} />
                  <h3>{block.title}</h3>
                </header>
                <p className="ab-blocked__reason">{block.reason}</p>
                {block.detail.length > 0 ? (
                  <ul className="ab-blocked__detail">
                    {block.detail.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="ab__links">
                  {block.links.map((link) => (
                    <Link className="btn btn--sm btn--secondary" href={link.href} key={link.href}>
                      {link.label}
                    </Link>
                  ))}
                  {onSuggest
                    ? block.suggestions.map((item) => (
                        <button
                          className="btn btn--sm btn--tertiary"
                          type="button"
                          key={item.utterance}
                          onClick={() => onSuggest(item.utterance)}
                        >
                          {item.label}
                        </button>
                      ))
                    : null}
                </div>
              </section>
            );

          case "knowledge":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <p className="ab__caption">{block.summary}</p>
                <div className="ab-knowledge">
                  {block.sections.map((section) => (
                    <article className="ab-know" key={section.heading}>
                      <h3>{section.heading}</h3>
                      <p className="ab-know__body">{section.body}</p>
                      {section.bullets.length > 0 ? (
                        <ul className="ab-know__list">
                          {section.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      ) : null}
                      {section.facts.length > 0 ? <Facts items={section.facts} /> : null}
                      {section.links.length > 0 ? (
                        <div className="ab__links">
                          {section.links.map((link) => (
                            <Link
                              className="btn btn--sm btn--tertiary"
                              href={link.href}
                              key={link.href}
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </BlockShell>
            );

          case "agents":
            return (
              <div className="ab-agents" key={key}>
                {block.items.map((agent) => (
                  <article className="ab-agent" key={agent.key}>
                    <header className="ab-agent__head">
                      <span className="ab-agent__mark">
                        <IconSparkle style={{ width: 13, height: 13 }} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <h3>{agent.name}</h3>
                        <p className="ab-agent__purpose">{agent.purpose}</p>
                      </div>
                      <span
                        className={`pill ${agent.model_or_config ? "pill--ai" : "pill--success"}`}
                      >
                        <span className="pill__dot" />
                        {agent.model_or_config ?? "Deterministic"}
                      </span>
                    </header>

                    <div className="ab-agent__grid">
                      <div>
                        <p className="t-label">Capabilities</p>
                        <ul className="ab-agent__list">
                          {agent.capabilities.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="t-label">Inputs</p>
                        <ul className="ab-agent__list">
                          {agent.inputs.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="t-label">Outputs</p>
                        <ul className="ab-agent__list">
                          {agent.outputs.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="t-label">Authority limit</p>
                        <ul className="ab-agent__list ab-agent__list--limit">
                          {agent.authority.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <p className="ab-agent__impl">
                      <IconLayers style={{ width: 12, height: 12 }} />
                      <span className="t-mono">{agent.implementation}</span>
                    </p>
                    <p className="ab-agent__fallback">{agent.deterministic_fallback}</p>

                    {onSuggest && agent.actions.length > 0 ? (
                      <div className="chips">
                        {agent.actions.map((action) => (
                          <button
                            className="chip"
                            type="button"
                            key={action.utterance}
                            title={action.hint ?? undefined}
                            onClick={() => onSuggest(action.utterance)}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            );

          case "capabilities":
            return (
              <BlockShell eyebrow={block.title} key={key}>
                <div className="ab-caps">
                  {block.groups.map((group) => (
                    <section className="ab-cap-group" key={group.group}>
                      <h3>{group.label}</h3>
                      <ul>
                        {group.tools.map((tool) => (
                          <li
                            className={`ab-cap${tool.available ? "" : " ab-cap--off"}`}
                            key={tool.name}
                          >
                            <span className="ab-cap__name t-mono">{tool.name}</span>
                            <span
                              className={`pill ${tool.kind === "write" ? "pill--warning" : "pill--success"}`}
                            >
                              {tool.kind === "write" ? "needs approval" : "runs directly"}
                            </span>
                            <p className="ab-cap__summary">
                              {tool.available ? tool.summary : tool.unavailable_reason}
                            </p>
                            <p className="ab-cap__backed t-mono">{tool.backed_by}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </BlockShell>
            );

          case "sources":
            return (
              <section className="ab-sources" key={key}>
                <p className="t-label">{block.title}</p>
                <ul>
                  {block.signals.map((signal) => (
                    <li className={signal.used ? "is-used" : undefined} key={signal.label}>
                      {signal.used ? (
                        <IconCheck style={{ width: 12, height: 12 }} />
                      ) : (
                        <IconMinus style={{ width: 12, height: 12 }} />
                      )}
                      {signal.label}
                    </li>
                  ))}
                </ul>
                {block.links.length > 0 ? (
                  <div className="ab__links">
                    {block.links.map((link) => (
                      <Link className="btn btn--sm btn--tertiary" href={link.href} key={link.href}>
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </section>
            );

          case "inference":
            return (
              <section className="ab-inference" key={key}>
                <header>
                  <span className="ai-mark">
                    <IconSparkle style={{ width: 12, height: 12 }} />
                    {block.ai.state === "ready" ? "AI interpretation" : "Deterministic interpretation"}
                  </span>
                  <span className="pill">
                    {block.ai.state === "ready" ? "not verified" : "no model used"}
                  </span>
                </header>
                <p className="ab-inference__text">{block.text}</p>
                {block.recommendation ? (
                  <p className="ab-inference__rec">
                    <strong>Suggested next step.</strong> {block.recommendation}
                  </p>
                ) : null}
                <p className="t-caption">
                  {block.ai.state === "ready"
                    ? `Written by ${block.ai.model_or_config} from the observations above. It cannot add a governance fact.`
                    : (block.ai.reason ?? "The deterministic interpretation is shown.")}
                </p>
              </section>
            );

          case "contribution":
            return (
              <section className="ab-contrib" key={key}>
                <header className="ab-contrib__head">
                  <span className="ai-mark">
                    <IconSparkle style={{ width: 12, height: 12 }} />
                    {block.ai_assisted ? "Model-drafted metadata" : "Draft from your wording"}
                  </span>
                  <span className="ab-contrib__score t-num">
                    {block.passing}/{block.total}
                  </span>
                </header>

                <dl className="ab-contrib__fields">
                  <div>
                    <dt>Name</dt>
                    <dd>{block.draft.name}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{block.draft.summary}</dd>
                  </div>
                  <div>
                    <dt>Capabilities</dt>
                    <dd>{block.draft.capabilities.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Use cases</dt>
                    <dd>{block.draft.use_cases.join("; ")}</dd>
                  </div>
                  <div>
                    <dt>Audiences</dt>
                    <dd>{block.draft.audiences.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Limitations</dt>
                    <dd>{block.draft.limitations.join("; ")}</dd>
                  </div>
                </dl>

                <ul className="ab-contrib__checks">
                  {block.checks.map((check) => {
                    const Glyph = STATUS_ICON[check.status];
                    return (
                      <li className={`ab-signal ab-signal--${check.status}`} key={check.label}>
                        <Glyph className="ab-signal__icon" />
                        <div>
                          <p className="ab-signal__label">{check.label}</p>
                          <p className="ab-signal__detail">{check.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
        }
      })}
    </div>
  );
}

export function SuggestionRow({
  suggestions,
  onSuggest,
}: {
  suggestions: OperatorSuggestion[];
  onSuggest: (utterance: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="ab-next">
      <span className="t-label">Next</span>
      <div className="chips">
        {suggestions.map((item) => (
          <button
            className="chip"
            type="button"
            key={item.utterance}
            title={item.hint ?? undefined}
            onClick={() => onSuggest(item.utterance)}
          >
            {item.label}
            <IconArrowRight style={{ width: 11, height: 11 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
