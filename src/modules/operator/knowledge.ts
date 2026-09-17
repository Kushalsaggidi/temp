import {
  AssetTypeSchema,
  AvailabilitySchema,
  EvidenceResultSchema,
  EvidenceTypeSchema,
  ExecutionKindSchema,
  ExecutionStatusSchema,
  LifecycleStateSchema,
  type KnowledgeSection,
  type OperatorFact,
} from "@/contracts";
import { serverExecutorRegistry } from "@/modules/execution";
import { ALLOWED_TRANSITIONS, buildGovernanceProjection } from "@/modules/governance";
import { GovernanceRepository } from "@/modules/governance/repository";
import { ExecutionRepository } from "@/modules/execution";
import {
  FRESHNESS_ATTENTION_HOURS,
  GATE_WEIGHTS,
  STATUS_FACTOR,
  TRUST_BANDS,
} from "@/modules/investigation";
import type { MarketplaceDatabase } from "@/server/db/connection";

import { AGENTS } from "./agents";
import { GROUP_LABEL, TOOLS } from "./tools";
import { isCurrentPublished } from "./state";

export interface ProjectKnowledge {
  summary: string;
  sections: KnowledgeSection[];
}

const fact = (
  label: string,
  value: string,
  tone: OperatorFact["tone"] = "neutral",
  hint: string | null = null,
): OperatorFact => ({ label, value, tone, hint });

/**
 * What each gate proves. The keys, labels, and weights are read from the code
 * that computes them; these sentences document what the check is for.
 */
const GATE_PURPOSE: Record<keyof typeof GATE_WEIGHTS, string> = {
  frozen_subject:
    "The stored fingerprint matches the exact immutable content, so every other check can be tied to it.",
  permission_fields:
    "Access, tool-use, and packaging permission have all been decided rather than left open.",
  metadata_validation:
    "The canonical contract, the digest, and the permission decisions were checked automatically.",
  human_review: "A named person reviewed the exact content published today.",
  source_permission: "The material this was built from is cleared for this use.",
  executor_binding:
    "The code that runs is server-allowlisted and matches the reviewed definition digest.",
  functional_test: "The asset produced a valid result on a real example, with the run persisted.",
  guardrail_test: "The asset failed safely when it should, with the run persisted.",
  security_review: "A named reviewer accepted a scope covering security and data handling.",
};

/** Labels are read from a live projection when one is available. */
function gateLabels(database: MarketplaceDatabase): Map<string, string> {
  const labels = new Map<string, string>();
  const governance = new GovernanceRepository(database);
  const executions = new ExecutionRepository(database);
  for (const record of governance.listVersions()) {
    const projection = buildGovernanceProjection(
      record,
      governance.listEvidence(record.asset_version.asset_version_id),
      serverExecutorRegistry,
      executions,
    );
    for (const gate of projection.gates) {
      if (!labels.has(gate.key)) labels.set(gate.key, gate.label);
    }
    if (labels.size === Object.keys(GATE_WEIGHTS).length) break;
  }
  return labels;
}

function transitionLines(): string[] {
  return Object.entries(ALLOWED_TRANSITIONS).map(([from, to]) =>
    to.length === 0
      ? `${from.replaceAll("_", " ")} → (terminal: nothing follows)`
      : `${from.replaceAll("_", " ")} → ${to.map((state) => state.replaceAll("_", " ")).join(" or ")}`,
  );
}

function liveCounts(database: MarketplaceDatabase): {
  facts: OperatorFact[];
  published: number;
} {
  const governance = new GovernanceRepository(database);
  const executions = new ExecutionRepository(database);
  const all = governance.listVersions();
  const published = all.filter(isCurrentPublished);
  const runnable = published.filter(
    (record) => record.asset_version.availability === "runnable",
  );
  let evidenceCount = 0;
  let runCount = 0;
  for (const record of all) {
    evidenceCount += governance.listEvidence(
      record.asset_version.asset_version_id,
    ).length;
    runCount += executions.listByAssetVersionId(
      record.asset_version.asset_version_id,
    ).length;
  }

  return {
    published: published.length,
    facts: [
      fact("Assets in the catalogue", String(published.length), "brand"),
      fact("Versions on record", String(all.length)),
      fact("Runnable here", String(runnable.length), runnable.length > 0 ? "positive" : "neutral"),
      fact("Evidence records", String(evidenceCount)),
      fact("Saved runs", String(runCount)),
      fact("Agents", String(AGENTS.length)),
      fact("Operator tools", String(TOOLS.length)),
    ],
  };
}

