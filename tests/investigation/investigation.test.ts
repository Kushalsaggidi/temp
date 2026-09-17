import { describe, expect, it } from "vitest";

import { demoCatalogEntries, heroDraftRecord } from "../../fixtures/catalog/published-catalog";
import type { AssetVersionRecord, Evidence } from "@/contracts";
import { buildGovernanceProjection } from "@/modules/governance";
import {
  buildInvestigationReport,
  changedContentFields,
  computeTrustScore,
  deterministicInference,
  type InvestigationSubject,
} from "@/modules/investigation";

const residentV1 = demoCatalogEntries.find(
  (entry) => entry.record.asset_version.asset_version_id === "av_resident_comms_1_0_0",
)!.record;
const residentV11 = demoCatalogEntries.find(
  (entry) => entry.record.asset_version.asset_version_id === "av_resident_comms_1_1_0",
)!.record;

function evidenceFor(record: AssetVersionRecord, type: Evidence["evidence_type"]): Evidence {
  const version = record.asset_version;
  return {
    evidence_id: `evidence_${type}_${version.asset_version_id.slice(-6)}`,
    asset_id: version.asset_id,
    asset_version_id: version.asset_version_id,
    subject_digest: version.subject_digest!,
    evidence_type: type,
    scope: "Scoped security and data-handling review of the frozen version content.",
    observed: "ok",
    result: "passed",
    actor_type: type === "human_review" || type === "security_review" ? "demo_reviewer" : "system",
    ...(type === "human_review" || type === "security_review"
      ? { reviewer: { name: "Test Reviewer" }, actor_name: "Test Reviewer" }
      : {}),
    timestamp: "2026-09-16T12:00:00Z",
    method: "Test fixture",
    execution_ids: [],
    artifact_version: version.version,
    details: {
      summary: "Test evidence",
      assertions: [{ name: "assertion", passed: true, observed: "ok" }],
    },
    limitations: ["Test fixture only."],
  } as Evidence;
}

describe("trust scoring", () => {
  it("scores a version with no evidence as not established", () => {
    const trust = computeTrustScore(buildGovernanceProjection(residentV11, []));

    expect(trust.score).toBeLessThan(40);
    expect(trust.band).toBe("blocked");
    expect(trust.passing_gates).toBeLessThan(trust.required_gates);
  });

  it("raises the score only as real gates start passing", () => {
    const partial = computeTrustScore(
      buildGovernanceProjection(residentV11, [evidenceFor(residentV11, "metadata_validation")]),
    );
    const fuller = computeTrustScore(
      buildGovernanceProjection(residentV11, [
        evidenceFor(residentV11, "metadata_validation"),
        evidenceFor(residentV11, "human_review"),
        evidenceFor(residentV11, "source_permission"),
      ]),
    );

    expect(fuller.score).toBeGreaterThan(partial.score);
    expect(fuller.dimensions.find((d) => d.key === "review")?.status).toBe("passed");
  });

  it("never reports a reference-only version as needing execution gates", () => {
    const trust = computeTrustScore(buildGovernanceProjection(residentV11, []));
    const security = trust.dimensions.find((dimension) => dimension.key === "security");

    expect(security?.status).toBe("not_required");
  });

  it("caps the score when the newest evidence is stale", () => {
    const stale = {
      ...evidenceFor(residentV11, "metadata_validation"),
      timestamp: "2026-09-01T12:00:00Z",
    };
    const trust = computeTrustScore(
      buildGovernanceProjection(residentV11, [stale]),
      new Date("2026-09-16T12:00:00Z"),
    );

    expect(trust.score).toBeLessThanOrEqual(79);
    expect(trust.dimensions.find((d) => d.key === "freshness")?.status).toBe("attention");
  });
});

describe("content diff", () => {
  it("reports exactly the fields that differ between two frozen versions", () => {
    const changed = changedContentFields(residentV11, residentV1);

    expect(changed).toContain("capabilities");
    expect(changed).toContain("summary");
    expect(changed).not.toContain("asset_version_id");
    expect(changed).not.toContain("version");
    expect(changed).not.toContain("owner");
  });
});

