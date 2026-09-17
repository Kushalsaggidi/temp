import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceError, GovernanceRepository, type GovernanceService } from "@/modules/governance";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
  seedDatabase,
  type MarketplaceDatabase,
} from "@/server/db";
import { computeSubjectDigest } from "@/shared/integrity";

import { createGovernanceService } from "./test-support";

const VERSION_ID = "av_property_ops_brief_0_1_0_draft_1";

/**
 * Freezing is the step that makes a draft reviewable: evidence is bound to the
 * subject digest, so nothing can be checked until one exists, and nothing can
 * change afterwards.
 */
describe("freezing a version", () => {
  let database: MarketplaceDatabase;
  let databasePath: string;
  let service: GovernanceService;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `governance-freeze-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    database = openDatabase(databasePath);
    migrateDatabase(database);
    seedDatabase(database);
    service = createGovernanceService(database);
  });

  afterEach(() => {
    closeDatabase(database);
    removeDatabaseFiles(databasePath);
  });

  it("computes the digest from the exact stored content", () => {
    const before = new GovernanceRepository(database).getVersionById(VERSION_ID)!;
    expect(before.asset_version.subject_digest).toBeNull();

    const frozen = service.freezeVersion(VERSION_ID);
    const {
      lifecycle: _lifecycle,
      subject_digest: digest,
      published_at: _published,
      deprecated_at: _deprecated,
      replacement_version: _replacement,
      ...content
    } = frozen.asset_version;

    expect(digest).not.toBeNull();
    expect(digest).toBe(computeSubjectDigest(content));
  });

  it("refuses to record evidence before the content is locked", () => {
    expect(() => service.runMetadataValidation(VERSION_ID)).toThrowError(GovernanceError);
    try {
      service.runMetadataValidation(VERSION_ID);
    } catch (error) {
      expect((error as GovernanceError).code).toBe("subject_not_frozen");
    }

    service.freezeVersion(VERSION_ID);
    const evidence = service.runMetadataValidation(VERSION_ID);
    expect(evidence.evidence_type).toBe("metadata_validation");
    expect(evidence.subject_digest).toBe(
      new GovernanceRepository(database).getVersionById(VERSION_ID)!.asset_version
        .subject_digest,
    );
  });

  it("is one way: a frozen version cannot be frozen again or edited", () => {
    const frozen = service.freezeVersion(VERSION_ID);

    expect(() => service.freezeVersion(VERSION_ID)).toThrowError(GovernanceError);
    try {
      service.freezeVersion(VERSION_ID);
    } catch (error) {
      expect((error as GovernanceError).code).toBe("version_already_frozen");
    }

    const {
      lifecycle: _lifecycle,
      subject_digest: _digest,
      published_at: _published,
      deprecated_at: _deprecated,
      replacement_version: _replacement,
      ...content
    } = frozen.asset_version;
    expect(() =>
      service.updateEditableDraft(VERSION_ID, { ...content, summary: "Edited after freeze." }),
    ).toThrowError(GovernanceError);
  });

  it("refuses to freeze a version that has left the editable states", () => {
    service.freezeVersion(VERSION_ID);
    service.transition(VERSION_ID, {
      to_state: "submitted",
      actor_type: "team_member",
      actor_name: "Casey Contributor",
      reason: "Ready for review.",
    });

    try {
      service.freezeVersion(VERSION_ID);
      throw new Error("expected the freeze to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(GovernanceError);
      // Lifecycle is the more fundamental reason, so it is reported first.
      expect((error as GovernanceError).code).toBe("version_not_freezable");
    }
  });

  it("reports a missing version rather than creating one", () => {
    try {
      service.freezeVersion("av_does_not_exist");
      throw new Error("expected a not-found error");
    } catch (error) {
      expect(error).toBeInstanceOf(GovernanceError);
      expect((error as GovernanceError).status).toBe(404);
    }
  });
});
