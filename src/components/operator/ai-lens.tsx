"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { IconArrowRight, IconSparkle, IconX } from "@/components/ui/icons";

import { suggestionsForSurface, useAiContext } from "./context";
import { useOperatorSession } from "./session";
import { OperatorTurn } from "./turn";

const SURFACE_LABEL: Record<string, string> = {
  control_center: "AI Control Center",
  overview: "Overview",
  marketplace: "Marketplace",
  discovery: "Discovery",
  asset: "Asset",
  investigation: "Investigation",
  compare: "Comparison",
  governance: "Governance",
  drift: "Recent changes",
  contribute: "Contribution",
  agents: "Agent Explorer",
  execution: "Run",
};

/**
 * The AI Lens: the operator, available on whatever the person is already
 * looking at. It carries the page's context, so "why is this flagged" never
 * has to ask which asset was meant, and it renders the same visual answers the
 * Control Center does.
 */
export function AiLens() {
  const { context, open, setOpen } = useAiContext();
  const session = useOperatorSession(context);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) restore.current?.focus();
  }, [open]);

  useEffect(() => {
    if (session.entries.length > 0) {
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [session.entries]);

  // Opening the Lens on a different page starts a fresh conversation.
  useEffect(() => {
    session.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.surface, context.asset_version_id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) return;
    setDraft("");
    void session.run(value);
  }

  function ask(utterance: string) {
    setDraft("");
    void session.run(utterance);
  }

  const suggestions = suggestionsForSurface(context);
  const now = Date.now();

  // The Control Center is the operator in full. A lens over it would be a
  // second copy of the same thing.
  if (context.surface === "control_center") return null;

  return (
    <>
      <button
        className={`lens-launch${open ? " is-open" : ""}`}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="ai-lens"
      >
        <IconSparkle style={{ width: 14, height: 14 }} />
        <span>AI Lens</span>
        <span className="lens-launch__ctx">{SURFACE_LABEL[context.surface] ?? "Marketplace"}</span>
      </button>

      {open ? (
        <>
          <div
            className="lens-overlay"
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <aside
            className="lens"
            id="ai-lens"
            role="dialog"
            aria-modal="true"
            aria-label="AI Lens"
          >
            <header className="lens__head">
              <span className="ai-mark">
                <IconSparkle style={{ width: 12, height: 12 }} />
                AI Lens
              </span>
              <Link className="lens__full" href="/control">
                Open Control Center <IconArrowRight style={{ width: 11, height: 11 }} />
              </Link>
              <button
                className="drawer__close"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the AI Lens"
              >
                <IconX style={{ width: 15, height: 15 }} />
              </button>
            </header>

            <div className="lens__ctx">
              <span className="t-label">Current context</span>
              <p className="lens__ctx-name">{context.label}</p>
              <p className="lens__ctx-kind">
                {SURFACE_LABEL[context.surface] ?? "Marketplace"}
                {context.asset_version_id ? (
                  <span className="t-mono"> · {context.asset_version_id}</span>
                ) : null}
              </p>
            </div>

            <div className="lens__body">
              {session.entries.length === 0 ? (
                <div className="lens__suggest">
                  <p className="t-label">Suggested</p>
                  <ul>
                    {suggestions.map((item) => (
                      <li key={item.utterance}>
                        <button type="button" onClick={() => ask(item.utterance)}>
                          <span>{item.label}</span>
                          {item.hint ? <em>{item.hint}</em> : null}
                          <IconArrowRight style={{ width: 12, height: 12 }} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="t-caption">
                    Answers are built from this asset&rsquo;s persisted records. Anything
                    that would change state asks you first.
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
                  <div ref={bottom} />
                </>
              )}
            </div>

            <form className="lens__form" onSubmit={submit}>
              <textarea
                className="cc-cmd__input"
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder="Ask anything about what you are looking at…"
                aria-label="Ask the AI Lens"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(event);
                  }
                }}
                disabled={session.busy}
              />
              <button
                className="btn btn--sm"
                type="submit"
                disabled={session.busy || draft.trim().length === 0}
              >
                {session.busy ? "…" : "Ask"}
              </button>
            </form>
          </aside>
        </>
      ) : null}
    </>
  );
}