describe("investigation report", () => {
  const subject: InvestigationSubject = {
    record: residentV11,
    evidence: [evidenceFor(residentV11, "metadata_validation")],
    executions: [],
    previous: {
      record: residentV1,
      evidence: [
        evidenceFor(residentV1, "metadata_validation"),
        evidenceFor(residentV1, "human_review"),
        evidenceFor(residentV1, "source_permission"),
      ],
    },
  };

  it("derives every observation from persisted records and keeps inference separate", async () => {
    const report = await buildInvestigationReport(subject, {
      now: new Date("2026-09-16T18:00:00Z"),
    });

    expect(report.severity).toBe("critical");
    expect(report.observations.length).toBeGreaterThan(0);
    expect(report.observations.join(" ")).toContain("No person has reviewed");
    expect(report.changed_fields).toContain("capabilities");
    // The deterministic fallback runs whenever no provider is supplied.
    expect(report.ai.state).toBe("disabled");
    expect(report.inference).not.toBe("");
    expect(report.inference).not.toBe(report.observations[0]);
  });

  it("shows the trust delta against the previous published version", async () => {
    const report = await buildInvestigationReport(subject, {
      now: new Date("2026-09-16T18:00:00Z"),
    });

    expect(report.baseline).not.toBeNull();
    expect(report.baseline?.asset_version).toBe("1.0.0");
    expect(report.trust.score).toBeLessThan(report.baseline!.score);
    const trustSignal = report.signals.find((signal) => signal.key === "trust");
    expect(trustSignal?.direction).toBe("down");
    expect(trustSignal?.severity).toBe("critical");
  });

  it("offers only actions that perform a real state change or navigation", async () => {
    const report = await buildInvestigationReport(subject, {
      now: new Date("2026-09-16T18:00:00Z"),
    });

    const executable = report.actions.filter((action) => action.endpoint !== null);
    expect(executable.length).toBeGreaterThan(0);
    for (const action of executable) {
      expect(action.method).toBe("POST");
      expect(action.endpoint).toMatch(/^\/api\/governance\/versions\//);
    }
    expect(report.actions.map((action) => action.key)).toContain("flag_for_review");
  });

  it("falls back to the deterministic interpretation when the model is unavailable", async () => {
    const report = await buildInvestigationReport(subject, {
      now: new Date("2026-09-16T18:00:00Z"),
      provider: {
        infer: async () => ({
          inference: "",
          recommendation: "",
          state: "unavailable",
          modelOrConfig: null,
          reason: "Provider offline.",
        }),
      },
    });

    const fallback = deterministicInference(subject, "critical", report.changed_fields);
    expect(report.ai.state).toBe("unavailable");
    expect(report.inference).toBe(fallback.inference);
    expect(report.recommendation).toBe(fallback.recommendation);
  });

  it("never lets a model add a governance fact to the observation list", async () => {
    const report = await buildInvestigationReport(subject, {
      now: new Date("2026-09-16T18:00:00Z"),
      provider: {
        infer: async () => ({
          inference: "This asset was approved by the security team on 1 January.",
          recommendation: "Publish immediately.",
          state: "ready",
          modelOrConfig: "test-model",
          reason: null,
        }),
      },
    });

    expect(report.inference).toContain("approved by the security team");
    // The claim stays inside the labelled inference field and never reaches observations.
    expect(report.observations.join(" ")).not.toContain("approved by the security team");
    expect(report.ai.state).toBe("ready");
    expect(report.ai.model_or_config).toBe("test-model");
  });

  it("reports a fully gated version as healthy without inventing a problem", async () => {
    const evidence = (
      ["metadata_validation", "human_review", "source_permission"] as const
    ).map((type) => evidenceFor(residentV1, type));
    const report = await buildInvestigationReport(
      { record: residentV1, evidence, executions: [], previous: null },
      { now: new Date("2026-09-16T13:00:00Z") },
    );

    expect(report.severity).toBe("info");
    expect(report.headline).toContain("passed all of its required checks");
    expect(report.subheadline).toContain("exactly the content published today");
    expect(report.impact).toContain("You can use");
  });
});

describe("hero fixture", () => {
  it("binds the runnable hero to a reviewed executor and two distinct scenarios", () => {
    const version = heroDraftRecord.asset_version;

    expect(version.availability).toBe("runnable");
    expect(version.execution_kind).toBe("deterministic");
    expect(version.executor_key).toBe("property_ops.brief_builder");
    expect(version.definition_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(version.test_scenarios).toHaveLength(2);
    expect(version.test_scenarios[0]!.scenario_id).not.toBe(
      version.test_scenarios[1]!.scenario_id,
    );
  });
});
