"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { DiscoveryResponse } from "@/contracts";
import { InvestigateButton } from "@/components/investigation/investigate-button";
import { AI_FALLBACK_MESSAGE, RANKING_HYBRID, RANKING_RULE_BASED } from "@/components/ui/language";
import {
  IconAlert,
  IconCheck,
  IconDiscovery,
  IconEmpty,
  IconRun,
  IconSparkle,
} from "@/components/ui/icons";

const BAND_SCORE: Record<string, { value: string; tone: string; label: string }> = {
  strong_match: { value: "Strong", tone: "strong", label: "match" },
  possible_match: { value: "Possible", tone: "possible", label: "match" },
  weak_match: { value: "Weak", tone: "", label: "match" },
};

const SUGGESTIONS = [
  "prepare a property operations review brief",
  "draft a resident notice from approved facts",
  "compare two vendor proposals on one basis",
  "check a lease abstract for missing clauses",
];

function displayAssetId(assetId: string): string {
  return assetId
    .replace(/^asset_/, "")
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function ResultSkeleton() {
  return (
    <div className="result" aria-hidden="true">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--text" style={{ width: "92%" }} />
      <div className="skeleton skeleton--text" style={{ width: "74%" }} />
      <div className="skeleton skeleton--text" style={{ width: "40%" }} />
    </div>
  );
}

export function DiscoveryPanel({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [audience, setAudience] = useState("");
  const [domain, setDomain] = useState("");
  const [desiredOutput, setDesiredOutput] = useState("");
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const ranInitial = useRef(false);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function run(searchText: string) {
    const normalizedQuery = searchText.trim();
    if (!normalizedQuery) {
      setError("Tell us what you need help with.");
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);

    const optionalContext = {
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(domain.trim() ? { domain: domain.trim() } : {}),
      ...(desiredOutput.trim() ? { desired_output: desiredOutput.trim() } : {}),
    };

    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: normalizedQuery,
          ...(Object.keys(optionalContext).length > 0
            ? { optional_context: optionalContext }
            : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "Discovery could not be completed. Please try again.";
        throw new Error(message);
      }
      setResult(body as DiscoveryResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Discovery could not be completed. Please try again.",
      );
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (ranInitial.current || initialQuery.trim() === "") return;
    ranInitial.current = true;
    void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(query);
  }

  const matches = result?.status === "matches" ? result.candidates : [];

  return (
    <div>
      <form className="card card--pad" onSubmit={submit} aria-busy={loading}>
        <label className="field">
          <span>What do you need help with?</span>
          <div className="search">
            <IconDiscovery className="search__icon" />
            <input
              className="input"
              id="discovery-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              required
              maxLength={1000}
              placeholder="For example: write a maintenance update for residents"
            />
          </div>
        </label>

        <div
          style={{
            display: "flex",
            gap: "var(--sp-3)",
            marginTop: "var(--sp-4)",
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <label className="field" style={{ flex: "1 1 160px" }}>
            <span className="t-caption">Audience</span>
            <input
              className="input"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              maxLength={200}
              placeholder="Optional"
            />
          </label>
          <label className="field" style={{ flex: "1 1 160px" }}>
            <span className="t-caption">Domain</span>
            <input
              className="input"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              maxLength={200}
              placeholder="Optional"
            />
          </label>
          <label className="field" style={{ flex: "1 1 160px" }}>
            <span className="t-caption">Desired output</span>
            <input
              className="input"
              value={desiredOutput}
              onChange={(event) => setDesiredOutput(event.target.value)}
              maxLength={500}
              placeholder="Optional"
            />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {!result && !loading && !error ? (
        <div style={{ marginTop: "var(--sp-5)" }}>
          <p className="t-label" style={{ marginBottom: "var(--sp-3)" }}>
            Not sure where to start? Try one of these
          </p>
          <div className="chips">
            {SUGGESTIONS.map((suggestion) => (
              <button
                className="chip"
                type="button"
                key={suggestion}
                onClick={() => {
                  setQuery(suggestion);
                  void run(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", marginTop: "var(--sp-5)" }}
          role="status"
          aria-live="polite"
        >
          <p className="t-small">Searching the published catalog…</p>
          <ResultSkeleton />
          <ResultSkeleton />
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--danger" style={{ marginTop: "var(--sp-5)" }} role="alert">
          <IconAlert className="notice__icon" />
          <div>
            <strong>We could not run that search</strong>
            <p style={{ marginTop: 2 }}>{error}</p>
            <button
              className="btn btn--sm btn--secondary"
              type="button"
              style={{ marginTop: "var(--sp-3)" }}
              onClick={() => void run(query)}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <section style={{ marginTop: "var(--sp-6)" }} aria-live="polite">
          <div className="section__head">
            <h2>
              {result.status === "matches"
                ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}`
                : result.status.replaceAll("_", " ")}
            </h2>
            <p>
              {result.mode === "hybrid" && !result.fallback_used
                ? RANKING_HYBRID
                : RANKING_RULE_BASED}
            </p>
          </div>

          {result.fallback_used ? (
            <div className="notice notice--info" style={{ marginBottom: "var(--sp-4)" }}>
              <IconSparkle className="notice__icon" />
              <div>
                <span>{AI_FALLBACK_MESSAGE}</span>
                <button
                  className="btn btn--sm btn--secondary"
                  type="button"
                  style={{ marginTop: "var(--sp-3)" }}
                  onClick={() => void run(query)}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          {result.status === "clarification_required" ? (
            <div className="notice notice--warning">
              <IconAlert className="notice__icon" />
              <div>
                <strong>Can you be a little more specific?</strong>
                <p style={{ marginTop: 2 }}>{result.clarification_question}</p>
              </div>
            </div>
          ) : null}

          {result.status === "guardrail" ? (
            <div className="notice notice--danger">
              <IconAlert className="notice__icon" />
              <div>
                <strong>A person should decide this one</strong>
                <p style={{ marginTop: 2 }}>{result.guardrail.reason}</p>
                <p style={{ marginTop: "var(--sp-2)" }}>{result.guardrail.human_review_point}</p>
              </div>
            </div>
          ) : null}

          {result.status === "no_match" ? (
            <div className="empty">
              <span className="empty__icon">
                <IconEmpty style={{ width: 20, height: 20 }} />
              </span>
              <h3>Nothing covers this yet</h3>
              <p>{result.no_match_reason}</p>
              <p className="t-caption">
                Try different words, or add who it is for. If nothing exists, this is a gap
                worth filling.
              </p>
              <Link className="btn btn--secondary btn--sm" href="/contribute">
                Share a new asset
              </Link>
            </div>
          ) : null}

          {result.status === "matches" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {matches.map((candidate, index) => {
                const band = BAND_SCORE[candidate.match_band] ?? BAND_SCORE.weak_match!;
                const name = displayAssetId(candidate.asset_id);
                return (
                  <article
                    className="result"
                    key={candidate.asset_version_id}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="result__top">
                      <div className={`match match--${band.tone}`}>
                        <span className="match__value">{band.value}</span>
                        <span className="match__label">{band.label}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3>
                          <Link href={`/assets/${candidate.asset_version_id}`}>{name}</Link>
                        </h3>
                        <p className="t-caption" style={{ marginTop: 2 }}>
                          v{candidate.version}
                        </p>
                        <div className="matched-fields" style={{ marginTop: "var(--sp-3)" }}>
                          {candidate.matched_fields.map((field) => (
                            <span className="matched-field" key={field}>
                              <IconCheck style={{ width: 10, height: 10 }} />
                              {field.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <details className="tech">
                      <summary>Why this matched</summary>
                      <div style={{ padding: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
                        <ul className="rationale">
                          {candidate.rationale.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <p className="t-caption" style={{ marginTop: "var(--sp-3)" }}>
                          {candidate.scoring_method}
                        </p>
                      </div>
                    </details>

                    <div className="asset-card__foot">
                      <InvestigateButton
                        assetVersionId={candidate.asset_version_id}
                        assetName={name}
                      />
                      <Link
                        className="btn btn--sm btn--secondary"
                        href={`/assets/${candidate.asset_version_id}`}
                      >
                        View asset
                      </Link>
                      <Link
                        className="btn btn--sm btn--tertiary"
                        href={`/assets/${candidate.asset_version_id}/try`}
                      >
                        <IconRun className="btn__icon" />
                        Try
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
