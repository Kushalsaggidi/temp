import { describe, expect, it } from "vitest";

import {
  AI_FALLBACK_MESSAGE,
  GOVERNANCE_PURPOSE,
  TRUST_EXPLAINER,
  evidenceStateLabel,
  gateCopy,
  gateStatusWord,
  readinessFor,
  relativeTime,
} from "@/components/ui/language";
import type { GovernanceGate } from "@/modules/governance";

function gate(key: GovernanceGate["key"], status: GovernanceGate["status"]): GovernanceGate {
  return { key, label: key, required: status !== "not_required", status, message: "internal" };
}

describe("interface language", () => {
  it("maps every readiness band to one plain-English status", () => {
    expect(readinessFor("strong").label).toBe("Ready to use");
    expect(readinessFor("adequate").label).toBe("Ready with review");
    expect(readinessFor("attention").label).toBe("Checks needed");
    expect(readinessFor("blocked").label).toBe("Not ready to use");

    for (const band of ["strong", "adequate", "attention", "blocked"] as const) {
      expect(readinessFor(band).meaning.length).toBeGreaterThan(20);
    }
  });

  it("never describes an optional check as a problem", () => {
    const copy = gateCopy(gate("security_review", "not_required"));

    expect(copy.statement).toBe("Not required for this asset");
    expect(copy.tone).toBe("neutral");
    expect(copy.isProblem).toBe(false);
  });

  it("distinguishes missing, incomplete, and needs-redoing", () => {
    expect(gateStatusWord("missing")).toBe("Not done");
    expect(gateStatusWord("failed")).toBe("Incomplete");
    expect(gateStatusWord("stale")).toBe("Needs redoing");
    expect(gateStatusWord("passed")).toBe("Complete");
    expect(gateStatusWord("not_required")).toBe("Not required");

    const words = new Set(
      (["missing", "failed", "stale", "passed", "not_required"] as const).map(gateStatusWord),
    );
    expect(words.size).toBe(5);
  });

  it("states the requested plain-English replacements", () => {
    expect(gateCopy(gate("frozen_subject", "missing")).statement).toBe(
      "This version was not locked before review",
    );
    expect(gateCopy(gate("permission_fields", "failed")).statement).toBe(
      "Permissions are incomplete",
    );
    expect(gateCopy(gate("metadata_validation", "missing")).statement).toBe(
      "Asset details have not been checked",
    );
  });

  it("gives every problem statement a reason it matters", () => {
    for (const key of [
      "frozen_subject",
      "permission_fields",
      "metadata_validation",
      "human_review",
      "source_permission",
      "executor_binding",
      "functional_test",
      "guardrail_test",
      "security_review",
    ] as const) {
      const copy = gateCopy(gate(key, "missing"));
      expect(copy.isProblem).toBe(true);
      expect(copy.why.length).toBeGreaterThan(20);
    }
  });

  it("explains evidence states without internal vocabulary", () => {
    expect(evidenceStateLabel("stale_digest")).toBe("Applies to an older version");
    expect(evidenceStateLabel("superseded")).toBe("Replaced by a newer check");
    expect(evidenceStateLabel("passed")).toBe("Current");
    for (const state of ["passed", "stale_digest", "superseded", "failed"]) {
      expect(evidenceStateLabel(state)).not.toMatch(/digest|artifact|subject/i);
    }
  });

  it("uses everyday words for time and keeps the AI fallback calm and actionable", () => {
    const now = Date.parse("2026-09-17T12:00:00Z");
    expect(relativeTime(null, now)).toBe("never checked");
    expect(relativeTime("2026-09-17T11:00:00Z", now)).toBe("checked 1 hours ago");
    expect(relativeTime("2026-09-15T12:00:00Z", now)).toBe("checked 2 days ago");

    expect(AI_FALLBACK_MESSAGE).toContain("temporarily unavailable");
    expect(AI_FALLBACK_MESSAGE).not.toMatch(/gemini|deterministic|timed out/i);
  });

  it("explains trust and the governance page in one plain sentence each", () => {
    expect(TRUST_EXPLAINER).toMatch(/required checks/i);
    expect(TRUST_EXPLAINER).not.toMatch(/gate|digest|projection/i);
    expect(GOVERNANCE_PURPOSE).toMatch(/completed their required checks/i);
  });
});
