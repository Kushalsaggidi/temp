"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { LifecycleState } from "@/contracts";
import { IconAlert } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type GovernanceActionsProps = {
  assetVersionId: string;
  lifecycle: LifecycleState;
  canPublish: boolean;
  runnable: boolean;
  prototypeLimitation: string;
};

type ErrorBody = {
  error?: {
    message?: string;
    issues?: { path: string; message: string }[];
  };
};

export function GovernanceActions({
  assetVersionId,
  lifecycle,
  canPublish,
  runnable,
  prototypeLimitation,
}: GovernanceActionsProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function request(path: string, body?: unknown): Promise<unknown> {
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = (await response.json()) as ErrorBody;
      if (!response.ok) {
        const messages = [
          payload.error?.message ?? "The governance action failed.",
          ...(payload.error?.issues?.map((issue) => `${issue.path}: ${issue.message}`) ?? []),
        ];
        setErrors(messages);
        toast.push({ tone: "error", title: "Action failed", detail: messages[0] });
        throw new Error("handled");
      }
      toast.push({
        tone: "success",
        title: "Action recorded",
        detail: "The governance record has been refreshed.",
      });
      router.refresh();
      return payload;
    } catch (error) {
      if (!(error instanceof Error && error.message === "handled")) {
        setErrors(["The governance action could not be completed."]);
        toast.push({
          tone: "error",
          title: "Action failed",
          detail: "The service was unreachable. Nothing was changed.",
        });
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function transition(toState: LifecycleState, actorName: string, reason: string) {
    const reviewerAction = ["in_review", "changes_requested", "published", "deprecated"].includes(
      toState,
    );
    await request(`/api/governance/versions/${assetVersionId}/transitions`, {
      to_state: toState,
      actor_type: reviewerAction ? "demo_reviewer" : "team_member",
      actor_name: actorName,
      reason,
      ...(toState === "published" ? { confirm_publication: true } : {}),
    });
  }

  function transitionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    void transition(
      String(data.get("target")) as LifecycleState,
      String(data.get("actor_name") ?? ""),
      String(data.get("reason") ?? ""),
    );
  }

  function demoReviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void request(`/api/governance/versions/${assetVersionId}/demo-review`, {
      review_type: String(data.get("review_type")),
      result: String(data.get("result")),
      reviewer_name: String(data.get("reviewer_name")),
      reviewer_role: String(data.get("reviewer_role") ?? "").trim() || undefined,
      scope: String(data.get("scope")),
      summary: String(data.get("summary")),
      accept_scoped_security_review: data.get("accept_scoped_security_review") === "on",
    });
  }

  function cloneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void request(`/api/governance/versions/${assetVersionId}/draft`, {
      version: String(data.get("version")),
      actor_name: String(data.get("actor_name")),
      reason: String(data.get("reason")),
    }).then((payload) => {
      const id = (payload as { asset_version?: { asset_version_id?: string } } | undefined)
        ?.asset_version?.asset_version_id;
      if (id) router.push(`/governance/${id}`);
    });
  }

  const availableTransitions: { state: LifecycleState; label: string; danger?: boolean }[] =
    lifecycle === "draft"
      ? [{ state: "submitted", label: "Submit for review" }]
      : lifecycle === "submitted"
        ? [{ state: "in_review", label: "Start review" }]
        : lifecycle === "in_review"
          ? [
              { state: "published", label: "Publish" },
              { state: "changes_requested", label: "Request changes", danger: true },
            ]
          : lifecycle === "changes_requested"
            ? [{ state: "submitted", label: "Resubmit" }]
            : lifecycle === "published"
              ? [{ state: "deprecated", label: "Deprecate", danger: true }]
              : [];

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }} aria-label="Governance actions">
      {errors.length > 0 ? (
        <div className="notice notice--danger" role="alert">
          <IconAlert className="notice__icon" />
          <ul style={{ margin: 0, paddingLeft: "var(--sp-4)" }}>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <h2>Lifecycle</h2>
        </div>
        <div className="panel__body">
          {availableTransitions.length > 0 ? (
            <form
              onSubmit={transitionSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
            >
              <label className="field">
                <span>Actor / reviewer name</span>
                <input className="input" name="actor_name" required />
              </label>
              <label className="field">
                <span>Reason</span>
                <textarea
                  className="textarea"
                  name="reason"
                  rows={2}
                  required
                  defaultValue="Manual prototype lifecycle action."
                />
              </label>
              <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                {availableTransitions.map((transitionOption) => (
                  <button
                    className={`btn btn--sm${transitionOption.danger ? " btn--danger" : ""}`}
                    key={transitionOption.state}
                    name="target"
                    value={transitionOption.state}
                    type="submit"
                    disabled={
                      busy || (transitionOption.state === "published" && !canPublish)
                    }
                    title={
                      transitionOption.state === "published" && !canPublish
                        ? "Publication gates are blocked."
                        : undefined
                    }
                  >
                    {transitionOption.label}
                  </button>
                ))}
              </div>
            </form>
          ) : (
            <p className="t-small">No further lifecycle transition is available.</p>
          )}
        </div>
        <div className="panel__foot">{prototypeLimitation}</div>
      </section>

      {lifecycle === "in_review" ? (
        <section className="panel">
          <div className="panel__head">
            <h2>Record a human outcome</h2>
          </div>
          <div className="panel__body">
            <form
              onSubmit={demoReviewSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
            >
              <label className="field">
                <span>Review type</span>
                <select className="select" name="review_type" defaultValue="human_review">
                  <option value="human_review">Human prepublication review</option>
                  <option value="source_permission">Source permission</option>
                  {runnable ? <option value="security_review">Security and data handling</option> : null}
                </select>
              </label>
              <label className="field">
                <span>Outcome</span>
                <select className="select" name="result" defaultValue="passed">
                  <option value="passed">Passed</option>
                  <option value="needs_changes">Needs changes</option>
                  <option value="failed">Failed</option>
                  <option value="not_applicable">Not applicable (synthetic source only)</option>
                </select>
              </label>
              <label className="field">
                <span>Reviewer name</span>
                <input className="input" name="reviewer_name" required />
              </label>
              <label className="field">
                <span>
                  Reviewer role <span className="field__hint">Optional</span>
                </span>
                <input className="input" name="reviewer_role" />
              </label>
              <label className="field">
                <span>Scope</span>
                <textarea
                  className="textarea"
                  name="scope"
                  rows={2}
                  required
                  defaultValue={
                    runnable
                      ? "Scoped security and data-handling review of metadata, limitations, inputs, and failure behavior."
                      : "Prepublication human review of metadata, limitations, and source permissions."
                  }
                />
              </label>
              <label className="field">
                <span>Summary</span>
                <textarea className="textarea" name="summary" rows={3} required />
              </label>
              {runnable ? (
                <label style={{ display: "flex", gap: "var(--sp-2)", fontSize: "0.8125rem", alignItems: "flex-start" }}>
                  <input name="accept_scoped_security_review" type="checkbox" style={{ marginTop: 3 }} />
                  <span>
                    I am the named passing prepublication reviewer and explicitly accept the
                    scoped security and data-handling review.
                  </span>
                </label>
              ) : null}
              <button className="btn btn--sm" type="submit" disabled={busy}>
                Record evidence
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <h2>Deterministic check</h2>
        </div>
        <div className="panel__body">
          <p className="t-small" style={{ marginBottom: "var(--sp-3)" }}>
            Re-validates the frozen contract, exact subject digest, and permission
            decisions. It cannot approve or publish.
          </p>
          <button
            className="btn btn--sm btn--secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void request(`/api/governance/versions/${assetVersionId}/checks/metadata`)
            }
          >
            Run metadata validation
          </button>
        </div>
      </section>

      {lifecycle === "published" || lifecycle === "deprecated" ? (
        <section className="panel">
          <div className="panel__head">
            <h2>Create an editable version</h2>
          </div>
          <div className="panel__body">
            <p className="t-small" style={{ marginBottom: "var(--sp-3)" }}>
              The existing version stays unchanged. This copies its content into a distinct
              draft with no subject digest and no inherited evidence.
            </p>
            <form
              onSubmit={cloneSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
            >
              <label className="field">
                <span>New semantic version</span>
                <input className="input" name="version" required placeholder="1.1.0" />
              </label>
              <label className="field">
                <span>Actor name</span>
                <input className="input" name="actor_name" required />
              </label>
              <label className="field">
                <span>Reason</span>
                <textarea
                  className="textarea"
                  name="reason"
                  rows={2}
                  required
                  defaultValue="Create a new draft for proposed edits."
                />
              </label>
              <button className="btn btn--sm" type="submit" disabled={busy}>
                Create distinct draft
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
