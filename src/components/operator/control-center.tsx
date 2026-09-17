"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconLayers,
  IconSparkle,
  IconX,
} from "@/components/ui/icons";
import type { OperatorContext, OperatorSystemState, ToolProfile } from "@/contracts";

import { useOperatorSession } from "./session";
import { OperatorTurn } from "./turn";

const EXPLORE: { label: string; utterance: string; hint: string }[] = [
  {
    label: "Assets",
    utterance: "Find published assets for property operations",
    hint: "Runs the catalogue ranker over published versions.",
  },
  {
    label: "Trust",
    utterance: "Give me the marketplace overview",
    hint: "Readiness distribution and where checks get stuck.",
  },
  {
    label: "Governance",
    utterance: "What is in the review queue?",
    hint: "Every version that is not published yet.",
  },
  {
    label: "Drift",
    utterance: "Which assets have changed trust recently?",
    hint: "Published assets whose checks no longer cover them.",
  },
  {
    label: "Agents",
    utterance: "What agents are available?",
    hint: "Every agent in this system and what it may decide.",
  },
  {
    label: "Project",
    utterance: "Explain this project",
    hint: "Knowledge generated from the implementation.",
  },
  {
    label: "Capabilities",
    utterance: "What actions can I perform?",
    hint: "The tool catalogue, read and write.",
  },
];

const STARTERS: { group: string; items: { label: string; utterance: string }[] }[] = [
  {
    group: "Find and understand",
    items: [
      {
        label: "Find me a trustworthy property operations asset",
        utterance: "Find me a trustworthy property operations asset",
      },
      {
        label: "Why is the Resident Communication Planner flagged?",
        utterance: "Why is the Resident Communication Planner flagged?",
      },
      {
        label: "Show the evidence behind the Property Operations Brief Builder",
        utterance: "Show the evidence behind the Property Operations Brief Builder",
      },
    ],
  },
  {
    group: "Investigate and decide",
    items: [
      {
        label: "Who could be affected by the Resident Communication Planner?",
        utterance: "Who could be affected by the Resident Communication Planner?",
      },
      {
        label: "Find an alternative to the Resident Communication Planner",
        utterance: "Find an alternative to the Resident Communication Planner",
      },
      {
        label: "What happens if I flag the Resident Communication Planner?",
        utterance: "What happens if I flag the Resident Communication Planner?",
      },
    ],
  },
  {
    group: "Build and govern",
    items: [
      {
        label: "I want to contribute a fraud detection agent",
        utterance: "I want to contribute a fraud detection agent",
      },
      {
        label: "What is in the review queue?",
        utterance: "What is in the review queue?",
      },
      {
        label: "How does trust work?",
        utterance: "How does trust work?",
      },
    ],
  },
];