/**
 * The project knowledge layer. Every enumeration, weight, threshold, and
 * transition below is read from the module that implements it, so the answer
 * cannot drift away from what the product actually does.
 */
export function buildProjectKnowledge(
  database: MarketplaceDatabase,
  now: Date = new Date(),
): ProjectKnowledge {
  const labels = gateLabels(database);
  const live = liveCounts(database);
  const writeTools = TOOLS.filter((tool) => tool.kind === "write");
  const readTools = TOOLS.filter((tool) => tool.kind === "read");

  const sections: KnowledgeSection[] = [
    {
      heading: "Overview",
      body:
        "A governed internal marketplace for reusable AI assets. It answers the question a catalogue usually leaves open: can I trust this enough to reuse it today? Every asset carries a readiness score derived from real publication gates, and evidence bound to the cryptographic digest of the exact content it was collected against.",
      bullets: [
        "Find → Trust → Investigate → Prove → Act → Reuse",
        "Trust is derived, never authored: every point traces to a gate computed from persisted evidence",
        "Publication changes lifecycle only; it never mutates frozen content",
        "The whole product works with optional AI switched off",
      ],
      facts: live.facts,
      links: [
        { label: "Overview", href: "/" },
        { label: "Marketplace", href: "/marketplace" },
      ],
    },
    {
      heading: "Architecture",
      body:
        "One Next.js modular monolith over one SQLite database. Route handlers and server-rendered UI sit on top of five feature modules, which share canonical Zod contracts and narrow ports. Optional AI is a replaceable adapter behind an interface, never a dependency.",
      bullets: [
        "Browser: React 19, Next 16 App Router, server components with focused client islands",
        "API: src/app/api/* — typed route handlers, Zod-validated",
        "Modules: catalog, discovery, execution, governance, investigation, insights, operator",
        "Contracts: src/contracts/*.ts generate JSON Schema artifacts checked in CI",
        "Persistence: node:sqlite — assets, asset_versions, evidence, executions, lifecycle_events",
        "Optional AI: Gemini adapters, each schema-locked, timeout-bounded, and degrading to a deterministic path",
      ],
      facts: [
        fact("Database tables", "5 plus schema_migrations"),
        fact("Feature modules", "7"),
        fact("Executors allowlisted", String(serverExecutorRegistry.keys().length)),
      ],
      links: [{ label: "Architecture notes", href: "/control" }],
    },
    {
      heading: "The asset model",
      body:
        "An asset holds stable identity. Each asset version holds immutable content plus a separate governance projection. Once content is frozen, its subject digest is the sha256 of the canonical JSON of that content, and any behaviour change creates a new version and a new digest.",
      bullets: [
        `Asset types: ${AssetTypeSchema.options.join(", ")}`,
        `Availability: ${AvailabilitySchema.options.map((value) => value.replaceAll("_", " ")).join(", ")}`,
        `Execution kinds: ${ExecutionKindSchema.options.join(", ")}`,
        "Availability and lifecycle are separate: a published reference entry is not runnable",
        "Public browse and discovery return only published, non-deprecated current versions",
      ],
      facts: [
        fact("Immutable after freeze", "Content and definition digest", "positive"),
        fact("Mutable", "Lifecycle, publication timestamps, replacement pointer"),
      ],
      links: [{ label: "Browse assets", href: "/marketplace" }],
    },
    {
      heading: "Lifecycle",
      body:
        "Lifecycle is append-only. Every transition records an actor, a reason, and the evidence it relied on. Reviewer transitions cannot be performed by a contributor, and publication requires an explicit manual confirmation.",
      bullets: transitionLines(),
      facts: [
        fact("States", String(LifecycleStateSchema.options.length)),
        fact("Reviewer-only transitions", "in review, changes requested, published, deprecated", "warning"),
        fact("Publication", "Requires explicit confirmation plus every required gate", "warning"),
        fact("Archive state", "Does not exist — retirement is deprecation", "neutral"),
      ],
      links: [{ label: "Review queue", href: "/governance" }],
    },
    {
      heading: "Evidence and provenance",
      body:
        "Evidence is bound by database trigger to the subject digest of its own version. A record collected against different content cannot satisfy a gate, which is why an approval can expire without anyone editing it.",
      bullets: [
        `Evidence types: ${EvidenceTypeSchema.options.map((value) => value.replaceAll("_", " ")).join(", ")}`,
        `Results: ${EvidenceResultSchema.options.map((value) => value.replaceAll("_", " ")).join(", ")}`,
        "Digest mismatch, artifact-version mismatch, or a newer record of the same type all make evidence ineligible",
        "Human, security, and source-permission outcomes require a named human reviewer",
        "Execution-backed evidence must reference persisted prepublication executions for the exact version",
      ],
      facts: [
        fact("Binding", "sha256 subject digest, enforced in the database", "positive"),
        fact("Deletion", "Never: evidence is append-only", "positive"),
      ],
      links: [{ label: "Governance", href: "/governance" }],
    },
    {
      heading: "Governance gates",
      body:
        "Publication is gated on nine checks. A gate that is not required for an asset type is never counted against it, and a stale gate keeps partial credit because the work was done, only against other content.",
      bullets: Object.entries(GATE_WEIGHTS).map(
        ([key, weight]) =>
          `${labels.get(key) ?? key.replaceAll("_", " ")} (${weight} points): ${GATE_PURPOSE[key as keyof typeof GATE_WEIGHTS]}`,
      ),
      facts: [
        fact("Gate statuses", "passed, missing, failed, stale, not required"),
        fact(
          "Stale credit",
          `${Math.round(STATUS_FACTOR.stale * 100)}% of the gate's weight`,
          "warning",
        ),
        fact("Blocks publication", "Any required gate not passing", "warning"),
      ],
      links: [{ label: "Review queue", href: "/governance" }],
    },
    {
      heading: "Trust",
      body:
        "The readiness score is a weighted fraction of the required gates that pass, capped when the newest evidence is old. It adds no judgement of its own: every point traces back to a gate the governance projection computed from persisted, digest-bound evidence.",
      bullets: [
        ...TRUST_BANDS.map(
          (band) => `${band.minimum}+ — ${band.label} (${band.band})`,
        ),
        `Evidence newer than ${FRESHNESS_ATTENTION_HOURS} hours counts as current; older evidence caps the score at 79`,
        "Dimensions shown: governance, human review, evidence, security, freshness",
      ],
      facts: [
        fact("Maximum score", "100"),
        fact("Freshness window", `${FRESHNESS_ATTENTION_HOURS} hours`),
        fact("Authored anywhere", "No — the score is fully derived", "positive"),
      ],
      links: [{ label: "Recent changes", href: "/drift" }],
    },
    {
      heading: "Execution and reuse",
      body:
        "Only a server-allowlisted executor runs, and only after the client has selected an exact asset version. The client never names the executor. Each run persists an execution record carrying a unique execution ID, the frozen version, the executor key, and the definition digest.",
      bullets: [
        `Execution statuses: ${ExecutionStatusSchema.options.join(", ")}`,
        "Purposes: user_run and prepublication_test",
        "Output is validated against the asset's own output schema",
        "Reuse is proved from two distinct persisted executions of one unchanged frozen core",
      ],
      facts: [
        fact("Executor selection", "Server-owned allowlist only", "positive"),
        fact("Arbitrary code", "Never executed", "positive"),
      ],
      links: [{ label: "Marketplace", href: "/marketplace" }],
    },
    {
      heading: "Intelligence layers",
      body:
        "Five deterministic projections sit above the core records: trust drift, the impact graph, alternatives, comparison, and impact preview. None of them call a model; all of them read persisted state.",
      bullets: [
        "Trust drift — published assets whose required checks no longer cover the content people receive",
        "Impact graph — only relationships that are actually persisted: evidence, runs, scenarios, versions, related assets",
        "Alternatives — ranked by the same retrieval discovery uses, with a safer-option flag",
        "Comparison — factual differences only; it never declares a winner",
        "Impact preview — the deterministic before and after for a state change, plus what it puts at risk",
      ],
      facts: [
        fact("Model calls", "None in this layer", "positive"),
        fact("Fabricated history", "None — only recorded points are plotted", "positive"),
      ],
      links: [
        { label: "Recent changes", href: "/drift" },
        { label: "Compare", href: "/compare" },
      ],
    },
    {
      heading: "AI capabilities",
      body:
        `This system has ${AGENTS.length} agents. Three call a model; all degrade to a deterministic path, and none can add a governance fact, approve anything, or change lifecycle state on their own.`,
      bullets: AGENTS.map((agent) => `${agent.name} — ${agent.purpose}`),
      facts: [
        fact("Provider", "Gemini, behind a replaceable adapter"),
        fact("Works without a key", "Yes, every surface", "positive"),
        fact("May approve or publish", "No", "positive"),
      ],
      links: [{ label: "Agent Explorer", href: "/agents" }],
    },
    {
      heading: "Available actions",
      body:
        `The operator exposes ${TOOLS.length} tools: ${readTools.length} read directly, ${writeTools.length} require an explicit confirmation first. There is no path from a request to the database that does not go through one of these.`,
      bullets: [
        ...Object.entries(GROUP_LABEL).map(([group, label]) => {
          const inGroup = TOOLS.filter((tool) => tool.group === group);
          return `${label}: ${inGroup.map((tool) => tool.name).join(", ")}`;
        }),
      ],
      facts: [
        fact("Read tools", String(readTools.length), "positive", "Run directly"),
        fact("Write tools", String(writeTools.length), "warning", "Confirmation required"),
        fact(
          "Unavailable",
          String(TOOLS.filter((tool) => !tool.available).length),
          "neutral",
          "Marked, never simulated",
        ),
      ],
      links: [{ label: "AI Control Center", href: "/control" }],
    },
    {
      heading: "Workflows",
      body:
        "The journeys the product supports end to end, each of which the operator can drive from a single request.",
      bullets: [
        "Discover → understand → trust → reuse: search, open an asset, check readiness, run it",
        "Investigate → prove → act: open the investigation, read the evidence, flag or re-check",
        "Drift → compare → replace: see what slipped, compare against an alternative, preview the swap",
        "Contribute → validate → submit → review → publish: draft, run the checks, submit, then a reviewer publishes",
      ],
      facts: [
        fact("Human in the loop", "Every consequential outcome", "positive"),
        fact("Silent writes", "None", "positive"),
      ],
      links: [
        { label: "Contribute", href: "/contribute" },
        { label: "Discovery", href: "/discovery" },
      ],
    },
  ];

  return {
    summary: `${live.published} published assets, ${TOOLS.length} operator tools, ${AGENTS.length} agents, as of ${now.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    sections,
  };
}

const TOPIC_KEYWORDS: { heading: string; words: RegExp }[] = [
  { heading: "Overview", words: /overview|what is this|explain this project|the product|summar/i },
  { heading: "Architecture", words: /architect|stack|built with|tech|database|module|api/i },
  { heading: "The asset model", words: /asset model|asset type|availability|what is an asset|version/i },
  { heading: "Lifecycle", words: /lifecycle|state|transition|draft|publish|deprecat|archive|workflow state/i },
  { heading: "Evidence and provenance", words: /evidence|provenance|digest|proof|attest/i },
  { heading: "Governance gates", words: /gate|governance|check|review requirement|blocking/i },
  { heading: "Trust", words: /trust|readiness|score|band|fresh/i },
  { heading: "Execution and reuse", words: /execut|run|reuse|executor|scenario/i },
  { heading: "Intelligence layers", words: /drift|impact|alternativ|compar|intelligence|graph/i },
  { heading: "AI capabilities", words: /\bai\b|agent|model|gemini|llm/i },
  { heading: "Available actions", words: /action|tool|capabilit|what can you|what can i do|confirm/i },
  { heading: "Workflows", words: /workflow|journey|end to end|how do i|process/i },
];

/**
 * Picks the sections a question is actually about. When nothing matches, the
 * orientation sections are returned rather than the whole document.
 */
export function selectSections(
  knowledge: ProjectKnowledge,
  topic: string | null,
): KnowledgeSection[] {
  if (topic === null || topic.trim().length === 0) {
    return knowledge.sections.slice(0, 3);
  }
  const matched = TOPIC_KEYWORDS.filter((entry) => entry.words.test(topic)).map(
    (entry) => entry.heading,
  );
  if (matched.length === 0) return knowledge.sections.slice(0, 3);
  const selected = knowledge.sections.filter((section) =>
    matched.includes(section.heading),
  );
  return selected.length > 0 ? selected.slice(0, 4) : knowledge.sections.slice(0, 3);
}
