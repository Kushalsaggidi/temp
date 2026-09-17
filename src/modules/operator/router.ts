import type { OperatorContext } from "@/contracts";

import type { ToolArgs } from "./tools";

export interface RouteDecision {
  tool: string;
  intent: string;
  interpretation: string;
  confidence: "high" | "medium" | "low";
  assetReference: string | null;
  secondReference: string | null;
  query: string;
  args: ToolArgs;
}

interface Rule {
  tool: string;
  intent: string;
  pattern: RegExp;
  /** Everything after this is treated as the asset reference. */
  strip?: RegExp;
  interpretation: (utterance: string) => string;
}

const QUOTED = /["“”'‘’](.+?)["“”'‘’]/;

function clean(value: string): string {
  return value
    .replace(/[?.!,;:]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLER =
  /^(please\s+|can you\s+|could you\s+|i want to\s+|i'd like to\s+|i would like to\s+|help me\s+|show me\s+|tell me\s+|give me\s+)+/i;

/** Words that only ever refer to the thing already on screen. */
const DEICTIC_TAIL =
  /\b(this|it|that|these|them|this one|the current one|here)\b\s*(asset|agent|version|one)?\s*$/i;

const STOP_TAIL =
  /\b(asset|agent|version|the|a|an|for me|please|right now|today)\b/gi;

function referenceFrom(utterance: string, strip?: RegExp): string | null {
  const quoted = QUOTED.exec(utterance);
  if (quoted?.[1]) return clean(quoted[1]);

  const base = clean(utterance.replace(FILLER, ""));
  if (DEICTIC_TAIL.test(base)) return null;

  let remainder = base;
  if (strip !== undefined) remainder = clean(base.replace(strip, ""));

  const prepositional =
    /\b(?:of|for|about|on|to|against|with|named|called)\s+(.{3,80}?)\s*$/i.exec(remainder);
  if (prepositional?.[1]) {
    const candidate = clean(prepositional[1].replace(STOP_TAIL, " "));
    if (candidate.length >= 3) return candidate;
  }

  const candidate = clean(remainder.replace(STOP_TAIL, " "));
  return candidate.length >= 3 ? candidate : null;
}

function pairFrom(utterance: string): { first: string; second: string } | null {
  const match =
    /\bcompare\s+(.{2,80}?)\s+(?:and|with|to|versus|vs\.?)\s+(.{2,80}?)\s*$/i.exec(
      clean(utterance),
    );
  if (match?.[1] && match[2]) {
    return { first: clean(match[1]), second: clean(match[2]) };
  }
  return null;
}

const UPDATE_FIELDS: Record<string, string> = {
  description: "description",
  summary: "summary",
  name: "name",
  owner: "owner",
  "usage instructions": "usage_instructions",
  "setup expectations": "setup_expectations",
  "maintenance expectations": "maintenance_expectations",
};

function updateArgs(utterance: string): ToolArgs {
  const field = Object.keys(UPDATE_FIELDS).find((key) =>
    new RegExp(`\\b${key}\\b`, "i").test(utterance),
  );
  const quoted = QUOTED.exec(utterance);
  const trailing = /\bto\s+(.{3,})$/i.exec(clean(utterance));
  const value = quoted?.[1] ?? trailing?.[1] ?? null;
  if (field === undefined || value === null) return {};
  return { [UPDATE_FIELDS[field]!]: clean(value) };
}

/**
 * Rules are ordered most specific first. Each one is a phrasing the product
 * actually supports; anything unmatched falls through to search or to the
 * asset already in context.
 */
const RULES: Rule[] = [
  {
    tool: "getProjectInformation",
    intent: "explain project",
    pattern:
      /\b(explain (this|the) (project|product|system|app)|what is this (project|product|app|system)|how does (this|the) (product|system|marketplace) work|what (features|capabilities) (are|does)|how does trust work|explain the (complete )?lifecycle|what (checks|gates) are performed|what happens when an asset is flagged|architecture|tell me about (this|the) (project|product))\b/i,
    interpretation: () =>
      "Answered from the project knowledge layer, which is generated from the implementation.",
  },
  {
    tool: "listCapabilities",
    intent: "list capabilities",
    pattern:
      /\b(what (actions|operations|things) can (i|you)|what can you (do|actually do)|which operations require confirmation|list (your )?(tools|capabilities|actions)|what are you able to)\b/i,
    interpretation: () => "Listed the operator's registered tools and their read or write classification.",
  },
  {
    tool: "getAgentInformation",
    intent: "agents",
    pattern:
      /\b(what agents|which agent|agent explorer|what does the (investigator|discovery agent|impact analyst|contribution assistant|operator) do|tell me about the agents|what can each agent)\b/i,
    interpretation: () => "Described the agents that exist in this system.",
  },
  {
    tool: "getTrustDrift",
    intent: "trust drift",
    pattern:
      /\b(drift|changed trust|trust (has )?(changed|dropped|decreased|fallen)|which assets (have )?(changed|slipped)|what (has )?slipped|recent changes)\b/i,
    interpretation: () => "Read the drift detector over every published asset.",
  },
  {
    tool: "getMarketplaceOverview",
    intent: "marketplace overview",
    pattern:
      /\b(overview|marketplace health|how many assets|how is the (catalogue|catalog|marketplace)|catalogue health|state of the (catalogue|catalog|marketplace)|how many (are|assets are) published|distribution)\b/i,
    interpretation: () => "Counted the current catalogue from persisted records.",
  },
  {
    tool: "compareAssets",
    intent: "compare",
    pattern: /\b(compare|side by side|difference between|versus|vs\.?)\b/i,
    strip: /^\s*compare\s+/i,
    interpretation: () => "Compared the two assets attribute by attribute.",
  },
  {
    tool: "findAlternatives",
    intent: "alternatives",
    pattern:
      /(\balternativ|\binstead of\b|\breplacement\b|\breplace this\b|\bsomething else\b|\banother option\b|\ba different (asset|agent|one)\b|\bsafer option\b)/i,
    strip: /\b(find|an?|the)?\s*alternatives?\s*(to|for)?\s*/i,
    interpretation: () => "Ranked published assets covering the same capabilities.",
  },
  {
    tool: "getImpact",
    intent: "impact",
    pattern:
      /\b(who (will|would|could|might) be affected|what (is|are) (this|it) connected to|depend(s|ent|encies)?|impact graph|what does (this|it) touch|blast radius|affected)\b/i,
    strip: /\b(who|what)\b.*\b(affected|connected|depends?)\b/i,
    interpretation: () => "Built the impact graph from persisted relationships only.",
  },
  {
    tool: "runGovernanceChecks",
    intent: "run checks",
    pattern:
      /\b(run (the )?(governance )?checks|re-?run (the )?checks|re-?validate|run validation|validate (the )?metadata|re-?check)\b/i,
    strip: /\b(run|re-?run|re-?validate|validate|re-?check)\b\s*(the)?\s*(governance)?\s*(checks?|validation|metadata)?\s*(on|for)?\s*/i,
    interpretation: () => "Prepared the deterministic metadata and digest validation.",
  },
  {
    tool: "submitForReview",
    intent: "submit for review",
    pattern: /\b(submit (it|this|the draft)? ?(for review)?|send (it|this) (for|to) review|put it in the review queue)\b/i,
    strip: /\bsubmit\b\s*(it|this|the draft)?\s*(for review)?\s*/i,
    interpretation: () => "Prepared the draft-to-submitted transition.",
  },
  {
    tool: "publishAsset",
    intent: "publish",
    pattern: /\bpublish\b/i,
    strip: /\bpublish\b\s*(it|this|the asset)?\s*/i,
    interpretation: () => "Prepared the publication transition and checked every required gate.",
  },
  {
    tool: "flagAsset",
    intent: "flag",
    pattern:
      /\b(flag|deprecat|take (it|this) (down|off)|remove (it|this)? ?from (the )?(catalogue|catalog|discovery)|pull (it|this))\b/i,
    strip: /\b(flag|deprecate)\b\s*(it|this|the asset)?\s*(for re-?review)?\s*/i,
    interpretation: () => "Prepared the flag-for-re-review transition.",
  },
  {
    tool: "archiveAsset",
    intent: "archive",
    pattern: /\barchiv/i,
    interpretation: () => "Checked whether archiving exists in this product.",
  },
  {
    tool: "createVersion",
    intent: "new version",
    pattern: /\b(new version|create a version|another version|bump the version|version it)\b/i,
    strip: /\b(create|make)?\s*(a|the)?\s*(new)?\s*version\s*(of|for)?\s*/i,
    interpretation: () => "Prepared a new editable draft version from the published one.",
  },
  {
    tool: "updateAsset",
    intent: "update",
    pattern:
      /\b(update|change|edit|rewrite|rename|set) (the |its )?(description|summary|name|owner|usage instructions|setup expectations|maintenance expectations)\b/i,
    strip:
      /\b(update|change|edit|rewrite|rename|set)\b.*?\b(description|summary|name|owner|usage instructions|setup expectations|maintenance expectations)\b\s*(to|with)?\s*/i,
    interpretation: () => "Prepared a metadata change on the draft.",
  },
  {
    tool: "createAsset",
    intent: "create asset",
    pattern:
      /\b(create (a|an|new)|contribute|i want to (add|build|contribute|create)|new (agent|asset|skill|workflow|template)|add (a|an) (new )?(agent|asset)|register (a|an)|make (me )?(a|an)|build (me )?(a|an))\b/i,
    interpretation: () => "Started the contribution workflow.",
  },
  {
    tool: "runAsset",
    intent: "run asset",
    // Anything left saying "run" by this point is a request to run an asset:
    // running the governance checks is matched by an earlier rule.
    pattern: /\b(run|execute)\b|\btry it\b/i,
    strip: /\b(run|execute|try)\b\s*(it|this|the asset)?\s*(on)?\s*/i,
    interpretation: () => "Prepared a governed run against the asset's own test scenario.",
  },
  {
    tool: "getExecutionHistory",
    intent: "execution history",
    pattern: /\b(execution history|saved runs|past runs|runs of|how many (times|runs|executions))\b/i,
    strip: /\b(execution history|saved runs|past runs|runs)\b\s*(of|for)?\s*/i,
    interpretation: () => "Listed the persisted execution records.",
  },
  {
    tool: "getExecutionStatus",
    intent: "execution status",
    pattern: /\b(execution status|status of (the )?run|execution_[a-z0-9]+|last run)\b/i,
    interpretation: () => "Read the persisted execution record.",
  },
  {
    tool: "getReuseIntelligence",
    intent: "reuse",
    pattern: /\b(how often|usage|reuse|being used|used most|adoption)\b/i,
    strip: /\b(how often (is|are)|usage of|reuse of)\b\s*/i,
    interpretation: () => "Counted real use from persisted execution records.",
  },
  {
    tool: "getReviewQueue",
    intent: "review queue",
    pattern:
      /\b(review queue|what is in review|what's in review|awaiting review|pending review|needs review|what needs approval|unpublished|what is waiting|drafts)\b/i,
    interpretation: () => "Listed every version that has not been published yet.",
  },
  {
    tool: "getGovernanceStatus",
    intent: "governance status",
    pattern:
      /\b(governance|what.{0,12}blocking|what is stopping|why (can'?t|cannot|won'?t) (i |it |this )?(be )?publish|required checks|gates|ready to publish|review queue|what is in review)\b/i,
    strip: /\b(governance (status|state)( of| for)?)\b\s*/i,
    interpretation: () => "Read the governance projection for the version.",
  },
  {
    tool: "getEvidence",
    intent: "evidence",
    pattern: /\b(evidence|proof|who reviewed|what proves|backing|attestation)\b/i,
    strip: /\b(show( me)?( the)?|what)?\s*(evidence|proof)\b\s*(behind|for|of)?\s*/i,
    interpretation: () => "Listed the digest-bound evidence records.",
  },
  {
    tool: "getLifecycle",
    intent: "lifecycle",
    pattern: /\b(timeline|history|what happened|lifecycle of|when was (it|this))\b/i,
    strip: /\b(timeline|history|lifecycle)\b\s*(of|for)?\s*/i,
    interpretation: () => "Read the lifecycle events and evidence in order.",
  },
  {
    tool: "investigateAsset",
    intent: "investigate",
    pattern:
      /\b(investigate|why is (this|it|.{3,60}) (flagged|risky|blocked|not trusted|at risk)|why (was|is) (this|it) flagged|what changed|why did trust|check readiness|what'?s wrong with|is (this|it) safe|why is (this|it) (better|worse))\b/i,
    strip:
      /\b(investigate|why (is|was|did)|what changed (on|for|about)?|check readiness (of|for)?|what'?s wrong with)\b\s*/i,
    interpretation: () => "Ran the investigation against this version's persisted records.",
  },
  {
    tool: "getTrust",
    intent: "trust",
    pattern: /\b(trust score|how ready|readiness|is it ready|trustworthiness)\b/i,
    strip: /\b(trust score|readiness|how ready is)\b\s*(of|for)?\s*/i,
    interpretation: () => "Read the derived readiness score and its gate breakdown.",
  },
  {
    tool: "searchAssets",
    intent: "search",
    pattern:
      /\b(find|search|look for|show me|do we have|is there|any|which assets|list assets|browse)\b/i,
    strip: /^\s*(find|search for|search|look for|show me|do we have|is there)\s+(me\s+)?/i,
    interpretation: () => "Ran the catalogue search over published versions.",
  },
];

/**
 * Deterministic routing. It resolves most product phrasings without a model,
 * which keeps the common path fast and keeps the product usable with optional
 * AI switched off.
 */
export function routeDeterministically(
  utterance: string,
  context: OperatorContext,
): RouteDecision | null {
  const text = clean(utterance);
  if (text.length === 0) return null;

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;

    if (rule.tool === "compareAssets") {
      const pair = pairFrom(text);
      return {
        tool: rule.tool,
        intent: rule.intent,
        interpretation: rule.interpretation(text),
        confidence: "high",
        assetReference: pair?.first ?? referenceFrom(text, rule.strip),
        secondReference: pair?.second ?? null,
        query: "",
        args: {},
      };
    }

    const reference = referenceFrom(text, rule.strip);
    const args = rule.tool === "updateAsset" ? updateArgs(text) : {};

    return {
      tool: rule.tool,
      intent: rule.intent,
      interpretation: rule.interpretation(text),
      confidence: rule.tool === "searchAssets" ? "medium" : "high",
      assetReference: reference,
      secondReference: null,
      query: rule.tool === "searchAssets" ? clean(text.replace(rule.strip ?? /$^/, "")) : "",
      args,
    };
  }

  // Nothing matched. On an asset surface a bare question is about that asset;
  // anywhere else it is treated as a catalogue search.
  if (context.asset_version_id !== null) {
    return {
      tool: "getAsset",
      intent: "asset detail",
      interpretation: `Read as a question about ${context.asset_name ?? "the asset on this page"}.`,
      confidence: "low",
      assetReference: null,
      secondReference: null,
      query: "",
      args: {},
    };
  }

  return {
    tool: "searchAssets",
    intent: "search",
    interpretation: "Read as a catalogue search over published assets.",
    confidence: "low",
    assetReference: null,
    secondReference: null,
    query: text,
    args: {},
  };
}

/** Exposed for tests and for the model router's candidate list. */
export const ROUTER_RULES = RULES.map((rule) => ({
  tool: rule.tool,
  intent: rule.intent,
}));
