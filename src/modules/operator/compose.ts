import type {
  OperatorBlock,
  OperatorContext,
  OperatorFact,
  OperatorSuggestion,
  OperatorTone,
} from "@/contracts";
import type { GovernanceGate } from "@/modules/governance";

import { selectSections } from "./knowledge";
import { GROUP_LABEL, type OperatorPayload } from "./tools";

const suggestion = (
  label: string,
  utterance: string,
  hint: string | null = null,
): OperatorSuggestion => ({ label, utterance, hint });

const fact = (
  label: string,
  value: string,
  tone: OperatorTone = "neutral",
  hint: string | null = null,
): OperatorFact => ({ label, value, tone, hint });

const GATE_TONE: Record<GovernanceGate["status"], "pass" | "warn" | "fail" | "info"> = {
  passed: "pass",
  stale: "warn",
  missing: "fail",
  failed: "fail",
  not_required: "info",
};

const SEVERITY_TONE: Record<string, OperatorTone> = {
  critical: "negative",
  warning: "warning",
  info: "positive",
};

function relative(timestamp: string | null, now: Date): string {
  if (timestamp === null) return "never checked";
  const hours = (now.getTime() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "checked within the last hour";
  if (hours < 48) return `checked ${Math.round(hours)} hours ago`;
  return `checked ${Math.round(hours / 24)} days ago`;
}

/**
 * Builds the causal chain behind a readiness outcome. Each link is an
 * observable product fact, in the order the system actually applies them.
 */
function whyChain(
  gates: readonly GovernanceGate[],
  lifecycle: string,
  inCatalogue: boolean,
): { label: string; detail: string; tone: OperatorTone }[] {
  const blocking = gates.filter(
    (gate) =>
      gate.status === "missing" || gate.status === "failed" || gate.status === "stale",
  );
  const chain: { label: string; detail: string; tone: OperatorTone }[] = [
    {
      label: "Content was frozen",
      detail:
        "A subject digest was computed over the exact immutable content of this version.",
      tone: "neutral",
    },
  ];

  const stale = blocking.filter((gate) => gate.status === "stale");
  if (stale.length > 0) {
    chain.push({
      label: "Content changed after the review",
      detail: `${stale.length} check${stale.length === 1 ? " was" : "s were"} collected against a different digest, so ${stale.length === 1 ? "it no longer applies" : "they no longer apply"}.`,
      tone: "warning",
    });
  }

  const missing = blocking.filter(
    (gate) => gate.status === "missing" || gate.status === "failed",
  );
  if (missing.length > 0) {
    chain.push({
      label: `${missing.length} required check${missing.length === 1 ? "" : "s"} not satisfied`,
      detail: missing.map((gate) => gate.label).join(", "),
      tone: "negative",
    });
  }

  if (blocking.length === 0) {
    chain.push({
      label: "Every required check passes on the current digest",
      detail: "The evidence on record was collected against exactly this content.",
      tone: "positive",
    });
  }

  chain.push({
    label: `Lifecycle is ${lifecycle.replaceAll("_", " ")}`,
    detail:
      lifecycle === "deprecated"
        ? "A deprecated version is excluded from the public catalogue and from discovery."
        : lifecycle === "published"
          ? "A published, non-deprecated current version is returned by the catalogue and by discovery."
          : "Only a published version appears in the public catalogue.",
    tone: lifecycle === "published" ? "positive" : "warning",
  });

  chain.push({
    label: inCatalogue ? "Listed in the public catalogue" : "Excluded from public discovery",
    detail: inCatalogue
      ? "People can find and adopt this version today."
      : "Nobody can find this version through browse or search.",
    tone: inCatalogue ? "positive" : "negative",
  });

  return chain;
}

/* ------------------------------------------------------------------ *
 * Payload → blocks.
 * ------------------------------------------------------------------ */

export function composeBlocks(payload: OperatorPayload, now: Date): OperatorBlock[] {
  switch (payload.type) {
    case "search": {
      const { response, cards, query } = payload;
      if (response.status === "guardrail") {
        return [
          {
            kind: "blocked",
            title: "I will not search for that",
            reason: response.guardrail.reason,
            detail: [response.guardrail.human_review_point],
            links: [],
            suggestions: [suggestion("Browse the catalogue", "Give me the marketplace overview")],
          },
        ];
      }
      if (response.status === "clarification_required") {
        return [
          {
            kind: "headline",
            eyebrow: "Needs one more detail",
            title: response.clarification_question,
            detail: `I read "${query}" as ${response.interpreted_intent.intents.length} separate ${response.interpreted_intent.intents.length === 1 ? "request" : "requests"}.`,
            tone: "warning",
          },
        ];
      }
      if (response.status === "no_match" || cards.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "No match",
            title: "Nothing published covers that yet",
            detail:
              response.status === "no_match"
                ? response.no_match_reason
                : "The ranker found no published asset matching those terms.",
            tone: "warning",
          },
          {
            kind: "note",
            text: "If this is a genuine gap, the contribution workflow can turn your work into a reusable asset.",
            tone: "neutral",
          },
        ];
      }
      const strong = cards.filter((card) => (card.trust?.score ?? 0) >= 85).length;
      return [
        {
          kind: "headline",
          eyebrow: `${response.mode.replaceAll("_", " ")} search`,
          title: `${cards.length} published ${cards.length === 1 ? "asset matches" : "assets match"}`,
          detail:
            strong > 0
              ? `${strong} of them ${strong === 1 ? "is" : "are"} ready to use with every required check current.`
              : "None of them currently pass every required check — the badges show what is missing.",
          tone: strong > 0 ? "positive" : "warning",
        },
        {
          kind: "assets",
          title: "Matches",
          caption: `Ranked by ${response.candidates[0]?.scoring_method ?? "the catalogue ranker"}. Matched fields are shown on each card.`,
          items: cards,
        },
        ...(response.fallback_used && response.fallback_reason
          ? [
              {
                kind: "note" as const,
                text: response.fallback_reason,
                tone: "neutral" as const,
              },
            ]
          : []),
      ];
    }

    case "asset": {
      const { snapshot, card, evidence } = payload;
      const version = snapshot.record.asset_version;
      return [
        {
          kind: "headline",
          eyebrow: version.asset_type,
          title: version.name,
          detail: version.summary,
          tone: snapshot.blockingGates.length === 0 ? "positive" : "warning",
        },
        { kind: "assets", title: "Asset", caption: null, items: [card] },
        {
          kind: "facts",
          title: "At a glance",
          items: [
            fact("Owner", version.owner),
            fact("Version", version.version),
            fact(
              "Availability",
              version.availability.replaceAll("_", " "),
              version.availability === "runnable" ? "positive" : "neutral",
            ),
            fact("Lifecycle", version.lifecycle.replaceAll("_", " ")),
            fact(
              "Required checks",
              `${snapshot.trust.passing_gates} of ${snapshot.trust.required_gates} passing`,
              snapshot.blockingGates.length === 0 ? "positive" : "warning",
            ),
            fact("Saved runs", String(snapshot.executions.length)),
            fact("Evidence", relative(snapshot.lastReviewed, now)),
          ],
        },
        ...(evidence.length > 0
          ? [
              {
                kind: "evidence" as const,
                title: "Most recent evidence",
                items: evidence,
                links: [
                  {
                    label: "Full governance record",
                    href: `/governance/${version.asset_version_id}`,
                  },
                ],
              },
            ]
          : []),
      ];
    }

    case "investigation": {
      const { report } = payload;
      const blocks: OperatorBlock[] = [
        {
          kind: "headline",
          eyebrow: `Investigation · ${report.asset_name} ${report.asset_version}`,
          title: report.headline,
          detail: report.subheadline,
          tone: SEVERITY_TONE[report.severity] ?? "neutral",
        },
        {
          kind: "trust",
          asset_version_id: report.asset_version_id,
          name: report.asset_name,
          trust: report.trust,
          blocking_gates: report.trust.dimensions
            .filter((dimension) => dimension.status === "failed")
            .map((dimension) => dimension.label),
          last_reviewed: null,
        },
      ];

      if (report.observations.length > 0) {
        blocks.push({
          kind: "signals",
          title: "What the records show",
          items: report.observations.map((observation) => ({
            label: observation,
            status: report.severity === "info" ? ("pass" as const) : ("warn" as const),
            detail: "Read from persisted records.",
          })),
        });
      }

      // A chain needs at least two links to be a chain. With one signal there
      // is nothing to chain, so the consequence is stated on its own.
      if (report.signals.length >= 2) {
        blocks.push({
          kind: "why",
          question: "What changed",
          chain: report.signals.slice(0, 5).map((signal) => ({
            label: `${signal.label}: ${signal.before} → ${signal.after}`,
            detail: signal.detail,
            tone:
              signal.severity === "critical"
                ? ("negative" as const)
                : signal.severity === "warning"
                  ? ("warning" as const)
                  : ("neutral" as const),
          })),
          conclusion: report.impact,
        });
      } else {
        const only = report.signals[0];
        if (only !== undefined) {
          blocks.push({
            kind: "signals",
            title: "What changed",
            items: [
              {
                label: `${only.label}: ${only.before} → ${only.after}`,
                status: only.severity === "critical" ? "fail" : only.severity === "warning" ? "warn" : "info",
                detail: only.detail,
              },
            ],
          });
        }
        blocks.push({ kind: "note", text: report.impact, tone: "neutral" });
      }

      if (report.evidence.length > 0) {
        blocks.push({
          kind: "evidence",
          title: "Evidence trail",
          items: report.evidence,
          links: [
            {
              label: "Open the governance record",
              href: `/governance/${report.asset_version_id}`,
            },
          ],
        });
      }

      blocks.push({
        kind: "inference",
        text: report.inference,
        recommendation: report.recommendation,
        ai: report.ai,
      });

      blocks.push({
        kind: "sources",
        title: "Signals used",
        signals: [
          { label: "Governance gates", used: true },
          { label: "Evidence records", used: report.evidence.length > 0 },
          { label: "Lifecycle events", used: true },
          { label: "Trust state", used: true },
          { label: "Persisted executions", used: report.signals.some((s) => s.key === "runs") },
        ],
        links: [
          { label: "View evidence", href: `/governance/${report.asset_version_id}` },
          { label: "Open asset", href: `/assets/${report.asset_version_id}` },
        ],
      });

      return blocks;
    }

    case "trust": {
      const { trust, name, blocking, lastReviewed, gates } = payload;
      const required = gates.filter((gate) => gate.status !== "not_required");
      return [
        {
          kind: "headline",
          eyebrow: "Readiness",
          title: `${name} scores ${trust.score} out of 100`,
          detail: `${trust.label}. ${trust.passing_gates} of ${trust.required_gates} required checks pass, and evidence was ${relative(lastReviewed, now)}.`,
          tone:
            trust.band === "strong"
              ? "positive"
              : trust.band === "blocked"
                ? "negative"
                : "warning",
        },
        {
          kind: "trust",
          asset_version_id: payload.assetVersionId,
          name,
          trust,
          blocking_gates: blocking,
          last_reviewed: lastReviewed,
        },
        ...(required.length === 0
          ? []
          : [
              {
                kind: "signals" as const,
                title: "Every point traces to a gate",
                items: required.map((gate) => ({
                  label: gate.label,
                  status: GATE_TONE[gate.status],
                  detail: gate.message,
                })),
              },
            ]),
      ];
    }

    case "evidence": {
      const { items, name, total, assetVersionId } = payload;
      if (items.length === 0) {
        return [
          {
            kind: "blocked",
            title: `No evidence is recorded for ${name}`,
            reason: "This version has no evidence records at all, so no required check can pass.",
            detail: ["Evidence must be collected against the exact frozen content."],
            links: [{ label: "Governance record", href: `/governance/${assetVersionId}` }],
            suggestions: [
              suggestion("Run the checks", "Run the governance checks", "Appends real validation evidence."),
            ],
          },
        ];
      }
      const current = items.filter((item) => item.digest_matches_current).length;
      return [
        {
          kind: "headline",
          eyebrow: "Evidence",
          title: `${total} evidence ${total === 1 ? "record" : "records"} for ${name}`,
          detail: `${current} of the ${items.length} shown were collected against the content published today. Evidence collected against different content cannot satisfy a check.`,
          tone: current === items.length ? "positive" : "warning",
        },
        {
          kind: "evidence",
          title: "Records",
          items,
          links: [{ label: "Full governance record", href: `/governance/${assetVersionId}` }],
        },
      ];
    }

    case "lifecycle": {
      const { snapshot, name, assetVersionId } = payload;
      const events = snapshot.events.map((event) => ({
        title: `${event.from_state ? `${event.from_state.replaceAll("_", " ")} → ` : ""}${event.to_state.replaceAll("_", " ")}`,
        detail: event.reason,
        timestamp: event.timestamp,
        actor: event.actor_name ?? null,
        tone:
          event.to_state === "published"
            ? ("positive" as const)
            : event.to_state === "deprecated"
              ? ("negative" as const)
              : ("neutral" as const),
      }));
      const evidence = snapshot.projection.evidence.slice(0, 6).map((assessment) => ({
        title: `${assessment.evidence.evidence_type.replaceAll("_", " ")} — ${assessment.label.toLowerCase()}`,
        detail: assessment.evidence.details.summary,
        timestamp: assessment.evidence.timestamp,
        actor: assessment.evidence.reviewer?.name ?? assessment.evidence.actor_name ?? null,
        tone:
          assessment.state === "passed"
            ? ("positive" as const)
            : assessment.state === "failed"
              ? ("negative" as const)
              : ("warning" as const),
      }));
      const items = [...events, ...evidence].sort((left, right) =>
        right.timestamp.localeCompare(left.timestamp),
      );
      if (items.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "Timeline",
            title: `Nothing has been recorded for ${name} yet`,
            detail: "No lifecycle events and no evidence exist for this version.",
            tone: "warning",
          },
        ];
      }
      return [
        {
          kind: "headline",
          eyebrow: "Timeline",
          title: `${items.length} recorded ${items.length === 1 ? "moment" : "moments"} for ${name}`,
          detail: `${events.length} lifecycle ${events.length === 1 ? "event" : "events"} and ${evidence.length} evidence ${evidence.length === 1 ? "record" : "records"}, newest first.`,
          tone: "neutral",
        },
        { kind: "timeline", title: "What happened", items },
        {
          kind: "sources",
          title: "Signals used",
          signals: [
            { label: "Lifecycle events", used: events.length > 0 },
            { label: "Evidence records", used: evidence.length > 0 },
          ],
          links: [{ label: "Governance record", href: `/governance/${assetVersionId}` }],
        },
      ];
    }

    case "governance": {
      const { projection, name, lifecycle, trust, assetVersionId } = payload;
      const required = projection.gates.filter((gate) => gate.status !== "not_required");
      const blocking = required.filter((gate) => gate.status !== "passed");
      const inCatalogue = lifecycle === "published";
      const blocks: OperatorBlock[] = [
        {
          kind: "headline",
          eyebrow: "Governance",
          title: projection.canPublish
            ? `${name} passes every required check`
            : `${blocking.length} required ${blocking.length === 1 ? "check is" : "checks are"} blocking ${name}`,
          detail: `${required.length - blocking.length} of ${required.length} required checks pass. Review status: ${projection.reviewStatusLabel.toLowerCase()}.`,
          tone: projection.canPublish ? "positive" : "warning",
        },
        ...(required.length === 0
          ? []
          : [
              {
                kind: "signals" as const,
                title: "Required checks",
                items: required.map((gate) => ({
                  label: gate.label,
                  status: GATE_TONE[gate.status],
                  detail: gate.message,
                })),
              },
            ]),
      ];
      if (blocking.length > 0) {
        blocks.push({
          kind: "why",
          question: `Why ${name} cannot be published as it stands`,
          chain: whyChain(projection.gates, lifecycle, inCatalogue),
          conclusion: `Publication is refused by the governance service until every required gate passes. Readiness currently reads ${trust.score} out of 100.`,
        });
      }
      blocks.push({
        kind: "sources",
        title: "Signals used",
        signals: [
          { label: "Governance gates", used: true },
          { label: "Evidence records", used: projection.evidence.length > 0 },
          { label: "Executor allowlist", used: required.some((gate) => gate.key === "executor_binding") },
          { label: "Persisted executions", used: required.some((gate) => gate.key === "functional_test") },
        ],
        links: [
          { label: "Governance record", href: `/governance/${assetVersionId}` },
          { label: "Open asset", href: `/assets/${assetVersionId}` },
        ],
      });
      return blocks;
    }

    case "queue": {
      const { items, counts } = payload;
      if (items.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "Review queue",
            title: "Nothing is waiting for review",
            detail: "Every version on record has already been published or retired.",
            tone: "positive",
          },
        ];
      }
      const ready = items.filter((item) => item.canPublish).length;
      return [
        {
          kind: "headline",
          eyebrow: "Review queue",
          title: `${items.length} ${items.length === 1 ? "version is" : "versions are"} not published yet`,
          detail:
            ready > 0
              ? `${ready} of them pass every required check and are waiting only on a reviewer.`
              : "None of them pass every required check yet, so none can be published as they stand.",
          tone: ready > 0 ? "positive" : "warning",
        },
        {
          kind: "facts",
          title: "By lifecycle state",
          items: [
            fact("Draft", String(counts.draft)),
            fact("Submitted", String(counts.submitted)),
            fact("In review", String(counts.in_review), counts.in_review > 0 ? "brand" : "neutral"),
            fact(
              "Changes requested",
              String(counts.changes_requested),
              counts.changes_requested > 0 ? "warning" : "neutral",
            ),
          ],
        },
        {
          kind: "assets",
          title: "Waiting",
          caption:
            "Each card shows the lifecycle state and how many required checks are still outstanding.",
          items: items.map((item) => item.card),
        },
      ];
    }

    case "impact_graph": {
      const { graph, name } = payload;
      return [
        {
          kind: "headline",
          eyebrow: "Impact",
          title: `${graph.nodes.length - 1} records are connected to ${name}`,
          detail: graph.summary,
          tone: graph.affected_count > 0 ? "warning" : "neutral",
        },
        { kind: "graph", graph },
        {
          kind: "note",
          text: "Only relationships that are actually persisted are drawn. Nothing here is inferred.",
          tone: "neutral",
        },
      ];
    }

    case "alternatives": {
      const { result, subjectName } = payload;
      if (result.alternatives.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "Alternatives",
            title: `Nothing published covers the same job as ${subjectName}`,
            detail: result.observation,
            tone: "warning",
          },
        ];
      }
      const safer = result.alternatives.filter((item) => item.safer).length;
      return [
        {
          kind: "headline",
          eyebrow: "Alternatives",
          title: `${result.alternatives.length} published ${result.alternatives.length === 1 ? "asset covers" : "assets cover"} similar ground`,
          detail:
            safer > 0
              ? `${safer} of them score higher on readiness than ${subjectName} does today.`
              : `None of them score higher on readiness than ${subjectName}.`,
          tone: safer > 0 ? "positive" : "warning",
        },
        { kind: "alternatives", result, subject_name: subjectName },
        { kind: "note", text: result.observation, tone: "neutral" },
      ];
    }

    case "comparison": {
      const { comparison } = payload;
      return [
        {
          kind: "headline",
          eyebrow: "Comparison",
          title: `${comparison.differing_rows} of ${comparison.rows.length} attributes differ`,
          detail: comparison.observation,
          tone: "neutral",
        },
        { kind: "comparison", comparison },
        {
          kind: "note",
          text: "This shows what each asset holds today. It does not pick a winner — the right choice depends on what you need it for.",
          tone: "neutral",
        },
      ];
    }

    case "reuse": {
      const { reuse, name } = payload;
      const blocks: OperatorBlock[] = [
        {
          kind: "headline",
          eyebrow: "Reuse",
          title:
            reuse.total === 0
              ? `${name} has no saved runs`
              : `${name} has been run ${reuse.total} ${reuse.total === 1 ? "time" : "times"}`,
          detail: reuse.observation,
          tone: reuse.total === 0 ? "neutral" : "positive",
        },
        { kind: "reuse", name, reuse },
      ];
      if (reuse.scenarios.length > 0) {
        blocks.push({
          kind: "chart",
          title: "Runs by scenario",
          question: "Counted from persisted execution records, not from page views.",
          variant: "bar",
          caption: `${reuse.total} saved runs across ${reuse.distinct_scenarios} scenario${reuse.distinct_scenarios === 1 ? "" : "s"}.`,
          table_label: "Scenario",
          value_label: "Runs",
          data: reuse.scenarios.map((scenario) => ({
            label: scenario.label,
            value: scenario.runs,
            tone: "brand" as const,
            note: `${scenario.succeeded} succeeded`,
          })),
        });
      }
      if (reuse.not_recorded.length > 0) {
        blocks.push({
          kind: "note",
          text: `Not recorded by this prototype: ${reuse.not_recorded.join("; ")}.`,
          tone: "neutral",
        });
      }
      return blocks;
    }

    case "drift": {
      const { drift } = payload;
      if (drift.entries.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "Trust drift",
            title: "Nothing has slipped since its last check",
            detail: `All ${drift.scanned} published assets have current checks covering the content people receive.`,
            tone: "positive",
          },
          { kind: "note", text: drift.method, tone: "neutral" },
        ];
      }
      return [
        {
          kind: "headline",
          eyebrow: "Trust drift",
          title: `${drift.entries.length} of ${drift.scanned} published ${drift.entries.length === 1 ? "asset has" : "assets have"} drifted`,
          detail:
            "These were fine when last checked. Something changed since, so a check should be redone before anyone relies on them.",
          tone: "warning",
        },
        { kind: "drift", drift },
        {
          kind: "chart",
          title: "How far each one moved",
          question: "Readiness at the last recorded point against readiness today.",
          variant: "bar",
          caption: "Points lost since the newest evidence was collected.",
          table_label: "Asset",
          value_label: "Points lost",
          data: drift.entries.map((entry) => ({
            label: entry.name,
            value: Math.abs(entry.delta),
            tone:
              entry.severity === "critical"
                ? ("negative" as const)
                : ("warning" as const),
            note: `${entry.from_score} → ${entry.to_score}`,
          })),
        },
        { kind: "note", text: drift.method, tone: "neutral" },
      ];
    }

    case "overview": {
      const { metrics, state } = payload;
      const blocks: OperatorBlock[] = [
        {
          kind: "headline",
          eyebrow: "Marketplace",
          title: `${metrics.published} published ${metrics.published === 1 ? "asset" : "assets"}, ${state.ready_to_use} ready to use`,
          detail: `${state.runnable} can be run here, ${state.needs_attention} have an incomplete required check, and ${state.executions} runs are saved across the catalogue.`,
          tone: state.needs_attention === 0 ? "positive" : "warning",
        },
        {
          kind: "facts",
          title: "Counted from persisted records",
          items: [
            fact("Published", String(state.published), "brand"),
            fact("Ready to use", String(state.ready_to_use), "positive"),
            fact("Runnable here", String(state.runnable)),
            fact(
              "Need attention",
              String(state.needs_attention),
              state.needs_attention > 0 ? "warning" : "positive",
            ),
            fact("In review", String(state.in_review)),
            fact("Drafts", String(state.drafts)),
            fact("Deprecated", String(state.deprecated)),
            fact("Evidence records", String(state.evidence_records)),
            fact("Saved runs", String(state.executions)),
          ],
        },
        ...(metrics.trust_bands.length === 0 ? [] : [{
          kind: "chart" as const,
          title: "How ready are the published assets?",
          question: "A higher score means less for you to check yourself.",
          variant: "bar" as const,
          caption: "Assets grouped by readiness band.",
          table_label: "Band",
          value_label: "Assets",
          data: metrics.trust_bands.map((bucket) => ({
            label: bucket.label,
            value: bucket.value,
            tone: bucket.tone,
            note: null,
          })),
        }]),
        ...(metrics.gate_health.length === 0 ? [] : [{
          kind: "chart" as const,
          title: "Where do checks get stuck?",
          question: "Every required check across every published asset.",
          variant: "stacked" as const,
          caption: "Required checks by status.",
          table_label: "Status",
          value_label: "Checks",
          data: metrics.gate_health.map((bucket) => ({
            label: bucket.label,
            value: bucket.value,
            tone: bucket.tone,
            note: null,
          })),
        }]),
      ];
      if (metrics.usage.length > 0) {
        blocks.push({
          kind: "chart",
          title: "Which assets do people actually use?",
          question: "Counted from saved runs, so it reflects real use rather than page views.",
          variant: "bar",
          caption: `${metrics.total_runs} saved runs across the catalogue.`,
          table_label: "Asset",
          value_label: "Times run",
          data: metrics.usage.map((item) => ({
            label: item.name,
            value: item.runs,
            tone: "brand" as const,
            note: `${item.succeeded} succeeded`,
          })),
        });
      }
      return blocks;
    }

    case "executions": {
      const { records, name, assetVersionId } = payload;
      if (records.length === 0) {
        return [
          {
            kind: "headline",
            eyebrow: "Runs",
            title: `${name} has no saved runs`,
            detail: "No execution record exists for this version.",
            tone: "neutral",
          },
        ];
      }
      const succeeded = records.filter((record) => record.status === "succeeded").length;
      return [
        {
          kind: "headline",
          eyebrow: "Runs",
          title: `${records.length} saved ${records.length === 1 ? "run" : "runs"} of ${name}`,
          detail: `${succeeded} succeeded. Every record carries its own execution ID, the frozen version, and the definition digest.`,
          tone: succeeded === records.length ? "positive" : "warning",
        },
        {
          kind: "timeline",
          title: "Execution records",
          items: records.map((record) => ({
            title: `${record.status} — ${record.scenario_label ?? "no scenario label"}`,
            detail: `${record.execution_id} · ${record.purpose.replaceAll("_", " ")} · ${record.execution_mode}`,
            timestamp: record.started_at,
            actor: record.executor_key ?? null,
            tone:
              record.status === "succeeded"
                ? ("positive" as const)
                : record.status === "blocked" || record.status === "invalid"
                  ? ("warning" as const)
                  : ("negative" as const),
          })),
        },
        {
          kind: "sources",
          title: "Signals used",
          signals: [{ label: "Persisted execution records", used: true }],
          links: [{ label: "Open the run page", href: `/assets/${assetVersionId}/try` }],
        },
      ];
    }

    case "execution": {
      const { record, name } = payload;
      const succeeded = record.status === "succeeded";
      return [
        {
          kind: "headline",
          eyebrow: "Run",
          title: `${record.execution_id} — ${record.status}`,
          detail:
            record.rejection_reason ??
            record.error?.message ??
            `${name} ${record.asset_version}, ${record.purpose.replaceAll("_", " ")}.`,
          tone: succeeded ? "positive" : "warning",
        },
        {
          kind: "facts",
          title: "Provenance",
          items: [
            fact("Status", record.status, succeeded ? "positive" : "negative"),
            fact("Asset version", record.asset_version),
            fact("Executor", record.executor_key ?? "not resolved"),
            fact("Definition digest", record.definition_digest ?? "not resolved"),
            fact("Mode", record.execution_mode),
            fact("Started", record.started_at),
            fact("Completed", record.completed_at ?? "not completed"),
          ],
        },
      ];
    }

    case "agents": {
      const { items, title } = payload;
      return [
        {
          kind: "headline",
          eyebrow: "Agent Explorer",
          title:
            items.length === 1
              ? items[0]!.name
              : `${items.length} agents run in this system`,
          detail:
            items.length === 1
              ? items[0]!.purpose
              : "Each one has a bounded purpose, a declared authority limit, and a deterministic fallback.",
          tone: "ai",
        },
        { kind: "agents", title, items },
      ];
    }

    case "knowledge": {
      const { knowledge, topic } = payload;
      const sections = selectSections(knowledge, topic);
      return [
        {
          kind: "headline",
          eyebrow: "Project knowledge",
          title: sections.length === 1 ? sections[0]!.heading : "How this product works",
          detail: knowledge.summary,
          tone: "brand",
        },
        {
          kind: "knowledge",
          title: "Generated from the implementation",
          summary:
            "Every enumeration, weight, threshold, and transition below is read from the module that implements it.",
          sections,
        },
      ];
    }

    case "capabilities": {
      const { tools } = payload;
      const groups = (Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[])
        .map((group) => ({
          group,
          label: GROUP_LABEL[group],
          tools: tools.filter((tool) => tool.group === group),
        }))
        .filter((entry) => entry.tools.length > 0);
      const writes = tools.filter((tool) => tool.kind === "write").length;
      return [
        {
          kind: "headline",
          eyebrow: "Capabilities",
          title: `${tools.length} actions, ${writes} of which need your confirmation`,
          detail:
            "Reads run straight away. Anything that changes state shows you a preview first and waits for you to approve it.",
          tone: "brand",
        },
        { kind: "capabilities", title: "Tool catalogue", groups },
      ];
    }

    case "action": {
      return [{ kind: "action_preview", action: payload.action }];
    }

    case "contribution": {
      const { draft, duplicates, aiAssisted, aiNote } = payload;
      const checks = [
        {
          label: "Name and summary",
          status: "pass" as const,
          detail: `"${draft.name}" — ${draft.summary}`,
        },
        {
          label: "What it does",
          status: draft.capabilities.length > 0 ? ("pass" as const) : ("fail" as const),
          detail:
            draft.capabilities.length > 0
              ? draft.capabilities.join(", ")
              : "No capabilities described.",
        },
        {
          label: "Use cases",
          status: draft.use_cases.length > 0 ? ("pass" as const) : ("fail" as const),
          detail:
            draft.use_cases.length > 0 ? draft.use_cases.join("; ") : "No use cases given.",
        },
        {
          label: "Limitations stated",
          status: draft.limitations.length > 0 ? ("pass" as const) : ("warn" as const),
          detail: draft.limitations.join("; "),
        },
        {
          label: "Version defined",
          status: "pass" as const,
          detail: `${draft.version}, created as a non-runnable draft.`,
        },
        {
          label: "Evidence attached",
          status: "warn" as const,
          detail:
            "None yet. A draft carries no evidence until the checks are run against its frozen content.",
        },
        {
          label: "Human review",
          status: "warn" as const,
          detail: "Required before publication. A person decides, not the operator.",
        },
      ];
      const passing = checks.filter((check) => check.status === "pass").length;
      return [
        {
          kind: "headline",
          eyebrow: "New contribution",
          title: draft.name,
          detail: `${passing} of ${checks.length} readiness checks are already satisfied. Nothing has been created yet.`,
          tone: "ai",
        },
        {
          kind: "contribution",
          title: "Draft metadata",
          draft,
          checks,
          passing,
          total: checks.length,
          duplicates,
          ai_assisted: aiAssisted,
        },
        ...(duplicates.length > 0
          ? [
              {
                kind: "assets" as const,
                title: "Already in the catalogue",
                caption:
                  "These published assets overlap with what you described. Reusing one is usually faster than building another.",
                items: duplicates,
              },
            ]
          : []),
        ...(aiNote !== null
          ? [{ kind: "note" as const, text: aiNote, tone: "neutral" as const }]
          : []),
      ];
    }

    case "completed": {
      return [
        {
          kind: "completion",
          title: payload.title,
          detail: payload.detail,
          asset_version_id: payload.assetVersionId,
          facts: payload.facts,
          verified: payload.verified,
          links: payload.links,
        },
      ];
    }

    case "blocked": {
      return [
        {
          kind: "blocked",
          title: payload.title,
          reason: payload.reason,
          detail: payload.detail,
          links: payload.links,
          suggestions: [],
        },
      ];
    }
  }
}

