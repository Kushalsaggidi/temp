import type { GateStatus, GovernanceGate } from "@/modules/governance";
import type { TrustBand } from "@/contracts";

/**
 * The presentation vocabulary. Governance rules, gate keys, and scores are
 * unchanged — this only decides what a person reads. Keeping it in one place
 * stops the same state from being described three different ways.
 */

export type ReadinessKey = "ready" | "ready_with_review" | "checks_needed" | "not_ready";

export interface Readiness {
  key: ReadinessKey;
  /** The single status label. Nothing else on screen should restate it. */
  label: string;
  /** One line explaining what the label means for the reader. */
  meaning: string;
  tone: "positive" | "info" | "warning" | "negative";
}

const READINESS: Record<ReadinessKey, Readiness> = {
  ready: {
    key: "ready",
    label: "Ready to use",
    meaning: "Every required check has been completed for the version published today.",
    tone: "positive",
  },
  ready_with_review: {
    key: "ready_with_review",
    label: "Ready with review",
    meaning: "Most checks are complete. Read the limitations before you rely on it.",
    tone: "info",
  },
  checks_needed: {
    key: "checks_needed",
    label: "Checks needed",
    meaning: "Some required checks are missing or out of date for the current version.",
    tone: "warning",
  },
  not_ready: {
    key: "not_ready",
    label: "Not ready to use",
    meaning: "The required checks have not been completed, so nobody should rely on it yet.",
    tone: "negative",
  },
};

const BAND_TO_READINESS: Record<TrustBand, ReadinessKey> = {
  strong: "ready",
  adequate: "ready_with_review",
  attention: "checks_needed",
  blocked: "not_ready",
};

export function readinessFor(band: TrustBand): Readiness {
  return READINESS[BAND_TO_READINESS[band]];
}

/** What the trust score is, in one sentence, for the first time someone sees it. */
export const TRUST_EXPLAINER =
  "The trust score is the share of required checks this version has completed, so a higher score means less to verify yourself.";

export const GOVERNANCE_PURPOSE =
  "See which assets have completed their required checks and which ones need attention before they are used.";

/**
 * Plain-English gate names and the reason each one matters. The governance gate
 * keys and statuses are untouched; only the wording changes.
 */
const GATE_COPY: Record<
  GovernanceGate["key"],
  { name: string; missing: string; why: string }
> = {
  frozen_subject: {
    name: "Version locked",
    missing: "This version was not locked before review",
    why: "Locking the content means a review can be tied to exactly what you receive.",
  },
  permission_fields: {
    name: "Permissions recorded",
    missing: "Permissions are incomplete",
    why: "Someone confirmed the asset may be accessed, used in this tool, and shared.",
  },
  metadata_validation: {
    name: "Details checked",
    missing: "Asset details have not been checked",
    why: "An automatic check confirms the description and contract still match the content.",
  },
  human_review: {
    name: "Reviewed by a person",
    missing: "No person has reviewed this version",
    why: "A named reviewer confirmed the asset does what it says for its audience.",
  },
  source_permission: {
    name: "Source approved",
    missing: "The source has not been approved",
    why: "The material it was built from is cleared for this use.",
  },
  executor_binding: {
    name: "Run setup verified",
    missing: "The run setup has not been verified",
    why: "Only assets you can run need this: it ties the asset to reviewed code.",
  },
  functional_test: {
    name: "Tested on a real example",
    missing: "It has not been tested on a real example",
    why: "A test run confirms the asset produces the output it promises.",
  },
  guardrail_test: {
    name: "Safe-failure tested",
    missing: "Safe-failure behaviour has not been tested",
    why: "Confirms the asset refuses bad input instead of guessing.",
  },
  security_review: {
    name: "Security reviewed",
    missing: "No security review is recorded",
    why: "A named reviewer checked how it handles inputs and data.",
  },
};

export interface GateCopy {
  name: string;
  /** Headline a non-expert reads. */
  statement: string;
  why: string;
  tone: "positive" | "warning" | "negative" | "neutral";
  /** Not-required gates read as neutral information, never as a problem. */
  isProblem: boolean;
}

export function gateCopy(gate: GovernanceGate): GateCopy {
  const copy = GATE_COPY[gate.key];
  switch (gate.status) {
    case "passed":
      return {
        name: copy.name,
        statement: `${copy.name}: complete`,
        why: copy.why,
        tone: "positive",
        isProblem: false,
      };
    case "not_required":
      return {
        name: copy.name,
        statement: "Not required for this asset",
        why: "This check only applies to assets you can run directly.",
        tone: "neutral",
        isProblem: false,
      };
    case "stale":
      return {
        name: copy.name,
        statement: `${copy.name}: needs redoing`,
        why: "The check was done against different content than the version published today.",
        tone: "warning",
        isProblem: true,
      };
    case "failed":
      return {
        name: copy.name,
        statement: copy.missing,
        why: copy.why,
        tone: "negative",
        isProblem: true,
      };
    default:
      return {
        name: copy.name,
        statement: copy.missing,
        why: copy.why,
        tone: "warning",
        isProblem: true,
      };
  }
}

/** Short status word used on the gate strip and in compact rows. */
export function gateStatusWord(status: GateStatus): string {
  switch (status) {
    case "passed":
      return "Complete";
    case "stale":
      return "Needs redoing";
    case "failed":
      return "Incomplete";
    case "missing":
      return "Not done";
    default:
      return "Not required";
  }
}

/** Evidence assessment states, in the words a non-expert would use. */
export function evidenceStateLabel(state: string): string {
  switch (state) {
    case "passed":
      return "Current";
    case "not_applicable":
      return "Not applicable";
    case "informational":
      return "For information";
    case "stale_digest":
      return "Applies to an older version";
    case "stale_artifact":
      return "Applies to an older release";
    case "superseded":
      return "Replaced by a newer check";
    default:
      return "Did not pass";
  }
}

export function relativeTime(value: string | null, now: number): string {
  if (value === null) return "never checked";
  const hours = (now - Date.parse(value)) / 3_600_000;
  if (hours < 1) return "checked just now";
  if (hours < 24) return `checked ${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return `checked ${days} ${days === 1 ? "day" : "days"} ago`;
}

export const AI_FALLBACK_MESSAGE =
  "AI suggestions are temporarily unavailable. Your results were created using standard matching instead.";

export const RANKING_RULE_BASED = "Rule-based ranking";
export const RANKING_HYBRID = "AI-assisted matching with rule-based ranking";
