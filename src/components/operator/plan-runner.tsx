"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { OperatorBlocks } from "./blocks";
import type {
  OperatorAction,
  OperatorBlock,
  OperatorContext,
  OperatorPlan,
  OperatorResponse,
  OperatorStep,
} from "@/contracts";
import { IconCheck, IconX } from "@/components/ui/icons";

async function post(path: string, body: unknown): Promise<OperatorResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || payload === null) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : "The step could not be completed. Nothing was changed.";
    throw new Error(message);
  }
  return payload as OperatorResponse;
}

function completionOf(response: OperatorResponse): Extract<
  OperatorBlock,
  { kind: "completion" }
> | null {
  const block = response.blocks.find((item) => item.kind === "completion");
  return block?.kind === "completion" ? block : null;
}

function blockedOf(response: OperatorResponse): Extract<
  OperatorBlock,
  { kind: "blocked" }
> | null {
  const block = response.blocks.find((item) => item.kind === "blocked");
  return block?.kind === "blocked" ? block : null;
}

function actionOf(response: OperatorResponse): OperatorAction | null {
  const block = response.blocks.find((item) => item.kind === "action_preview");
  return block?.kind === "action_preview" ? block.action : null;
}

/**
 * Runs a plan one step at a time against the real capabilities. Nothing starts
 * until the plan is executed, each step reports what it actually did, a step
 * marked as needing confirmation stops and shows its own preview first, and a
 * failure halts the plan rather than carrying on.
 */
export function PlanRunner({
  plan,
  context,
  now,
  onSuggest,
}: {
  plan: OperatorPlan;
  context: OperatorContext;
  now: number;
  onSuggest?: (utterance: string) => void;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<OperatorStep[]>(plan.steps);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [carried, setCarried] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: OperatorAction; index: number } | null>(
    null,
  );
  const [results, setResults] = useState<OperatorBlock[]>([]);

  const update = useCallback((index: number, patch: Partial<OperatorStep>) => {
    setSteps((current) =>
      current.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    );
  }, []);

  const argsFor = useCallback(
    (step: OperatorStep, assetVersionId: string | null): Record<string, unknown> =>
      assetVersionId === null
        ? step.args
        : { ...step.args, asset_version_id: assetVersionId },
    [],
  );

  const runFrom = useCallback(
    async (from: number, initialAsset: string | null, skipConfirmAt?: number) => {
      setRunning(true);
      setStarted(true);
      let asset = initialAsset;

      for (let index = from; index < steps.length; index += 1) {
        const step = steps[index]!;
        const args = argsFor(step, asset);

        if (step.confirm_required && index !== skipConfirmAt) {
          update(index, { status: "ready" });
          try {
            const previewResponse = await post("/api/operator/preview", {
              tool: step.tool,
              args,
              context,
            });
            const action = actionOf(previewResponse);
            if (action === null) {
              const blocked = blockedOf(previewResponse);
              update(index, {
                status: "blocked",
                outcome: blocked?.reason ?? "This step cannot run yet.",
              });
              setResults((current) => [...current, ...previewResponse.blocks]);
              setRunning(false);
              return;
            }
            setPending({ action: { ...action, args }, index });
          } catch (cause) {
            update(index, {
              status: "failed",
              outcome:
                cause instanceof Error ? cause.message : "The preview could not be built.",
            });
          }
          setRunning(false);
          return;
        }

        update(index, { status: "running" });
        try {
          const response = await post("/api/operator/act", {
            tool: step.tool,
            args,
            context,
            confirmed: true,
          });
          const completion = completionOf(response);
          const blocked = blockedOf(response);

          if (completion !== null) {
            asset = completion.asset_version_id ?? asset;
            setCarried(asset);
            update(index, { status: "complete", outcome: completion.detail });
            setResults((current) => [...current, ...response.blocks]);
          } else {
            update(index, {
              status: "failed",
              outcome: blocked?.reason ?? "The step did not report a verified result.",
            });
            setResults((current) => [...current, ...response.blocks]);
            setRunning(false);
            router.refresh();
            return;
          }
        } catch (cause) {
          update(index, {
            status: "failed",
            outcome:
              cause instanceof Error ? cause.message : "Nothing was changed by this step.",
          });
          setRunning(false);
          return;
        }
      }

      setRunning(false);
      router.refresh();
    },
    [argsFor, context, router, steps, update],
  );

  const approvePending = useCallback(async () => {
    if (pending === null) return;
    const { index } = pending;
    setPending(null);
    await runFrom(index, carried, index);
  }, [carried, pending, runFrom]);

  const done = steps.filter((step) => step.status === "complete").length;
  const failed = steps.some(
    (step) => step.status === "failed" || step.status === "blocked",
  );
  const finished = done === steps.length;
  const nextIndex = steps.findIndex(
    (step) => step.status !== "complete" && step.status !== "skipped",
  );

  return (
    <div className="ab-planrun">
      <section className={`ab-plan${running ? " is-running" : ""}`}>
        <header className="ab-plan__head">
          <span className="ab-plan__badge">Plan</span>
          <div style={{ minWidth: 0 }}>
            <h3>{plan.title}</h3>
            <p className="t-caption">{plan.goal}</p>
          </div>
          <span className="ab-plan__count t-num">
            {done}/{steps.length}
          </span>
        </header>

        <ol className="ab-steps">
          {steps.map((step) => (
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

        {!finished && pending === null ? (
          <div className="ab-plan__foot">
            <p className="t-caption">
              {started
                ? failed
                  ? "The plan stopped. Nothing after the failed step ran."
                  : "Waiting to continue."
                : "Nothing has run yet. Each step is listed above before it happens, and every one of them writes."}
            </p>
            <button
              className="btn"
              type="button"
              disabled={running}
              onClick={() => void runFrom(nextIndex < 0 ? 0 : nextIndex, carried)}
            >
              {running
                ? "Running…"
                : failed
                  ? "Retry from here"
                  : started
                    ? "Continue"
                    : "Execute plan"}
            </button>
          </div>
        ) : null}
      </section>

      {pending !== null ? (
        <OperatorBlocks
          blocks={[{ kind: "action_preview", action: pending.action }]}
          now={now}
          busy={running}
          onSuggest={onSuggest}
          onConfirm={() => void approvePending()}
          onCancel={() => {
            update(pending.index, {
              status: "skipped",
              outcome: "You cancelled this step. Nothing was changed.",
            });
            setPending(null);
          }}
        />
      ) : null}

      {results.length > 0 ? (
        <OperatorBlocks blocks={results} now={now} onSuggest={onSuggest} />
      ) : null}
    </div>
  );
}
