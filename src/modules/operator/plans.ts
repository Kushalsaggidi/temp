import type { OperatorPlan, OperatorStep } from "@/contracts";

import type { ContributionDraftFields } from "./tools";

function step(
  index: number,
  key: string,
  title: string,
  detail: string,
  tool: string,
  kind: "read" | "write",
  args: Record<string, unknown>,
  confirmRequired: boolean,
): OperatorStep {
  return {
    index,
    key,
    title,
    detail,
    tool,
    kind,
    args,
    confirm_required: confirmRequired,
    status: index === 1 ? "ready" : "pending",
    outcome: null,
  };
}

function planId(): string {
  return `plan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The contribution path, as the governance module actually enforces it:
 * a draft must be created, its content locked before anything can be checked
 * against it, validated, and only then submitted for a human reviewer.
 * Publication is deliberately not a step — only a named reviewer can publish.
 */
export function contributionPlan(
  draft: ContributionDraftFields,
  now: Date,
): OperatorPlan {
  return {
    plan_id: planId(),
    title: `Contribute ${draft.name}`,
    goal: `Create ${draft.name} as a draft, lock it, validate it, and put it in the review queue.`,
    created_at: now.toISOString(),
    note: "Publication is not part of this plan. Only the named reviewer who passes the human review can publish a version.",
    steps: [
      step(
        1,
        "create",
        "Create the draft",
        `Creates "${draft.name}" ${draft.version} as a non-runnable draft. Nothing is discoverable yet.`,
        "createAsset",
        "write",
        { draft: draft as unknown as Record<string, unknown> },
        false,
      ),
      step(
        2,
        "freeze",
        "Lock the content",
        "Computes the subject digest over the exact content. Every check from here is bound to it, and the content becomes immutable.",
        "freezeAsset",
        "write",
        {},
        false,
      ),
      step(
        3,
        "validate",
        "Run the governance checks",
        "Validates the canonical contract, the digest, and the permission decisions, and appends the result as evidence.",
        "runGovernanceChecks",
        "write",
        {},
        false,
      ),
      step(
        4,
        "submit",
        "Submit for review",
        "Moves the draft into the review queue. A human reviewer decides what happens next.",
        "submitForReview",
        "write",
        {},
        true,
      ),
    ],
  };
}

/** Prepares an existing draft for review, skipping creation. */
export function prepareForReviewPlan(
  assetVersionId: string,
  assetName: string,
  alreadyFrozen: boolean,
  now: Date,
): OperatorPlan {
  const steps: OperatorStep[] = [];
  let index = 1;
  if (!alreadyFrozen) {
    steps.push(
      step(
        index,
        "freeze",
        "Lock the content",
        "Computes the subject digest so checks can be bound to exactly this content.",
        "freezeAsset",
        "write",
        { asset_version_id: assetVersionId },
        false,
      ),
    );
    index += 1;
  }
  steps.push(
    step(
      index,
      "validate",
      "Run the governance checks",
      "Validates the contract, the digest, and the permission decisions, and appends the result as evidence.",
      "runGovernanceChecks",
      "write",
      { asset_version_id: assetVersionId },
      false,
    ),
  );
  index += 1;
  steps.push(
    step(
      index,
      "submit",
      "Submit for review",
      "Moves the draft into the review queue for a human reviewer.",
      "submitForReview",
      "write",
      { asset_version_id: assetVersionId },
      true,
    ),
  );

  return {
    plan_id: planId(),
    title: `Prepare ${assetName} for review`,
    goal: `Lock, validate, and submit ${assetName}.`,
    created_at: now.toISOString(),
    note: "Only a named reviewer can publish. This plan stops at the review queue.",
    steps: steps.map((entry, position) => ({
      ...entry,
      status: position === 0 ? ("ready" as const) : ("pending" as const),
    })),
  };
}

/** True when a request asks for more than one state change in one sentence. */
export function needsPlan(utterance: string): boolean {
  const text = utterance.toLowerCase();
  const wantsCreate =
    /\b(create|contribute|add|register|build|new (agent|asset|skill|workflow|template))\b/.test(
      text,
    );
  const wantsNext =
    /\b(and|then|prepare|ready for|submit|review|governance|checks?|validate|publish)\b/.test(
      text,
    );
  return wantsCreate && wantsNext;
}

/** True when a request asks to walk an existing draft up to the review queue. */
export function wantsPrepareForReview(utterance: string): boolean {
  return /\b(prepare .* for (governance )?review|get .* ready for review|ready it for review|take .* to review)\b/i.test(
    utterance,
  );
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "create",
  "contribute",
  "add",
  "register",
  "build",
  "make",
  "new",
  "and",
  "then",
  "prepare",
  "it",
  "for",
  "governance",
  "review",
  "submit",
  "please",
  "i",
  "want",
  "to",
  "would",
  "like",
  "me",
  "my",
  "asset",
]);

/**
 * A deterministic contribution draft built from the words the person used.
 * It is deliberately thin: the placeholders say plainly that a human must
 * replace them, rather than inventing detail nobody asserted.
 */
export function deterministicDraft(utterance: string): ContributionDraftFields | null {
  const words = utterance
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  if (words.length === 0) return null;

  const isAgent = /\bagent\b/i.test(utterance);
  const core = words.filter((word) => word !== "agent").slice(0, 5);
  if (core.length === 0) return null;

  const name = `${core.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ")}${isAgent ? " Agent" : ""}`;
  const subject = core.join(" ");

  return {
    slug: `${core.join("-")}${isAgent ? "-agent" : ""}`.slice(0, 100),
    name,
    summary: `A proposed asset for ${subject}. Replace this summary with what it actually does before submitting.`,
    owner: "Marketplace contributor",
    asset_type: isAgent ? "agent" : "template",
    version: "1.0.0",
    description: `A draft contribution for ${subject}, created from a request in the AI Control Center. The description has not been written yet: state what the asset does, what it needs, and what it produces before a reviewer sees it.`,
    capabilities: [subject],
    use_cases: [`Work involving ${subject}`],
    domains: ["property operations"],
    audiences: ["operations teams"],
    limitations: [
      "This draft was generated from a one-line request and has not been reviewed.",
      "No evidence has been collected for it.",
    ],
    usage_instructions:
      "Not written yet. Describe, step by step, how a colleague would use this asset.",
    setup_expectations:
      "Not written yet. State what a team must have in place before using this asset.",
    maintenance_expectations:
      "Not written yet. State who keeps this current and how often it is reviewed.",
  };
}