/* ------------------------------------------------------------------ *
 * What to offer next. Suggestions are always real capabilities.
 * ------------------------------------------------------------------ */

export function suggestionsFor(
  payload: OperatorPayload,
  context: OperatorContext,
): OperatorSuggestion[] {
  const named = (name: string) => `"${name}"`;

  switch (payload.type) {
    case "search": {
      const first = payload.cards[0];
      if (first === undefined) {
        return [
          suggestion("Show the whole catalogue", "Give me the marketplace overview"),
          suggestion("Contribute this instead", "I want to contribute a new asset"),
        ];
      }
      return [
        suggestion(`Why is ${first.name} suited?`, `Investigate ${named(first.name)}`),
        suggestion("Compare the top two", `Compare ${named(first.name)} and ${named(payload.cards[1]?.name ?? first.name)}`),
        suggestion("Find an alternative", `Find an alternative to ${named(first.name)}`),
      ];
    }
    case "asset": {
      const name = payload.snapshot.record.asset_version.name;
      const runnable = payload.snapshot.record.asset_version.availability === "runnable";
      return [
        suggestion("Investigate it", `Investigate ${named(name)}`),
        suggestion("Show the evidence", `Show the evidence behind ${named(name)}`),
        suggestion("Who would be affected?", `Who could be affected by ${named(name)}?`),
        ...(runnable ? [suggestion("Run it", `Run ${named(name)}`)] : []),
      ];
    }
    case "investigation": {
      const name = payload.report.asset_name;
      return [
        suggestion("Show the evidence", `Show the evidence behind ${named(name)}`),
        suggestion("Who would be affected?", `Who could be affected by ${named(name)}?`),
        suggestion("Find an alternative", `Find an alternative to ${named(name)}`),
        suggestion("What if I flag it?", `What happens if I flag ${named(name)}?`),
      ];
    }
    case "trust":
    case "evidence":
    case "governance": {
      const name = "name" in payload ? payload.name : (context.asset_name ?? "this asset");
      return [
        suggestion("Investigate it", `Investigate ${named(name)}`),
        suggestion("Run the checks again", `Run the governance checks on ${named(name)}`),
        suggestion("Find an alternative", `Find an alternative to ${named(name)}`),
      ];
    }
    case "queue": {
      const first = payload.items[0];
      return first === undefined
        ? [suggestion("Marketplace overview", "Give me the marketplace overview")]
        : [
            suggestion(`Check ${first.card.name}`, `What is blocking ${JSON.stringify(first.card.name)}?`),
            suggestion("Contribute something", "I want to contribute a new asset"),
          ];
    }
    case "lifecycle":
      return [
        suggestion("Investigate it", `Investigate ${named(payload.name)}`),
        suggestion("Show the evidence", `Show the evidence behind ${named(payload.name)}`),
      ];
    case "impact_graph":
      return [
        suggestion("Find an alternative", `Find an alternative to ${named(payload.name)}`),
        suggestion("What if I flag it?", `What happens if I flag ${named(payload.name)}?`),
        suggestion("Compare it", `Compare ${named(payload.name)} with its closest alternative`),
      ];
    case "alternatives": {
      const first = payload.result.alternatives[0];
      return [
        ...(first
          ? [
              suggestion("Compare them", `Compare ${named(payload.subjectName)} and ${named(first.name)}`),
              suggestion(
                "What if I switch?",
                `What happens if I flag ${named(payload.subjectName)}?`,
              ),
            ]
          : []),
        suggestion("Investigate the original", `Investigate ${named(payload.subjectName)}`),
      ];
    }
    case "comparison": {
      const [first, second] = payload.comparison.subjects;
      return [
        ...(first ? [suggestion(`Investigate ${first.name}`, `Investigate ${named(first.name)}`)] : []),
        ...(second ? [suggestion(`Investigate ${second.name}`, `Investigate ${named(second.name)}`)] : []),
      ];
    }
    case "reuse":
      return [
        suggestion("Investigate it", `Investigate ${named(payload.name)}`),
        suggestion("See the runs", `Show the execution history for ${named(payload.name)}`),
      ];
    case "drift": {
      const first = payload.drift.entries[0];
      return first === undefined
        ? [suggestion("Marketplace overview", "Give me the marketplace overview")]
        : [
            suggestion("Investigate the biggest change", `Investigate ${named(first.name)}`),
            suggestion("Find an alternative", `Find an alternative to ${named(first.name)}`),
            suggestion("What if I flag it?", `What happens if I flag ${named(first.name)}?`),
          ];
    }
    case "overview":
      return [
        suggestion("What has drifted?", "Which assets have changed trust recently?"),
        suggestion("What needs attention?", "What is blocking publication right now?"),
        suggestion("Explain this project", "Explain this project"),
      ];
    case "executions":
    case "execution":
      return [
        suggestion("How often is it used?", `How often is ${named(payload.name)} used?`),
        suggestion("Investigate it", `Investigate ${named(payload.name)}`),
      ];
    case "agents":
      return [
        suggestion("What can you do?", "What actions can I perform?"),
        suggestion("Explain this project", "Explain this project"),
      ];
    case "knowledge":
      return [
        suggestion("How does trust work?", "How does trust work?"),
        suggestion("Explain the lifecycle", "Explain the complete lifecycle of an asset"),
        suggestion("What can you do?", "What actions can I perform?"),
      ];
    case "capabilities":
      return [
        suggestion("Explain this project", "Explain this project"),
        suggestion("What agents exist?", "What agents are available?"),
      ];
    case "contribution":
      return [
        suggestion("Create it", "Create it"),
        suggestion("Check the catalogue first", `Find ${payload.draft.capabilities[0] ?? payload.draft.name}`),
      ];
    case "action":
      return payload.action.available
        ? []
        : [suggestion("What is blocking it?", "What is blocking publication?")];
    case "completed":
      return [
        suggestion("What changed?", "Give me the marketplace overview"),
        ...(context.asset_name
          ? [suggestion("Investigate it", `Investigate ${named(context.asset_name)}`)]
          : []),
      ];
    case "blocked":
      return [
        suggestion("Show the catalogue", "Give me the marketplace overview"),
        suggestion("What can you do?", "What actions can I perform?"),
      ];
  }
}
