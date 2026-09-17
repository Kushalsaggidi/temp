import type { AgentProfile } from "@/contracts";
import { GEMINI_DISCOVERY_MODEL } from "@/modules/discovery/adapter";
import { METADATA_ASSISTANCE_MODEL } from "@/modules/governance/metadata-ai";
import { INVESTIGATION_MODEL } from "@/modules/investigation/ai";

import { OPERATOR_MODEL } from "./ai";

/**
 * Every agent that actually exists in this repository, described from its own
 * implementation. Nothing here is aspirational: each entry names the module
 * that runs it, the model it may call, and what it is allowed to decide.
 *
 * "Agent" in this product means a bounded capability with its own inputs,
 * outputs, and authority limit — not an autonomous actor. Three of the five
 * call a model; all five degrade to a deterministic path.
 */
export const AGENTS: readonly AgentProfile[] = [
  {
    key: "operator",
    name: "AI Operator",
    purpose:
      "Turns a natural-language request into one of the marketplace's own capabilities, then composes the answer from the data that capability returned.",
    implementation: "src/modules/operator/ (service, router, tools)",
    model_or_config: OPERATOR_MODEL,
    deterministic_fallback:
      "A pattern router selects the tool when the model is disabled or unreachable. Tool results are identical either way.",
    capabilities: [
      "Route a request to one of the registered tools",
      "Resolve 'this asset' from the page you are on",
      "Build a multi-step plan before anything runs",
      "Show an action preview for every state change",
      "Re-read persisted state after a write and report what actually changed",
    ],
    inputs: [
      "Your request in plain language",
      "The surface and entity you are currently viewing",
      "The registered tool catalogue",
    ],
    outputs: [
      "A visual answer assembled from tool results",
      "An action plan when the request needs several steps",
      "An action preview plus a verified completion for writes",
    ],
    authority: [
      "Reads run directly",
      "Writes require an explicit human approval every time",
      "It cannot issue database queries or invent a governance fact",
    ],
    tools: ["every registered tool"],
    actions: [
      {
        label: "What can you actually do?",
        utterance: "What actions can I perform?",
        hint: "Lists the tool catalogue with read and write classification.",
      },
      {
        label: "Explain this project",
        utterance: "Explain this project",
        hint: "Project knowledge generated from the implementation.",
      },
    ],
  },
  {
    key: "investigator",
    name: "Asset Investigator",
    purpose:
      "Explains whether the checks on record actually cover the version people receive today, separating deterministic fact from model interpretation.",
    implementation: "src/modules/investigation/ (service, trust, ai)",
    model_or_config: INVESTIGATION_MODEL,
    deterministic_fallback:
      "A deterministic interpretation is written from the same observations when the model is unavailable, and is labelled as such.",
    capabilities: [
      "Inspect digest-bound evidence",
      "Compare the current version against the previous published one",
      "Derive the readiness score from governance gates",
      "List the fields that changed after the last review",
      "Recommend an action a human must approve",
    ],
    inputs: [
      "Asset version record",
      "Evidence records",
      "Lifecycle events",
      "Persisted executions",
      "Governance projection",
    ],
    outputs: [
      "Observations (deterministic)",
      "One inference and one recommendation (model, labelled unverified)",
      "Evidence trail and recommended actions",
    ],
    authority: [
      "It can never add, alter, or assert a governance fact",
      "It cannot change lifecycle state; it proposes an action a reviewer confirms",
    ],
    tools: ["investigateAsset", "getTrust", "getEvidence", "getLifecycle", "getImpact"],
    actions: [
      {
        label: "Investigate the weakest asset",
        utterance: "Investigate the asset that needs the most attention",
        hint: "Runs the real investigation against persisted records.",
      },
      {
        label: "Why is trust lower than before?",
        utterance: "Which assets have changed trust recently?",
        hint: "Reads the drift detector.",
      },
    ],
  },
  {
    key: "discovery",
    name: "Discovery Agent",
    purpose:
      "Finds published assets that match a described job, showing which canonical fields matched and why.",
    implementation: "src/modules/discovery/ (normalization, retrieval, ranking, adapter)",
    model_or_config: GEMINI_DISCOVERY_MODEL,
    deterministic_fallback:
      "Deterministic hybrid ranking over canonical catalogue fields. The model only adds conservative synonyms and is visibly labelled when used.",
    capabilities: [
      "Normalise a request into an interpreted intent",
      "Rank published versions by field-level evidence",
      "Ask for clarification when a request carries several intents",
      "Refuse out-of-scope requests through a guardrail",
    ],
    inputs: ["Query text", "Optional audience, domain, desired output, constraints"],
    outputs: [
      "Ranked candidates with matched fields and rationale",
      "Clarification question, no-match reason, or guardrail outcome",
    ],
    authority: [
      "It can add search terms only",
      "It cannot introduce a catalogue fact, permission, or lifecycle state",
    ],
    tools: ["searchAssets", "findAlternatives"],
    actions: [
      {
        label: "Find a reconciliation asset",
        utterance: "Find me a trustworthy property operations asset",
        hint: "Runs the real discovery ranker over published versions.",
      },
    ],
  },
  {
    key: "contribution",
    name: "Contribution Assistant",
    purpose:
      "Checks a proposed contribution against the published catalogue for overlap and reports which required metadata fields are still missing.",
    implementation:
      "src/modules/governance/metadata-assistance.ts and the duplicate-check route",
    model_or_config: METADATA_ASSISTANCE_MODEL,
    deterministic_fallback:
      "Deterministic required-field validation plus the same ranker discovery uses for the overlap check.",
    capabilities: [
      "Detect published assets that already cover the same job",
      "List missing or empty required metadata fields",
      "Suggest metadata improvements",
    ],
    inputs: ["Draft contribution metadata"],
    outputs: ["Overlap candidates", "Deterministic findings", "Suggestions"],
    authority: [
      "It cannot approve, publish, or score anything",
      "Its overlap report is advisory and never blocks a contribution",
    ],
    tools: ["createAsset", "updateAsset"],
    actions: [
      {
        label: "Start a contribution",
        utterance: "I want to contribute a fraud detection agent",
        hint: "Opens the guided contribution workflow.",
      },
    ],
  },
  {
    key: "impact",
    name: "Impact Analyst",
    purpose:
      "Shows what a state change would touch before it happens, and which persisted records relate to an asset.",
    implementation: "src/modules/insights/ (impact, graph, analysis)",
    model_or_config: null,
    deterministic_fallback:
      "Fully deterministic. It projects persisted relationships and gate state; it calls no model at all.",
    capabilities: [
      "Preview the result of publish, flag, submit, or re-check",
      "Build the dependency and provenance graph",
      "Rank alternatives by the discovery ranker and compare them factually",
      "Detect trust drift from recorded state transitions",
    ],
    inputs: [
      "Asset version record",
      "Evidence and execution records",
      "Governance projection",
      "Published catalogue",
    ],
    outputs: [
      "Impact preview with current and resulting state",
      "Impact graph",
      "Alternatives, comparison, reuse intelligence, and drift",
    ],
    authority: [
      "It only describes; it performs no transition",
      "It never reports a relationship that is not persisted",
    ],
    tools: [
      "getImpact",
      "findAlternatives",
      "compareAssets",
      "getReuseIntelligence",
      "getTrustDrift",
    ],
    actions: [
      {
        label: "Who would be affected?",
        utterance: "Who could be affected by this asset?",
        hint: "Builds the impact graph from persisted relationships.",
      },
      {
        label: "Preview flagging this",
        utterance: "What happens if I flag this asset?",
        hint: "Reuses the existing Impact Preview.",
      },
    ],
  },
];

export function findAgent(reference: string): AgentProfile | null {
  const normalized = reference.toLowerCase();
  return (
    AGENTS.find(
      (agent) =>
        normalized.includes(agent.key) ||
        normalized.includes(agent.name.toLowerCase()),
    ) ?? null
  );
}
