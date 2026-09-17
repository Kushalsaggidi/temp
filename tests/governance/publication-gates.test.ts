import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceService } from "@/modules/governance";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";

import {
  createGovernanceService,
  evidenceForExecution,
  freezeBootstrap,
  insertExecution,
  transitionToReview,
} from "./test-support";

const VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

describe("publication evidence gates", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let service: GovernanceService;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `governance-gates-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    migrateDatabase(database);
    seedDatabase(database);
    freezeBootstrap(database, { runnable: true });
    service = createGovernanceService(database);
    transitionToReview(service, VERSION_ID);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  it("publishes a runnable version only after all exact-subject execution and human gates pass", () => {
    const record = service.getDetail(VERSION_ID).record;
    const functional = insertExecution(
      database,
      record,
      "execution_governance_functional",
      "succeeded",
    );
    const guardrail = insertExecution(
      database,
      record,
      "execution_governance_guardrail",
      "blocked",
    );
    const reuseSecond = insertExecution(
      database,
      record,
      "execution_governance_reuse_second",
      "succeeded",
    );

    service.runMetadataValidation(VERSION_ID);
    service.recordEvidence(
      VERSION_ID,
      evidenceForExecution(
        record,
        "functional_test",
        [functional.execution_id],
      ),
    );
    service.recordEvidence(
      VERSION_ID,
      evidenceForExecution(
        record,
        "reuse_test",
        [functional.execution_id, reuseSecond.execution_id],
      ),
    );
    service.recordEvidence(
      VERSION_ID,
      evidenceForExecution(
        record,
        "guardrail_test",
        [guardrail.execution_id],
      ),
    );
    service.recordDemoReview(VERSION_ID, {
      review_type: "source_permission",
      result: "passed",
      reviewer_name: "Morgan Source Reviewer",
      scope: "Source and permission decisions for synthetic event-created material.",
      summary: "The named reviewer confirmed the documented source-permission outcome.",
    });
    service.recordDemoReview(VERSION_ID, {
      review_type: "human_review",
      result: "passed",
      reviewer_name: "Riley Reviewer",
      scope: "Human prepublication review of the exact runnable version.",
      summary: "The exact frozen runnable version passed human review.",
    });
    service.recordDemoReview(VERSION_ID, {
      review_type: "security_review",
      result: "passed",
      reviewer_name: "Riley Reviewer",
      reviewer_role: "Prepublication reviewer",
      scope: "Scoped prepublication security and data-handling review.",
      summary: "The named prepublication reviewer accepted the scoped security and data-handling review.",
      accept_scoped_security_review: true,
    });

    const detail = service.getDetail(VERSION_ID);
    expect(detail.projection.canPublish).toBe(true);
    expect(detail.projection.gates.every(
      (gate) => !gate.required || gate.status === "passed",
    )).toBe(true);
    expect(detail.projection.badges.map((badge) => badge.label)).toContain(
      "Functionally tested",
    );
    expect(detail.evidence.some((item) => item.evidence_type === "reuse_test")).toBe(true);

    const beforeContent = database
      .prepare("SELECT content_json, subject_digest FROM asset_versions WHERE asset_version_id = ?")
      .get(VERSION_ID) as { content_json: string; subject_digest: string };
    const published = service.transition(VERSION_ID, {
      to_state: "published",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "All runnable publication gates passed and the named reviewer explicitly publishes.",
      confirm_publication: true,
    });
    const afterContent = database
      .prepare("SELECT content_json, subject_digest FROM asset_versions WHERE asset_version_id = ?")
      .get(VERSION_ID) as { content_json: string; subject_digest: string };
    expect(published.asset_version.lifecycle).toBe("published");
    expect(afterContent).toEqual(beforeContent);
  });

  it("does not let missing execution evidence or an unaccepted security review satisfy runnable gates", () => {
    service.runMetadataValidation(VERSION_ID);
    service.recordDemoReview(VERSION_ID, {
      review_type: "source_permission",
      result: "passed",
      reviewer_name: "Morgan Source Reviewer",
      scope: "Source permission review.",
      summary: "Permissions passed.",
    });
    service.recordDemoReview(VERSION_ID, {
      review_type: "human_review",
      result: "passed",
      reviewer_name: "Riley Reviewer",
      scope: "Human review.",
      summary: "Human review passed.",
    });
    expect(() =>
      service.recordDemoReview(VERSION_ID, {
        review_type: "security_review",
        result: "passed",
        reviewer_name: "Different Reviewer",
        scope: "Security and data-handling review.",
        summary: "A different person attempted acceptance.",
        accept_scoped_security_review: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "security_acceptance_required" }));

    const detail = service.getDetail(VERSION_ID);
    expect(detail.projection.canPublish).toBe(false);
    expect(detail.projection.gates.find((gate) => gate.key === "functional_test")?.status).toBe("missing");
    expect(detail.projection.gates.find((gate) => gate.key === "guardrail_test")?.status).toBe("missing");
    expect(detail.projection.gates.find((gate) => gate.key === "security_review")?.status).toBe("missing");
  });

  it("rejects execution evidence that is failed, informational, or lacks persisted provenance", () => {
    const record = service.getDetail(VERSION_ID).record;
    const succeeded = insertExecution(
      database,
      record,
      "execution_governance_failed_evidence",
      "succeeded",
    );
    service.recordEvidence(
      VERSION_ID,
      evidenceForExecution(
        record,
        "functional_test",
        [succeeded.execution_id],
        "failed",
        "failed_functional",
      ),
    );
    let detail = service.getDetail(VERSION_ID);
    expect(detail.projection.gates.find((gate) => gate.key === "functional_test")?.status).toBe("failed");

    expect(() =>
      service.recordEvidence(
        VERSION_ID,
        evidenceForExecution(
          record,
          "guardrail_test",
          ["execution_governance_missing"],
          "passed",
          "missing_guardrail",
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: "execution_evidence_mismatch" }));

    const informational = {
      ...evidenceForExecution(
        record,
        "functional_test",
        [succeeded.execution_id],
        "passed",
        "informational_functional",
      ),
      result: "informational" as const,
    };
    service.recordEvidence(VERSION_ID, informational);
    detail = service.getDetail(VERSION_ID);
    expect(detail.projection.gates.find((gate) => gate.key === "functional_test")?.status).toBe("failed");
  });
});