function Counter({
  value,
  label,
  tone,
  href,
}: {
  value: number;
  label: string;
  tone?: "warn" | "ok";
  href?: string;
}) {
  const body = (
    <>
      <span className="cc-count__value t-num">{value}</span>
      <span className="cc-count__label">{label}</span>
    </>
  );
  const className = `cc-count${tone ? ` cc-count--${tone}` : ""}`;
  return href ? (
    <Link className={className} href={href}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The AI Control Center. It is a console, not a chat: a command line, the live
 * state of the system it operates, and a canvas of records — each one showing
 * how a request was read, which capability answered it, and the result as the
 * product's own components.
 */
export function ControlCenter({
  state,
  tools,
  now,
}: {
  state: OperatorSystemState;
  tools: ToolProfile[];
  now: number;
}) {
  const context = useMemo<OperatorContext>(
    () => ({
      surface: "control_center",
      label: "AI Control Center",
      asset_version_id: null,
      asset_name: null,
      compare_ids: [],
    }),
    [],
  );

  const session = useOperatorSession(context);
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canvasEnd = useRef<HTMLDivElement>(null);
  const handed = useRef(false);

  // A question handed over from elsewhere in the product runs once on arrival.
  useEffect(() => {
    if (handed.current) return;
    const asked = searchParams.get("ask");
    if (asked === null || asked.trim().length === 0) return;
    handed.current = true;
    void session.run(asked);
  }, [searchParams, session]);

  useEffect(() => {
    if (session.entries.length > 0) {
      canvasEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [session.entries]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) return;
    setDraft("");
    void session.run(value);
  }

  function ask(utterance: string) {
    setDraft("");
    inputRef.current?.focus();
    void session.run(utterance);
  }

  const writes = tools.filter((tool) => tool.kind === "write").length;
  const latestPlanTitle = session.entries
    .map((entry) => entry.response?.blocks.find((block) => block.kind === "plan"))
    .filter((block) => block !== undefined)
    .at(-1);

  return (
    <div className="cc">
      <header className="cc-head">
        <div className="cc-head__title">
          <span className="cc-head__mark" aria-hidden="true">
            <IconSparkle style={{ width: 16, height: 16 }} />
          </span>
          <div>
            <h1>AI Control Center</h1>
            <p>
              Don&rsquo;t navigate the marketplace. Tell it what you want to accomplish.
            </p>
          </div>
        </div>
        <span className="cc-live">
          <span className="cc-live__dot" aria-hidden="true" />
          System live
          <em>
            {state.published} published · {state.evidence_records} evidence ·{" "}
            {state.executions} runs
          </em>
        </span>
      </header>

      <form className="cc-cmd" onSubmit={submit}>
        <label className="t-label" htmlFor="cc-input">
          What do you want to accomplish?
        </label>
        <div className="cc-cmd__row">
          <span className="cc-cmd__prompt t-mono" aria-hidden="true">
            &rsaquo;
          </span>
          <textarea
            className="cc-cmd__input"
            id="cc-input"
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder="Create a fraud detection agent, investigate an asset, find an alternative…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            disabled={session.busy}
          />
          <button className="btn" type="submit" disabled={session.busy || draft.trim().length === 0}>
            {session.busy ? "Working…" : "Run"}
            <IconArrowRight className="btn__icon" />
          </button>
        </div>
        <p className="cc-cmd__hint">
          Reads run straight away. Anything that changes state shows you a preview and waits
          for your approval — {writes} of {tools.length} capabilities work that way.
        </p>
      </form>

      <nav className="cc-explore" aria-label="Explore">
        <span className="t-label">Explore</span>
        <div className="chips">
          {EXPLORE.map((item) => (
            <button
              className="chip"
              type="button"
              key={item.label}
              title={item.hint}
              onClick={() => ask(item.utterance)}
              disabled={session.busy}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="cc-grid">
        <div className="cc-canvas">
          {session.entries.length === 0 ? (
            <div className="cc-empty">
              <p className="t-label">Start anywhere</p>
              <div className="cc-empty__grid">
                {STARTERS.map((group) => (
                  <section key={group.group}>
                    <h2>{group.group}</h2>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.utterance}>
                          <button type="button" onClick={() => ask(item.utterance)}>
                            <IconArrowRight style={{ width: 12, height: 12 }} />
                            {item.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <p className="cc-empty__foot">
                Every answer is assembled from this marketplace&rsquo;s own records. The
                operator has no separate data of its own, and it cannot change anything
                without asking you first.
              </p>
            </div>
          ) : (
            <>
              {session.entries.map((entry, index) => (
                <OperatorTurn
                  entry={entry}
                  index={index}
                  context={context}
                  now={now}
                  busy={session.busy}
                  onSuggest={ask}
                  onConfirm={(action) =>
                    void session.act(action.tool, action.args, action.label)
                  }
                  onCancel={() => undefined}
                  key={entry.id}
                />
              ))}
              <div ref={canvasEnd} />
              <div className="cc-canvas__foot">
                <button
                  className="btn btn--sm btn--tertiary"
                  type="button"
                  onClick={session.reset}
                  disabled={session.busy}
                >
                  <IconX style={{ width: 12, height: 12 }} />
                  Clear console
                </button>
              </div>
            </>
          )}
        </div>

        <aside className="cc-rail">
          <section className="cc-card">
            <p className="t-label">Current context</p>
            <p className="cc-card__title">Whole marketplace</p>
            <div className="cc-counts">
              <Counter value={state.published} label="Published" href="/marketplace" />
              <Counter value={state.ready_to_use} label="Ready to use" tone="ok" href="/marketplace?view=reviewed" />
              <Counter value={state.runnable} label="Runnable" href="/marketplace?view=runnable" />
              <Counter
                value={state.needs_attention}
                label="Need attention"
                tone={state.needs_attention > 0 ? "warn" : undefined}
                href="/governance"
              />
              <Counter value={state.in_review} label="In review" href="/governance" />
              <Counter
                value={state.drift_warnings}
                label="Drifted"
                tone={state.drift_warnings > 0 ? "warn" : undefined}
                href="/drift"
              />
            </div>
          </section>

          {latestPlanTitle?.kind === "plan" ? (
            <section className="cc-card">
              <p className="t-label">Active plan</p>
              <p className="cc-card__title">{latestPlanTitle.plan.title}</p>
              <ol className="cc-plan">
                {latestPlanTitle.plan.steps.map((step) => (
                  <li key={step.key}>
                    <span className="cc-plan__dot" aria-hidden="true" />
                    {step.title}
                  </li>
                ))}
              </ol>
              <p className="t-caption">Scroll to the plan in the console to run it.</p>
            </section>
          ) : null}

          <section className="cc-card">
            <p className="t-label">System signals</p>
            <ul className="cc-signals">
              {state.signals.map((signal) => (
                <li className={`cc-signal cc-signal--${signal.tone}`} key={signal.text}>
                  {signal.tone === "warning" ? (
                    <IconAlert style={{ width: 13, height: 13 }} />
                  ) : signal.tone === "positive" ? (
                    <IconCheck style={{ width: 13, height: 13 }} />
                  ) : (
                    <IconLayers style={{ width: 13, height: 13 }} />
                  )}
                  <span>
                    {signal.text}
                    {signal.utterance ? (
                      <button
                        type="button"
                        onClick={() => ask(signal.utterance!)}
                        disabled={session.busy}
                      >
                        Ask about this
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="cc-card cc-card--quiet">
            <p className="t-label">Guarantees</p>
            <ul className="cc-guarantees">
              <li>Answers are read from persisted records, never generated.</li>
              <li>{writes} capabilities change state; each one previews first.</li>
              <li>Every write is re-read and verified before it is reported.</li>
              <li>The model routes and drafts. It never decides or approves.</li>
            </ul>
            <Link className="btn btn--sm btn--secondary" href="/agents">
              Agent Explorer <IconArrowRight style={{ width: 11, height: 11 }} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
