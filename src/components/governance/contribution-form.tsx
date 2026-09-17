"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconSparkle,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

const schemaDraft = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  null,
  2,
);

interface DuplicateCandidate {
  asset_version_id: string;
  name: string;
  summary: string;
  owner: string;
  overlap: number;
  matched_fields: string[];
}

type ApiError = {
  error?: { message?: string; issues?: { path: string; message: string }[] };
};

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Non-blocking overlap warning shown while the contributor is still typing. */
function DuplicateGuard({
  candidates,
  checking,
}: {
  candidates: DuplicateCandidate[];
  checking: boolean;
}) {
  if (checking && candidates.length === 0) {
    return (
      <div className="panel" aria-live="polite">
        <div className="panel__body skeleton-stack">
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--text" style={{ width: "88%" }} />
          <div className="skeleton skeleton--text" style={{ width: "64%" }} />
        </div>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="panel">
        <div className="panel__head">
          <IconSparkle style={{ width: 15, height: 15, color: "var(--ai)" }} />
          <h3>Duplicate guard</h3>
        </div>
        <div className="panel__body">
          <p className="t-small">
            As you describe the contribution, the catalog is checked for published assets
            that already cover the same job. Nothing overlapping has been found yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ borderColor: "var(--ai-border)" }} aria-live="polite">
      <div className="panel__head" style={{ background: "var(--ai-soft)" }}>
        <span className="ai-mark">
          <IconSparkle style={{ width: 12, height: 12 }} />
          Similar assets found
        </span>
      </div>
      <div className="panel__body">
        <p className="t-small" style={{ marginBottom: "var(--sp-4)" }}>
          {candidates.length} published {candidates.length === 1 ? "asset" : "assets"} may
          already solve this problem. Reusing one is usually faster than building another.
        </p>
        <ul className="evidence-list">
          {candidates.map((candidate) => (
            <li className="evidence" key={candidate.asset_version_id}>
              <div className="evidence__top">
                <span className="match__value" style={{ fontSize: "0.875rem" }}>
                  {candidate.overlap}%
                </span>
                <span className="evidence__type">{candidate.name}</span>
              </div>
              <p className="evidence__summary">{candidate.summary}</p>
              <div className="matched-fields" style={{ marginTop: "var(--sp-2)" }}>
                {candidate.matched_fields.slice(0, 4).map((field) => (
                  <span className="matched-field" key={field}>
                    {field.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
                <Link
                  className="btn btn--sm btn--secondary"
                  href={`/assets/${candidate.asset_version_id}`}
                >
                  Compare <IconExternal style={{ width: 12, height: 12 }} />
                </Link>
                <Link
                  className="btn btn--sm btn--tertiary"
                  href={`/assets/${candidate.asset_version_id}`}
                >
                  Reuse instead
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <p className="t-caption" style={{ marginTop: "var(--sp-4)" }}>
          This is advisory. If your contribution is genuinely different, continue and say
          how it differs in the description.
        </p>
      </div>
    </div>
  );
}

export function ContributionForm() {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string>();
  const [findings, setFindings] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [aiNote, setAiNote] = useState<string>();
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [draft, setDraft] = useState({ name: "", summary: "", capabilities: "", domains: "" });

  function buildPayload(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      slug: String(data.get("slug") ?? ""),
      actor_name: String(data.get("actor_name") ?? ""),
      content: {
        version: String(data.get("version") ?? ""),
        name: String(data.get("name") ?? ""),
        summary: String(data.get("summary") ?? ""),
        owner: String(data.get("owner") ?? ""),
        asset_type: String(data.get("asset_type") ?? "template"),
        execution_kind: "none",
        description: String(data.get("description") ?? ""),
        audiences: lines(data.get("audiences")),
        domains: lines(data.get("domains")),
        capabilities: lines(data.get("capabilities")),
        use_cases: lines(data.get("use_cases")),
        input_schema: JSON.parse(String(data.get("input_schema") ?? "{}")),
        output_schema: JSON.parse(String(data.get("output_schema") ?? "{}")),
        limitations: lines(data.get("limitations")),
        usage_instructions: String(data.get("usage_instructions") ?? ""),
        setup_expectations: String(data.get("setup_expectations") ?? ""),
        maintenance_expectations: String(data.get("maintenance_expectations") ?? ""),
        test_scenarios: JSON.parse(String(data.get("test_scenarios") ?? "[]")),
        availability: String(data.get("availability") ?? "reference_only"),
        source_class: String(data.get("source_class") ?? "created_during_event"),
        source_reference: String(data.get("source_reference") ?? "").trim() || null,
        license_id: String(data.get("license_id") ?? "").trim() || null,
        attribution: String(data.get("attribution") ?? "").trim() || null,
        permission_evidence_id: String(data.get("permission_evidence_id") ?? "").trim() || null,
        access_permission: String(data.get("access_permission") ?? "unconfirmed"),
        tool_use_permission: String(data.get("tool_use_permission") ?? "unconfirmed"),
        final_package_permission: String(data.get("final_package_permission") ?? "unconfirmed"),
      },
    };
  }

  const checkDuplicates = useCallback(
    async (payload: { name: string; summary: string; capabilities: string; domains: string }) => {
      const probe = `${payload.name} ${payload.summary} ${payload.capabilities}`.trim();
      if (probe.length < 16) {
        setDuplicates([]);
        return;
      }
      setChecking(true);
      try {
        const response = await fetch("/api/governance/duplicate-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            summary: payload.summary,
            capabilities: payload.capabilities.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
            domain: payload.domains.split(/\r?\n|,/)[0]?.trim() || undefined,
          }),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { candidates?: DuplicateCandidate[] };
        setDuplicates(body.candidates ?? []);
      } catch {
        // Advisory only; a failed check never blocks the contributor.
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => void checkDuplicates(draft), 600);
    return () => clearTimeout(timer);
  }, [draft, checkDuplicates]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setErrors([]);
    setCreatedId(undefined);
    try {
      const payload = buildPayload(form);
      const response = await fetch("/api/governance/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ApiError & {
        asset_version?: { asset_version_id?: string };
      };
      if (!response.ok) {
        const messages = [
          body.error?.message ?? "The contribution could not be created.",
          ...(body.error?.issues?.map((issue) => `${issue.path || "metadata"}: ${issue.message}`) ?? []),
        ];
        setErrors(messages);
        toast.push({ tone: "error", title: "Contribution rejected", detail: messages[0] });
        return;
      }
      setCreatedId(body.asset_version?.asset_version_id);
      toast.push({
        tone: "success",
        title: "Draft created",
        detail: "It is queued for human review and stays out of public discovery.",
      });
      form.reset();
      setDraft({ name: "", summary: "", capabilities: "", domains: "" });
      setDuplicates([]);
    } catch (caught) {
      const message =
        caught instanceof SyntaxError
          ? "Input schema, output schema, and scenarios must be valid JSON."
          : "The contribution request could not be completed.";
      setErrors([message]);
      toast.push({ tone: "error", title: "Contribution failed", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function inspect() {
    const form = formRef.current;
    if (!form) return;
    setBusy(true);
    setErrors([]);
    try {
      const payload = buildPayload(form);
      const response = await fetch("/api/governance/metadata-assistance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: payload.content }),
      });
      const result = (await response.json()) as {
        deterministic_findings?: string[];
        ai?: { state?: string; suggestions?: string[]; reason?: string; model_or_config?: string };
      };
      setFindings(result.deterministic_findings ?? []);
      setSuggestions(result.ai?.suggestions ?? []);
      setAiNote(
        result.ai?.state === "ready"
          ? `Suggestions from ${result.ai.model_or_config}. They cannot approve or publish.`
          : result.ai?.reason,
      );
      toast.push({
        tone: (result.deterministic_findings?.length ?? 0) > 0 ? "warning" : "success",
        title: "Metadata checked",
        detail:
          (result.deterministic_findings?.length ?? 0) > 0
            ? `${result.deterministic_findings?.length} required field${result.deterministic_findings?.length === 1 ? "" : "s"} still missing.`
            : "Every required field is present.",
      });
    } catch {
      setErrors(["Metadata could not be checked. Schemas and scenarios must be valid JSON."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="two-col" style={{ alignItems: "start", gap: "var(--sp-6)" }}>
      <form className="panel" ref={formRef} onSubmit={submit} aria-busy={busy}>
        <div className="panel__head">
          <h2>Contribution metadata</h2>
        </div>
        <div className="panel__body" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {createdId ? (
            <div className="notice notice--info" role="status">
              <IconCheck className="notice__icon" />
              <div>
                <strong>Draft created</strong>
                <p style={{ marginTop: 2 }}>
                  It is queued for human review and is not visible in public discovery.
                </p>
                <Link
                  className="btn btn--sm btn--secondary"
                  href={`/governance/${createdId}`}
                  style={{ marginTop: "var(--sp-3)" }}
                >
                  Open governance record
                </Link>
              </div>
            </div>
          ) : null}

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

          <div className="two-col">
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                name="name"
                required
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Slug</span>
              <input className="input" name="slug" required placeholder="resident-notice-planner" />
            </label>
          </div>

          <label className="field">
            <span>Summary</span>
            <textarea
              className="textarea"
              name="summary"
              rows={2}
              required
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea className="textarea" name="description" rows={4} required />
          </label>

          <div className="two-col">
            <label className="field">
              <span>Owner</span>
              <input className="input" name="owner" required />
            </label>
            <label className="field">
              <span>Contributor name</span>
              <input className="input" name="actor_name" required />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span>Asset type</span>
              <select className="select" name="asset_type" defaultValue="template">
                {["skill", "workflow", "agent", "template", "dashboard", "plugin", "other"].map(
                  (type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>Version</span>
              <input className="input" name="version" required defaultValue="1.0.0" />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span>
                Capabilities <span className="field__hint">One per line</span>
              </span>
              <textarea
                className="textarea"
                name="capabilities"
                rows={3}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, capabilities: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>
                Use cases <span className="field__hint">One per line</span>
              </span>
              <textarea className="textarea" name="use_cases" rows={3} required />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span>
                Audiences <span className="field__hint">One per line</span>
              </span>
              <textarea className="textarea" name="audiences" rows={2} required />
            </label>
            <label className="field">
              <span>
                Domains <span className="field__hint">One per line</span>
              </span>
              <textarea
                className="textarea"
                name="domains"
                rows={2}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, domains: event.target.value }))
                }
              />
            </label>
          </div>

          <label className="field">
            <span>
              Limitations <span className="field__hint">One per line. Be specific about what it cannot do.</span>
            </span>
            <textarea className="textarea" name="limitations" rows={3} required />
          </label>

          <div className="two-col">
            <label className="field">
              <span>Usage instructions</span>
              <textarea className="textarea" name="usage_instructions" rows={2} required />
            </label>
            <label className="field">
              <span>Setup expectations</span>
              <textarea className="textarea" name="setup_expectations" rows={2} required />
            </label>
          </div>

          <label className="field">
            <span>Maintenance expectations</span>
            <textarea className="textarea" name="maintenance_expectations" rows={2} required />
          </label>

          <details className="tech">
            <summary>Contract and permissions</summary>
            <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
              <div className="two-col">
                <label className="field">
                  <span>Input schema (JSON)</span>
                  <textarea className="textarea t-mono" name="input_schema" rows={6} defaultValue={schemaDraft} />
                </label>
                <label className="field">
                  <span>Output schema (JSON)</span>
                  <textarea className="textarea t-mono" name="output_schema" rows={6} defaultValue={schemaDraft} />
                </label>
              </div>
              <label className="field">
                <span>Test scenarios (JSON array)</span>
                <textarea className="textarea t-mono" name="test_scenarios" rows={3} defaultValue="[]" />
              </label>
              <div className="two-col">
                <label className="field">
                  <span>Availability</span>
                  <select className="select" name="availability" defaultValue="reference_only">
                    <option value="reference_only">Reference only</option>
                    <option value="request_access">Request access</option>
                  </select>
                </label>
                <label className="field">
                  <span>Source class</span>
                  <select className="select" name="source_class" defaultValue="created_during_event">
                    <option value="created_during_event">Created during event</option>
                    <option value="team_owned">Team owned</option>
                    <option value="sponsor_provided">Sponsor provided</option>
                    <option value="third_party">Third party</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Source reference</span>
                <input className="input" name="source_reference" />
              </label>
              <div className="two-col">
                <label className="field">
                  <span>License ID</span>
                  <input className="input" name="license_id" />
                </label>
                <label className="field">
                  <span>Attribution</span>
                  <input className="input" name="attribution" />
                </label>
              </div>
              <div className="two-col">
                <label className="field">
                  <span>Access permission</span>
                  <select className="select" name="access_permission" defaultValue="unconfirmed">
                    <option value="unconfirmed">Unconfirmed</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="not_applicable">Not applicable</option>
                  </select>
                </label>
                <label className="field">
                  <span>Tool-use permission</span>
                  <select className="select" name="tool_use_permission" defaultValue="unconfirmed">
                    <option value="unconfirmed">Unconfirmed</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="not_applicable">Not applicable</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Final-package permission</span>
                <select className="select" name="final_package_permission" defaultValue="unconfirmed">
                  <option value="unconfirmed">Unconfirmed</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </label>
              <label className="field">
                <span>Permission evidence ID</span>
                <input className="input" name="permission_evidence_id" />
              </label>
            </div>
          </details>
        </div>

        <div className="drawer__foot">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Working…" : "Submit for review"}
          </button>
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => void inspect()}>
            <IconSparkle className="btn__icon" />
            Check metadata
          </button>
        </div>
      </form>

      <aside style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <DuplicateGuard candidates={duplicates} checking={checking} />

        {findings.length > 0 || suggestions.length > 0 || aiNote ? (
          <div className="panel">
            <div className="panel__head">
              <h3>Metadata review</h3>
            </div>
            <div className="panel__body" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <div className="register register--observation">
                <div className="register__head">
                  <span className="register__title">Deterministic validation</span>
                </div>
                {findings.length === 0 ? (
                  <p>Every required field is present.</p>
                ) : (
                  <ul>
                    {findings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                )}
              </div>

              {suggestions.length > 0 ? (
                <div className="register register--inference">
                  <div className="register__head">
                    <span className="ai-mark">
                      <IconSparkle style={{ width: 12, height: 12 }} />
                      AI suggestions
                    </span>
                    <span className="unverified">Advisory</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "var(--sp-5)", fontSize: "0.875rem", color: "#3b3080" }}>
                    {suggestions.map((suggestion) => (
                      <li key={suggestion}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {aiNote ? <p className="t-caption">{aiNote}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="notice">
          <IconAlert className="notice__icon" />
          <span>
            Contributions are created as drafts. They stay out of public discovery until a
            named human reviewer records evidence and every publication gate passes.
          </span>
        </div>
      </aside>
    </div>
  );
}
