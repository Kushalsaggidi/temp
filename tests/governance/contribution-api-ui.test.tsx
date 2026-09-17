import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createContribution } from "@/app/api/governance/contributions/route";
import { GET as getGovernanceVersion } from "@/app/api/governance/versions/[assetVersionId]/route";
import { POST as transitionVersion } from "@/app/api/governance/versions/[assetVersionId]/transitions/route";
import { GET as getPublicCatalog } from "@/app/api/catalog/route";
import { ContributionForm } from "@/components/governance/contribution-form";
import { GovernancePanel } from "@/components/governance/governance-panel";
import { computeTrustScore } from "@/modules/investigation";
import {
  MetadataAssistanceService,
  withGovernanceService,
} from "@/modules/governance";
import {
  DATA_DIRECTORY,
  closeDatabase,
  migrateDatabase,
  openDatabase,
  removeDatabaseFiles,
} from "@/server/db";

import { contributionPayload } from "./test-support";

describe("contribution and governance HTTP/UI", () => {
  let databasePath: string;
  let previousDatabasePath: string | undefined;

  beforeEach(() => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    databasePath = join(
      DATA_DIRECTORY,
      `governance-api-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    removeDatabaseFiles(databasePath);
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = databasePath;
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
    } finally {
      closeDatabase(database);
    }
  });

  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    removeDatabaseFiles(databasePath);
  });

  it("creates and submits a valid non-runnable draft while public browse stays empty", async () => {
    const createResponse = await createContribution(
      new Request("http://marketplace.test/api/governance/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contributionPayload()),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      asset_version: {
        asset_version_id: string;
        lifecycle: string;
        availability: string;
        execution_kind: string;
        executor_key?: string;
      };
    };
    expect(created.asset_version).toMatchObject({
      lifecycle: "draft",
      availability: "reference_only",
      execution_kind: "none",
    });
    expect(created.asset_version).not.toHaveProperty("executor_key");

    const context = {
      params: Promise.resolve({ assetVersionId: created.asset_version.asset_version_id }),
    };
    const transitionResponse = await transitionVersion(
      new Request("http://marketplace.test/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_state: "submitted",
          actor_type: "team_member",
          actor_name: "Casey Contributor",
          reason: "The contribution metadata is complete.",
        }),
      }),
      context,
    );
    expect(transitionResponse.status).toBe(200);
    expect((await transitionResponse.json()).asset_version.lifecycle).toBe("submitted");

    const detailResponse = await getGovernanceVersion(
      new Request("http://marketplace.test/detail"),
      context,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.events.map((event: { to_state: string }) => event.to_state)).toEqual([
      "draft",
      "submitted",
    ]);
    expect(detail.prototype_limitation).toMatch(/authentication is not implemented/i);

    const publicResponse = await getPublicCatalog();
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toEqual({ items: [], count: 0 });
  });

  it("returns actionable validation errors and blocks metadata-created execution", async () => {
    const invalidResponse = await createContribution(
      new Request("http://marketplace.test/api/governance/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "Bad Slug", actor_name: "", content: {} }),
      }),
    );
    expect(invalidResponse.status).toBe(422);
    const invalid = await invalidResponse.json();
    expect(invalid.error.code).toBe("invalid_contribution");
    expect(invalid.error.issues.length).toBeGreaterThan(2);
    expect(invalid.error.issues.some((issue: { path: string }) => issue.path.includes("slug"))).toBe(true);

    const payload = contributionPayload();
    const created = await withGovernanceService((service) =>
      service.createContribution(payload),
    );
    const content = { ...created.asset_version } as Record<string, unknown>;
    delete content.lifecycle;
    delete content.subject_digest;
    delete content.published_at;
    delete content.deprecated_at;
    delete content.replacement_version;
    content.availability = "runnable";
    content.execution_kind = "deterministic";
    content.executor_key = "forged.executor";
    content.definition_digest = `sha256:${"a".repeat(64)}`;
    await expect(
      withGovernanceService((service) =>
        service.updateEditableDraft(
          created.asset_version.asset_version_id,
          content,
        ),
      ),
    ).rejects.toMatchObject({ code: "contribution_cannot_add_executor" });
  });

  it("keeps optional AI assistance advisory and renders honest governance states", async () => {
    const assistance = new MetadataAssistanceService({
      state: "ready",
      async enhance() {
        return {
          state: "ready" as const,
          output: ["Add a more specific audience."],
          modelOrConfig: "test-adviser",
        };
      },
    });
    const result = await assistance.inspect({ metadata: { name: "Draft" } });
    expect(result.ai.suggestions).toEqual(["Add a more specific audience."]);
    expect(result.authority).toEqual({ can_approve: false, can_publish: false });

    const created = await withGovernanceService((service) =>
      service.createContribution(contributionPayload()),
    );
    const detail = await withGovernanceService((service) =>
      service.getDetail(created.asset_version.asset_version_id),
    );
    const trust = computeTrustScore(detail.projection);
    const governanceMarkup = renderToStaticMarkup(
      createElement(GovernancePanel, { detail, trust }),
    );
    expect(governanceMarkup).toContain("Not reviewed");
    expect(governanceMarkup).toContain("reference only");
    expect(governanceMarkup).toContain("Publication blocked");
    expect(governanceMarkup).not.toContain("Functionally tested</span>");
    // A contribution with no evidence can never read as trustworthy.
    expect(trust.score).toBeLessThan(65);

    const contributionMarkup = renderToStaticMarkup(createElement(ContributionForm));
    expect(contributionMarkup).toContain("Duplicate guard");
    expect(contributionMarkup).toContain(
      "stay out of public discovery until a named human reviewer records evidence",
    );
  });
});
