"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  ExecutionRecordSchema,
  ExecutionRequestSchema,
  type ExecutionRecord,
  type ExecutionRequest,
} from "@/contracts";

import styles from "./try-result-provenance.module.css";

export type HeroExecutionFormValue = {
  briefTitle: string;
  audience: string;
  observations: string;
  constraints: string;
};

type HeroOutput = {
  title: string;
  summary: string[];
  review_questions: string[];
  limitations?: string[];
};

type TryResultProvenanceProps = {
  assetName: string;
  assetVersionId: string;
  initialValue?: Partial<HeroExecutionFormValue>;
};

const emptyForm: HeroExecutionFormValue = {
  briefTitle: "",
  audience: "",
  observations: "",
  constraints: "",
};

export const EXECUTION_REQUEST_TIMEOUT_MS = 10_000;
const EXECUTION_TIMEOUT_MESSAGE =
  "This took too long, so we stopped it. Nothing was produced. Please try again.";

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildHeroExecutionRequest(
  assetVersionId: string,
  value: HeroExecutionFormValue,
): ExecutionRequest {
  const constraints = nonEmptyLines(value.constraints);

  return ExecutionRequestSchema.parse({
    asset_version_id: assetVersionId,
    input: {
      brief_title: value.briefTitle.trim(),
      audience: value.audience.trim(),
      observations: nonEmptyLines(value.observations),
      ...(constraints.length > 0 ? { constraints } : {}),
    },
  });
}

