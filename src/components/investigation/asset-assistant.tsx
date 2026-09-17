"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconArrowRight, IconSparkle } from "@/components/ui/icons";

import { useInvestigation } from "./investigation-provider";

type Capability = "investigate" | "evidence" | "similar" | "run" | "governance";

interface Suggestion {
  label: string;
  capability: Capability;
  /** What the product actually does, shown so nothing looks like generated prose. */
  effect: string;
}

const BASE: Suggestion[] = [
  {
    label: "What changed?",
    capability: "investigate",
    effect: "Opens the investigation and compares this version with the previous published one.",
  },
  {
    label: "Why is this risky?",
    capability: "investigate",
    effect: "Opens the investigation: gate coverage, digests, and the labelled interpretation.",
  },
  {
    label: "Show supporting evidence",
    capability: "evidence",
    effect: "Opens the governance record at the stored evidence for this version.",
  },
  {
    label: "Find similar assets",
    capability: "similar",
    effect: "Runs discovery against this asset's capabilities.",
  },
];

/**
 * A context-docked assistant, not a chat window. Each suggestion routes to a
 * real capability with real data; none of them generate free text.
 */
export function AssetAssistant({
  assetVersionId,
  assetName,
  capability,
  runnable,
}: {
  assetVersionId: string;
  assetName: string;
  capability: string;
  runnable: boolean;
}) {
  const router = useRouter();
  const investigation = useInvestigation();
  const [active, setActive] = useState<Suggestion | null>(null);

  const suggestions: Suggestion[] = runnable
    ? [
        ...BASE,
        {
          label: "Run it on my input",
          capability: "run",
          effect: "Opens the governed run page for this exact version and executor.",
        },
      ]
    : BASE;

  function trigger(suggestion: Suggestion) {
    setActive(suggestion);
    switch (suggestion.capability) {
      case "investigate":
        investigation.open(assetVersionId, assetName);
        return;
      case "evidence":
      case "governance":
        router.push(`/governance/${assetVersionId}`);
        return;
      case "similar":
        router.push(`/discovery?q=${encodeURIComponent(capability)}`);
        return;
      case "run":
        router.push(`/assets/${assetVersionId}/try`);
        return;
    }
  }

  return (
    <div className="card card--pad">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <span className="ai-mark">
          <IconSparkle style={{ width: 12, height: 12 }} />
          AI assistant
        </span>
      </div>
      <p className="t-caption" style={{ marginTop: "var(--sp-2)" }}>
        Context: <strong>{assetName}</strong>
      </p>
      <div className="chips" style={{ marginTop: "var(--sp-4)" }}>
        {suggestions.map((suggestion) => (
          <button
            className="chip"
            type="button"
            key={suggestion.label}
            onClick={() => trigger(suggestion)}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
      {active ? (
        <p
          className="t-caption"
          style={{
            marginTop: "var(--sp-3)",
            paddingTop: "var(--sp-3)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            gap: "var(--sp-2)",
            alignItems: "flex-start",
          }}
          role="status"
        >
          <IconArrowRight style={{ width: 12, height: 12, marginTop: 3, flex: "none" }} />
          {active.effect}
        </p>
      ) : (
        <p
          className="t-caption"
          style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--border-subtle)" }}
        >
          Each suggestion runs a real capability against this asset's persisted records.
          None of them generate free text.
        </p>
      )}
    </div>
  );
}
