"use client";

import { useState } from "react";

import type { OperatorAction, OperatorBlock, OperatorContext } from "@/contracts";
import { IconAlert, IconArrowRight, IconSparkle } from "@/components/ui/icons";

import { OperatorBlocks, SuggestionRow } from "./blocks";
import { PlanRunner } from "./plan-runner";
import type { OperatorEntry } from "./session";

const AI_LABEL: Record<string, string> = {
  ready: "model-routed",
  not_needed: "rule-routed",
  disabled: "rule-routed",
  unavailable: "rule-routed",
};

function Understanding({ entry }: { entry: OperatorEntry }) {
  const response = entry.response;
  if (response === null) return null;
  const { understanding, ai } = response;
  return (
    <div className="turn__read">
      <span className="turn__intent">{understanding.intent}</span>
      {understanding.tool ? (
        <span className={`turn__tool turn__tool--${understanding.kind ?? "read"}`}>
          <span className="t-mono">{understanding.tool}</span>
          <em>{understanding.kind === "write" ? "needs approval" : "read"}</em>
        </span>
      ) : null}
      <span className={`turn__route turn__route--${ai.state}`}>
        {ai.state === "ready" ? (
          <IconSparkle style={{ width: 11, height: 11 }} />
        ) : null}
        {AI_LABEL[ai.state] ?? "rule-routed"}
      </span>
      {response.trace.length > 0 ? (
        <span className="turn__ms t-num">
          {response.trace.reduce((sum, item) => sum + item.duration_ms, 0)}ms
        </span>
      ) : null}
    </div>
  );
}

/**
 * One turn in the console. It shows how the request was read, what the resolved
 * asset was and why, then the visual answer. It is deliberately a record, not a
 * chat bubble: everything that produced the answer stays inspectable.
 */
export function OperatorTurn({
  entry,
  index,
  context,
  now,
  busy,
  onSuggest,
  onConfirm,
  onCancel,
}: {
  entry: OperatorEntry;
  index: number;
  context: OperatorContext;
  now: number;
  busy: boolean;
  onSuggest: (utterance: string) => void;
  onConfirm: (action: OperatorAction) => void;
  onCancel: () => void;
}) {
  const [dismissedAction, setDismissedAction] = useState(false);
  const response = entry.response;

  const plans = (response?.blocks ?? []).filter(
    (block): block is Extract<OperatorBlock, { kind: "plan" }> => block.kind === "plan",
  );
  const rest = (response?.blocks ?? []).filter((block) => {
    if (block.kind === "plan") return false;
    if (block.kind === "action_preview" && dismissedAction) return false;
    return true;
  });

  return (
    <article className={`turn turn--${entry.status}`} aria-busy={entry.status === "running"}>
      <div className="turn__bar">
        <span className="turn__index t-num">{String(index + 1).padStart(2, "0")}</span>
        <p className="turn__utterance">
          {entry.origin === "action" ? (
            <span className="turn__origin">approved</span>
          ) : null}
          {entry.utterance}
        </p>
      </div>

      {entry.status === "running" ? (
        <div className="turn__body">
          <div className="working">
            <p className="working__title">
              <span className="spin" aria-hidden="true" />
              Reading the records
            </p>
            <div className="skeleton-stack">
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--text" style={{ width: "86%" }} />
              <div className="skeleton skeleton--text" style={{ width: "62%" }} />
            </div>
          </div>
        </div>
      ) : null}

      {entry.status === "error" ? (
        <div className="turn__body">
          <section className="ab-blocked">
            <header className="ab-blocked__head">
              <IconAlert style={{ width: 16, height: 16 }} />
              <h3>Nothing was changed</h3>
            </header>
            <p className="ab-blocked__reason">{entry.error}</p>
          </section>
        </div>
      ) : null}

      {response !== null ? (
        <>
          <Understanding entry={entry} />

          {response.understanding.resolved_asset !== null ? (
            <p className="turn__resolved">
              <IconArrowRight style={{ width: 12, height: 12 }} />
              {response.understanding.resolved_asset.how}
            </p>
          ) : null}

          <div className="turn__body">
            {rest.length > 0 ? (
              <OperatorBlocks
                blocks={rest}
                now={now}
                busy={busy}
                onSuggest={onSuggest}
                onConfirm={onConfirm}
                onCancel={() => {
                  setDismissedAction(true);
                  onCancel();
                }}
              />
            ) : null}

            {plans.map((block) => (
              <PlanRunner
                plan={block.plan}
                context={context}
                now={now}
                onSuggest={onSuggest}
                key={block.plan.plan_id}
              />
            ))}

            <SuggestionRow suggestions={response.suggestions} onSuggest={onSuggest} />
          </div>
        </>
      ) : null}
    </article>
  );
}