export function TryResultProvenance({
  assetName,
  assetVersionId,
  initialValue,
}: TryResultProvenanceProps) {
  const formId = useId();
  const activeRequest = useRef<AbortController | null>(null);
  const [value, setValue] = useState<HeroExecutionFormValue>({
    ...emptyForm,
    ...initialValue,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [record, setRecord] = useState<ExecutionRecord | null>(null);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );

  function updateField<Key extends keyof HeroExecutionFormValue>(
    field: Key,
    fieldValue: HeroExecutionFormValue[Key],
  ) {
    setValue((current) => ({ ...current, [field]: fieldValue }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    if (
      value.briefTitle.trim().length === 0 ||
      value.audience.trim().length === 0 ||
      nonEmptyLines(value.observations).length === 0
    ) {
      setFormError(
        "Please add a title, who it is for, and at least one note.",
      );
      return;
    }

    let executionRequest: ExecutionRequest;
    try {
      executionRequest = buildHeroExecutionRequest(assetVersionId, value);
    } catch {
      setFormError("We could not read those details. Please check them and try again.");
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EXECUTION_REQUEST_TIMEOUT_MS);
    setSubmitting(true);
    setFormError(null);
    setRequestError(null);
    setRecord(null);

    try {
      const response = await fetch("/api/executions", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(executionRequest),
      });
      const responseBody: unknown = await response.json().catch((cause) => {
        if (controller.signal.aborted) throw cause;
        return null;
      });
      const parsedRecord = ExecutionRecordSchema.safeParse(responseBody);

      if (
        parsedRecord.success &&
        parsedRecord.data.asset_version_id === assetVersionId &&
        parsedRecord.data.purpose === "user_run"
      ) {
        setRecord(parsedRecord.data);
      } else {
        setRequestError(
          response.ok
            ? "We could not verify the result, so we have not shown it."
            : "The request was turned away and no result was produced.",
        );
      }
    } catch {
      if (controller.signal.aborted) {
        if (timedOut) setRequestError(EXECUTION_TIMEOUT_MESSAGE);
        return;
      }
      setRequestError(
        "The service is temporarily unavailable. Nothing was produced.",
      );
    } finally {
      clearTimeout(deadline);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.formCard} aria-labelledby={`${formId}-title`}>
        <p className={styles.kicker}>Your details</p>
        <h2 id={`${formId}-title`}>Build a review brief</h2>
        <p className={styles.intro}>
          Enter notes you already have. {assetName} organises them into a brief you can
          review. It does not check whether they are correct, and it never decides anything.
        </p>

        <form className={styles.form} onSubmit={submit} aria-busy={submitting}>
          <label htmlFor={`${formId}-brief-title`}>
            What is this brief about?
            <input
              id={`${formId}-brief-title`}
              name="brief_title"
              value={value.briefTitle}
              onChange={(event) => updateField("briefTitle", event.target.value)}
              required
              maxLength={200}
              autoComplete="off"
            />
          </label>

          <label htmlFor={`${formId}-audience`}>
            Who is it for?
            <input
              id={`${formId}-audience`}
              name="audience"
              value={value.audience}
              onChange={(event) => updateField("audience", event.target.value)}
              required
              maxLength={200}
              autoComplete="off"
            />
          </label>

          <label htmlFor={`${formId}-observations`}>
            Your notes
            <span>One note per line.</span>
            <textarea
              id={`${formId}-observations`}
              name="observations"
              value={value.observations}
              onChange={(event) =>
                updateField("observations", event.target.value)
              }
              required
              maxLength={10_000}
              rows={7}
            />
          </label>

          <label htmlFor={`${formId}-constraints`}>
            Things to keep in mind <em>Optional</em>
            <span>One per line. Anything the reader must keep in mind.</span>
            <textarea
              id={`${formId}-constraints`}
              name="constraints"
              value={value.constraints}
              onChange={(event) =>
                updateField("constraints", event.target.value)
              }
              maxLength={5_000}
              rows={5}
            />
          </label>

          {formError ? (
            <p className={styles.errorNotice} role="alert">
              {formError}
            </p>
          ) : null}

          <button
            className={`btn ${styles.submit}`}
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Working…" : "Create the brief"}
          </button>
        </form>
      </section>

      <section className={styles.resultColumn} aria-label="Execution result">
        {submitting ? (
          <div className={styles.pendingCard} role="status" aria-live="polite">
            <span className={styles.statusDot} aria-hidden="true" />
            <div>
              <strong>Working on it</strong>
              <p>We are checking your details and the asset setup before it runs.</p>
            </div>
          </div>
        ) : null}

        {requestError ? (
          <div className={styles.outcomeCard} role="alert">
            <p className={styles.outcomeLabel}>Could not run</p>
            <h2>Nothing was produced</h2>
            <p>{requestError}</p>
          </div>
        ) : null}

        {record ? <ExecutionOutcome record={record} /> : null}

        {!submitting && !requestError && !record ? (
          <div className={styles.emptyResult}>
            <p className={styles.outcomeLabel}>Result</p>
            <h2>Your result will appear here</h2>
            <p>
              Every run is saved with the exact version that produced it, so you can always
              trace a result back to its source.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function ExecutionOutcome({ record }: { record: ExecutionRecord }) {
  const output = record.status === "succeeded" ? readHeroOutput(record.output) : null;

  return (
    <div className={styles.outcomeStack} aria-live="polite">
      <section
        className={`${styles.outcomeCard} ${styles[`status_${record.status}`]}`}
        role={record.status === "succeeded" || record.status === "pending" || record.status === "running" ? "status" : "alert"}
      >
        <p className={styles.outcomeLabel}>{outcomeLabel(record.status)}</p>
        <h2>{outcomeTitle(record.status)}</h2>
        <p>{outcomeDescription(record)}</p>

        {record.status === "succeeded" && output ? (
          <div className={styles.structuredOutput}>
            <h3>{output.title}</h3>
            <OutputList title="Summary" items={output.summary} />
            <OutputList
              title="Review questions"
              items={output.review_questions}
            />
            {output.limitations && output.limitations.length > 0 ? (
              <OutputList title="Limitations" items={output.limitations} />
            ) : null}
          </div>
        ) : null}

        {record.status === "succeeded" && !output ? (
          <p className={styles.errorNotice} role="alert">
            The saved result is not in a shape we can safely display, so we have not
            shown it.
          </p>
        ) : null}

        {record.status === "failed" ? (
          <dl className={styles.failureDetails}>
            <div>
              <dt>Reference code</dt>
              <dd>{record.error?.code ?? "execution_failed"}</dd>
            </div>
            <div>
              <dt>What happened</dt>
              <dd>
                {record.error?.message ??
                  "The executor did not complete successfully."}
              </dd>
            </div>
            <div>
              <dt>Worth trying again?</dt>
              <dd>{record.error?.retryable ? "Yes" : "No"}</dd>
            </div>
          </dl>
        ) : null}

        {record.status === "invalid" || record.status === "blocked" ? (
          <p className={styles.rejectionReason}>{record.rejection_reason}</p>
        ) : null}
      </section>

      <ExecutionProvenance record={record} />
    </div>
  );
}

function OutputList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ExecutionProvenance({ record }: { record: ExecutionRecord }) {
  const rows: Array<[string, string]> = [
    ["Execution ID", record.execution_id],
    ["Status", record.status],
    ["Asset ID", record.asset_id],
    ["Asset version ID", record.asset_version_id],
    ["Version", record.asset_version],
    ["Run type", record.purpose.replaceAll("_", " ")],
    ["Execution mode", record.execution_mode],
    ["Started", record.started_at],
  ];

  if (record.executor_key) rows.push(["Executor key", record.executor_key]);
  if (record.definition_digest) {
    rows.push(["Definition digest", record.definition_digest]);
  }
  if (record.completed_at) rows.push(["Completed", record.completed_at]);
  if (record.model_or_config?.provider) {
    rows.push(["Provider", record.model_or_config.provider]);
  }
  if (record.model_or_config?.model) {
    rows.push(["Model", record.model_or_config.model]);
  }
  if (record.model_or_config?.configuration_digest) {
    rows.push([
      "Configuration digest",
      record.model_or_config.configuration_digest,
    ]);
  }

  return (
    <aside className={styles.provenance} aria-labelledby={`provenance-${record.execution_id}`}>
      <p className={styles.outcomeLabel}>Persisted provenance</p>
      <h2 id={`provenance-${record.execution_id}`}>Execution record</h2>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.provenanceNote}>
        Inputs, internal error details, and configuration parameters are not
        exposed in this view.
      </p>
    </aside>
  );
}

function readHeroOutput(value: unknown): HeroOutput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "title",
    "summary",
    "review_questions",
    "limitations",
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return null;
  if (typeof candidate.title !== "string") return null;
  if (!isStringArray(candidate.summary)) return null;
  if (!isStringArray(candidate.review_questions)) return null;
  if (
    candidate.limitations !== undefined &&
    !isStringArray(candidate.limitations)
  ) {
    return null;
  }

  return {
    title: candidate.title,
    summary: candidate.summary,
    review_questions: candidate.review_questions,
    ...(candidate.limitations === undefined
      ? {}
      : { limitations: candidate.limitations }),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function outcomeLabel(status: ExecutionRecord["status"]): string {
  switch (status) {
    case "pending":
      return "Accepted";
    case "running":
      return "In progress";
    case "succeeded":
      return "Validated result";
    case "invalid":
      return "Input validation";
    case "blocked":
      return "Policy guardrail";
    case "failed":
      return "Execution failure";
  }
}

function outcomeTitle(status: ExecutionRecord["status"]): string {
  switch (status) {
    case "pending":
      return "Execution accepted";
    case "running":
      return "Execution in progress";
    case "succeeded":
      return "Execution succeeded";
    case "invalid":
      return "Input rejected before execution";
    case "blocked":
      return "Execution blocked";
    case "failed":
      return "Execution failed";
  }
}

function outcomeDescription(record: ExecutionRecord): string {
  switch (record.status) {
    case "pending":
      return "The accepted run is waiting to start. No output exists yet.";
    case "running":
      return "The allowlisted executor is running. No output is shown until validation completes.";
    case "succeeded":
      return "The output passed the registered output schema. A knowledgeable human must still verify it.";
    case "invalid":
      return "The input did not pass the canonical input contract, so the executor was not run.";
    case "blocked":
      return "A lifecycle, availability, integrity, or safety check prevented execution.";
    case "failed":
      return "The executor started but did not complete successfully. No result is being substituted.";
  }
}
