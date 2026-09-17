import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogRepository } from "@/modules/catalog";
import { GovernanceError, GovernanceRepository, GovernanceService } from "@/modules/governance";
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
  SequenceClock,
  SequenceIds,
  createGovernanceService,
  freezeBootstrap,
  recordReferencePublicationEvidence,
  transitionToReview,
} from "./test-support";

const VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

describe("governance lifecycle", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let service: GovernanceService;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `governance-lifecycle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    migrateDatabase(database);
    seedDatabase(database);
    freezeBootstrap(database);
    service = createGovernanceService(database);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  it("supports every allowed transition and keeps public visibility current", () => {
    service.transition(VERSION_ID, {
      to_state: "submitted",
      actor_type: "team_member",
      actor_name: "Casey Contributor",
      reason: "Ready for review.",
    });
    service.transition(VERSION_ID, {
      to_state: "in_review",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "Review started.",
    });
    service.transition(VERSION_ID, {
      to_state: "changes_requested",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "Clarify one limitation.",
    });
    service.transition(VERSION_ID, {
      to_state: "submitted",
      actor_type: "team_member",
      actor_name: "Casey Contributor",
      reason: "Requested clarification supplied.",
    });
    service.transition(VERSION_ID, {
      to_state: "in_review",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "Review restarted.",
    });

    recordReferencePublicationEvidence(service, VERSION_ID);
    expect(new CatalogRepository(database).listPublished()).toEqual([]);
    const published = service.transition(VERSION_ID, {
      to_state: "published",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "All exact-subject publication gates pass.",
      confirm_publication: true,
    });
    expect(published.asset_version.lifecycle).toBe("published");
    expect(published.asset.current_published_version_id).toBe(VERSION_ID);
    expect(new CatalogRepository(database).listPublished()).toHaveLength(1);

    const deprecated = service.transition(VERSION_ID, {
      to_state: "deprecated",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "The reference version is no longer recommended.",
    });
    expect(deprecated.asset_version.lifecycle).toBe("deprecated");
    expect(deprecated.asset.current_published_version_id).toBeNull();
    expect(new CatalogRepository(database).listPublished()).toEqual([]);

    const events = new GovernanceRepository(database).listLifecycleEvents(VERSION_ID);
    expect(events.map((event) => event.to_state)).toEqual([
      "draft",
      "submitted",
      "in_review",
      "changes_requested",
      "submitted",
      "in_review",
      "published",
      "deprecated",
    ]);
    expect(events.find((event) => event.to_state === "published")?.evidence_ids).toHaveLength(3);
  });

  it("rejects unsupported and non-reviewer transitions server-side", () => {
    expect(() =>
      service.transition(VERSION_ID, {
        to_state: "published",
        actor_type: "demo_reviewer",
        actor_name: "Riley Reviewer",
        reason: "Skip the workflow.",
        confirm_publication: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "unsupported_transition" }));

    service.transition(VERSION_ID, {
      to_state: "submitted",
      actor_type: "team_member",
      actor_name: "Casey Contributor",
      reason: "Ready.",
    });
    expect(() =>
      service.transition(VERSION_ID, {
        to_state: "in_review",
        actor_type: "team_member",
        actor_name: "Casey Contributor",
        reason: "Self-start review.",
      }),
    ).toThrowError(expect.objectContaining({ code: "reviewer_action_required" }));
  });

  it("rolls back the state projection when audit-event insertion fails", () => {
    const duplicateEventIds = {
      next(prefix: string) {
        return prefix === "event" ? "event_bootstrap_draft_created" : `${prefix}_duplicate_test`;
      },
    };
    const conflictService = new GovernanceService(
      new GovernanceRepository(database),
      new SequenceClock(),
      duplicateEventIds,
    );
    expect(() =>
      conflictService.transition(VERSION_ID, {
        to_state: "submitted",
        actor_type: "team_member",
        actor_name: "Casey Contributor",
        reason: "This event ID conflicts.",
      }),
    ).toThrowError(expect.objectContaining({ code: "transition_conflict" }));

    const repository = new GovernanceRepository(database);
    expect(repository.getVersionById(VERSION_ID)?.asset_version.lifecycle).toBe("draft");
    expect(repository.listLifecycleEvents(VERSION_ID)).toHaveLength(1);
  });

  it("blocks missing, mismatched, and superseded non-passing evidence", () => {
    transitionToReview(service, VERSION_ID);
    expect(() =>
      service.transition(VERSION_ID, {
        to_state: "published",
        actor_type: "demo_reviewer",
        actor_name: "Riley Reviewer",
        reason: "Attempt without evidence.",
        confirm_publication: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "publication_gates_failed" }));

    const record = service.getDetail(VERSION_ID).record;
    expect(() =>
      service.recordEvidence(VERSION_ID, {
        evidence_id: "evidence_governance_wrong_digest",
        asset_id: record.asset.asset_id,
        asset_version_id: VERSION_ID,
        subject_digest: `sha256:${"f".repeat(64)}`,
        evidence_type: "human_review",
        scope: "Human prepublication review.",
        observed: { reviewed: true },
        result: "passed",
        actor_type: "demo_reviewer",
        actor_name: "Riley Reviewer",
        reviewer: { name: "Riley Reviewer" },
        timestamp: "2026-09-16T12:30:00Z",
        method: "Manual test record.",
        execution_ids: [],
        artifact_version: record.asset_version.version,
        details: {
          summary: "Wrong digest.",
          assertions: [{ name: "review", passed: true }],
        },
        limitations: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "evidence_digest_mismatch" }));

    expect(() =>
      service.recordEvidence(VERSION_ID, {
        evidence_id: "evidence_governance_wrong_artifact",
        asset_id: record.asset.asset_id,
        asset_version_id: VERSION_ID,
        subject_digest: record.asset_version.subject_digest,
        evidence_type: "human_review",
        scope: "Human prepublication review.",
        observed: { reviewed: true },
        result: "passed",
        actor_type: "demo_reviewer",
        actor_name: "Riley Reviewer",
        reviewer: { name: "Riley Reviewer" },
        timestamp: "2026-09-16T12:31:00Z",
        method: "Manual test record.",
        execution_ids: [],
        artifact_version: "9.9.9",
        details: {
          summary: "Wrong artifact version.",
          assertions: [{ name: "review", passed: true }],
        },
        limitations: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "evidence_artifact_version_mismatch" }),
    );

    service.runMetadataValidation(VERSION_ID);
    service.recordDemoReview(VERSION_ID, {
      review_type: "source_permission",
      result: "not_applicable",
      reviewer_name: "Morgan Source Reviewer",
      scope: "Source permission is not applicable for synthetic event-created material.",
      summary: "Not applicable for this synthetic event-created version.",
    });
    service.recordDemoReview(VERSION_ID, {
      review_type: "human_review",
      result: "passed",
      reviewer_name: "Riley Reviewer",
      scope: "Prepublication human review.",
      summary: "Initial review passed.",
    });
    service.recordDemoReview(VERSION_ID, {
      review_type: "human_review",
      result: "needs_changes",
      reviewer_name: "Riley Reviewer",
      scope: "Prepublication human review.",
      summary: "A newer review requires changes.",
    });
    const detail = service.getDetail(VERSION_ID);
    expect(detail.projection.reviewStatus).toBe("failed_or_needs_changes");
    expect(detail.projection.evidence.find(
      (item) => item.evidence.details.summary === "Initial review passed.",
    )?.state).toBe("superseded");
    expect(detail.projection.canPublish).toBe(false);
  });

  it("keeps published content immutable and creates a distinct editable draft", () => {
    transitionToReview(service, VERSION_ID);
    recordReferencePublicationEvidence(service, VERSION_ID);
    const published = service.transition(VERSION_ID, {
      to_state: "published",
      actor_type: "demo_reviewer",
      actor_name: "Riley Reviewer",
      reason: "Publish immutable reference version.",
      confirm_publication: true,
    });
    const originalContent = { ...published.asset_version, name: "Mutated in place" };
    expect(() => service.updateEditableDraft(VERSION_ID, originalContent)).toThrowError(
      expect.objectContaining({ code: "published_version_immutable" }),
    );

    const draft = service.createDraftFromPublished(VERSION_ID, {
      version: "0.2.0",
      actor_name: "Casey Maintainer",
      reason: "Propose a revised version without mutating the published record.",
    });
    expect(draft.asset_version.asset_version_id).not.toBe(VERSION_ID);
    expect(draft.asset_version.lifecycle).toBe("draft");
    expect(draft.asset_version.subject_digest).toBeNull();
    expect(draft.asset_version.version).toBe("0.2.0");
    expect(service.getDetail(draft.asset_version.asset_version_id).evidence).toEqual([]);
    expect(service.getDetail(VERSION_ID).record.asset_version.name).toBe(
      published.asset_version.name,
    );
    expect(new CatalogRepository(database).listPublished().map(
      (item) => item.asset_version.asset_version_id,
    )).toEqual([VERSION_ID]);
  });
});
