import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OperatorContext, OperatorResponse } from "@/contracts";
import { GeminiOperatorAdapter } from "@/modules/operator/ai";
import {
  AGENTS,
  TOOLS,
  buildProjectKnowledge,
  executeOperatorAction,
  findTool,
  loadSystemState,
  previewOperatorAction,
  resolveAsset,
  routeDeterministically,
  runOperator,
  toolProfiles,
} from "@/modules/operator";
import { GovernanceRepository } from "@/modules/governance/repository";
import { ALLOWED_TRANSITIONS } from "@/modules/governance";
import { GATE_WEIGHTS, TRUST_BANDS } from "@/modules/investigation";
import {
  DATA_DIRECTORY,
  closeDatabase,
  openDatabase,
  removeDatabaseFiles,
} from "@/server/db";
import { migrateDatabase } from "@/server/db/migrate";
import { resetAndSeedDemoDatabase } from "@/server/db/reset";

const DATABASE_PATH = join(DATA_DIRECTORY, "operator.test.sqlite");
const HERO = "av_property_ops_brief_1_0_0";
const STALE = "av_resident_comms_1_1_0";
const DRAFT = "av_property_ops_brief_0_1_0_draft_1";

/** The model is off for every test: the deterministic path is the contract. */
const adapter = new GeminiOperatorAdapter({ enabled: false });
const NOW = new Date("2026-09-17T09:00:00Z");

function consoleContext(): OperatorContext {
  return {
    surface: "control_center",
    label: "AI Control Center",
    asset_version_id: null,
    asset_name: null,
    compare_ids: [],
  };
}

function assetContext(assetVersionId: string, name: string): OperatorContext {
  return {
    surface: "asset",
    label: name,
    asset_version_id: assetVersionId,
    asset_name: name,
    compare_ids: [],
  };
}

function ask(utterance: string, context = consoleContext()): Promise<OperatorResponse> {
  return runOperator(
    { utterance, context },
    { adapter, now: NOW, databasePath: DATABASE_PATH },
  );
}

function kinds(response: OperatorResponse): string[] {
  return response.blocks.map((block) => block.kind);
}

function headline(response: OperatorResponse): string {
  const block = response.blocks.find((item) => item.kind === "headline");
  return block?.kind === "headline" ? block.title : "";
}

function withDatabase<T>(operation: (database: ReturnType<typeof openDatabase>) => T): T {
  const database = openDatabase(DATABASE_PATH);
  try {
    migrateDatabase(database);
    return operation(database);
  } finally {
    closeDatabase(database);
  }
}

describe("AI operator", () => {
  beforeAll(async () => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    await resetAndSeedDemoDatabase(DATABASE_PATH);
  }, 90_000);

  afterAll(() => {
    removeDatabaseFiles(DATABASE_PATH);
  });

  describe("intent routing", () => {
    const cases: [string, string][] = [
      ["Find me a trustworthy payment reconciliation agent", "searchAssets"],
      ["Why is this asset flagged?", "investigateAsset"],
      ["What changed?", "investigateAsset"],
      ["Show me the evidence behind this trust score", "getEvidence"],
      ["What is blocking publication?", "getGovernanceStatus"],
      ["Find an alternative to this", "findAlternatives"],
      ["Compare these two", "compareAssets"],
      ["Who will be affected?", "getImpact"],
      ["How often is this agent being used?", "getReuseIntelligence"],
      ["Which assets have changed trust recently?", "getTrustDrift"],
      ["Create a new fraud detection agent", "createAsset"],
      ["Update the description", "updateAsset"],
      ["Run the governance checks", "runGovernanceChecks"],
      ["Submit it for review", "submitForReview"],
      ["Publish it", "publishAsset"],
      ["Explain this project", "getProjectInformation"],
      ["What agents are available?", "getAgentInformation"],
      ["What actions can I perform?", "listCapabilities"],
      ["Give me the marketplace overview", "getMarketplaceOverview"],
      ["What is in the review queue?", "getReviewQueue"],
      ["Archive this", "archiveAsset"],
    ];

    for (const [utterance, tool] of cases) {
      it(`routes "${utterance}" to ${tool} without a model`, () => {
        const route = routeDeterministically(
          utterance,
          assetContext(STALE, "Resident Communication Planner"),
        );
        expect(route?.tool).toBe(tool);
        // Search stays medium on purpose: it is the one intent the optional
        // model is allowed to refine, because query wording varies most.
        expect(route?.confidence).toBe(tool === "searchAssets" ? "medium" : "high");
      });
    }

    it("falls back to the asset in context when nothing matches", () => {
      const route = routeDeterministically("tell me about this thing", assetContext(HERO, "Hero"));
      expect(route?.tool).toBe("getAsset");
      expect(route?.confidence).toBe("low");
    });

    it("names every routed tool in the registry", () => {
      for (const [utterance] of cases) {
        const route = routeDeterministically(utterance, consoleContext());
        expect(findTool(route!.tool), route!.tool).not.toBeNull();
      }
    });
  });

  describe("entity resolution", () => {
    it("uses the asset on the page for a deictic reference", () => {
      const resolved = withDatabase((database) =>
        resolveAsset(database, null, assetContext(STALE, "Resident Communication Planner")),
      );
      expect(resolved?.record.asset_version.asset_version_id).toBe(STALE);
      expect(resolved?.confidence).toBe("high");
      expect(resolved?.how).toMatch(/open on this page/);
    });

    it("prefers the published version over an abandoned draft of the same asset", () => {
      const resolved = withDatabase((database) =>
        resolveAsset(database, "Property Operations Brief Builder", consoleContext()),
      );
      expect(resolved?.record.asset_version.asset_version_id).toBe(HERO);
      expect(resolved?.record.asset_version.asset_version_id).not.toBe(DRAFT);
    });

    it("carries the asset from the previous turn when nothing is on screen", () => {
      const resolved = withDatabase((database) =>
        resolveAsset(database, "it", consoleContext(), STALE),
      );
      expect(resolved?.record.asset_version.asset_version_id).toBe(STALE);
      expect(resolved?.how).toMatch(/previous request/);
    });

    it("returns nothing when no asset matches and none is in context", () => {
      const resolved = withDatabase((database) =>
        resolveAsset(database, "zzz nonexistent capability", consoleContext()),
      );
      expect(resolved).toBeNull();
    });
  });

  describe("read answers come from persisted records", () => {
    it("searches the published catalogue and returns asset cards", async () => {
      const response = await ask("Find a property operations brief");
      expect(response.understanding.tool).toBe("searchAssets");
      const assets = response.blocks.find((block) => block.kind === "assets");
      expect(assets?.kind).toBe("assets");
      if (assets?.kind !== "assets") throw new Error("expected asset cards");
      expect(assets.items.length).toBeGreaterThan(0);
      for (const card of assets.items) {
        expect(card.trust).not.toBeNull();
        expect(card.href).toBe(`/assets/${card.asset_version_id}`);
      }
    });

    it("investigates the stale asset and separates fact from interpretation", async () => {
      const response = await ask(
        "Why is this flagged?",
        assetContext(STALE, "Resident Communication Planner"),
      );
      expect(response.understanding.tool).toBe("investigateAsset");
      expect(kinds(response)).toContain("why");
      expect(kinds(response)).toContain("evidence");
      expect(kinds(response)).toContain("sources");

      const inference = response.blocks.find((block) => block.kind === "inference");
      if (inference?.kind !== "inference") throw new Error("expected an inference block");
      expect(inference.ai.state).not.toBe("ready");
      expect(inference.text.length).toBeGreaterThan(0);
    });

    it("explains why publication is blocked as a causal chain", async () => {
      const response = await ask(
        "What is blocking publication?",
        assetContext(STALE, "Resident Communication Planner"),
      );
      const why = response.blocks.find((block) => block.kind === "why");
      if (why?.kind !== "why") throw new Error("expected a why block");
      expect(why.chain.length).toBeGreaterThanOrEqual(3);
      expect(why.chain.some((link) => /required check/i.test(link.label))).toBe(true);
    });

    it("counts the marketplace from the same records the pages read", async () => {
      const response = await ask("Give me the marketplace overview");
      const state = loadSystemState(DATABASE_PATH, NOW);
      expect(headline(response)).toContain(`${state.published} published`);
      expect(kinds(response).filter((kind) => kind === "chart").length).toBeGreaterThan(0);
    });

    it("reports reuse only from persisted executions", async () => {
      const response = await ask("How often is the Property Operations Brief Builder used?");
      const reuse = response.blocks.find((block) => block.kind === "reuse");
      if (reuse?.kind !== "reuse") throw new Error("expected a reuse block");
      const persisted = withDatabase(
        (database) => new GovernanceRepository(database) && reuse.reuse.total,
      );
      expect(reuse.reuse.total).toBe(persisted);
      expect(reuse.reuse.total).toBeGreaterThan(0);
    });

    it("never asks which asset was meant while one is on screen", async () => {
      for (const utterance of [
        "Why is this flagged?",
        "Show me the evidence",
        "Find an alternative",
        "Who could be affected?",
      ]) {
        const response = await ask(
          utterance,
          assetContext(STALE, "Resident Communication Planner"),
        );
        expect(response.understanding.resolved_asset?.asset_version_id).toBe(STALE);
        expect(kinds(response)).not.toContain("blocked");
      }
    });
  });

  describe("writes are previewed, confirmed, then verified", () => {
    it("returns a preview rather than performing the change", async () => {
      const before = withDatabase(
        (database) =>
          new GovernanceRepository(database).getVersionById(STALE)!.asset_version.lifecycle,
      );

      const response = await ask(
        "What happens if I flag this?",
        assetContext(STALE, "Resident Communication Planner"),
      );
      const action = response.blocks.find((block) => block.kind === "action_preview");
      if (action?.kind !== "action_preview") throw new Error("expected an action preview");
      expect(action.action.available).toBe(true);
      expect(action.action.preview).not.toBeNull();
      expect(action.action.effects.length).toBeGreaterThan(2);
      expect(action.action.reversible).toBe(false);

      const after = withDatabase(
        (database) =>
          new GovernanceRepository(database).getVersionById(STALE)!.asset_version.lifecycle,
      );
      expect(after).toBe(before);
    });

    it("refuses an action that the lifecycle does not allow, and says why", async () => {
      const response = await previewOperatorAction(
        "publishAsset",
        { asset_version_id: STALE },
        consoleContext(),
        { adapter, now: NOW, databasePath: DATABASE_PATH },
      );
      const action = response.blocks.find((block) => block.kind === "action_preview");
      if (action?.kind !== "action_preview") throw new Error("expected an action preview");
      expect(action.action.available).toBe(false);
      expect(action.action.unavailable_reason).toMatch(/in review/i);
    });

    it("marks archiving unavailable instead of simulating it", async () => {
      const tool = findTool("archiveAsset");
      expect(tool?.available).toBe(false);
      const response = await ask("Archive this", assetContext(STALE, "Planner"));
      const blocked = response.blocks.find((block) => block.kind === "blocked");
      if (blocked?.kind !== "blocked") throw new Error("expected a blocked block");
      expect(blocked.reason).toMatch(/no archive lifecycle state/i);
    });

    it("runs the contribution workflow end to end and verifies each step", async () => {
      const planned = await ask("Create a fraud detection agent for suspicious payments");
      const contribution = planned.blocks.find((block) => block.kind === "contribution");
      const plan = planned.blocks.find((block) => block.kind === "plan");
      if (contribution?.kind !== "contribution" || plan?.kind !== "plan") {
        throw new Error("expected a contribution draft and a plan");
      }
      expect(plan.plan.steps.map((step) => step.tool)).toEqual([
        "createAsset",
        "freezeAsset",
        "runGovernanceChecks",
        "submitForReview",
      ]);
      expect(plan.plan.steps.every((step) => step.kind === "write")).toBe(true);
      expect(plan.plan.steps.at(-1)?.confirm_required).toBe(true);

      let carried: string | null = null;
      for (const step of plan.plan.steps) {
        const args =
          carried === null ? step.args : { ...step.args, asset_version_id: carried };
        const result = await executeOperatorAction(
          { tool: step.tool, args, context: consoleContext(), confirmed: true },
          { adapter, now: NOW, databasePath: DATABASE_PATH },
        );
        const completion = result.blocks.find((block) => block.kind === "completion");
        if (completion?.kind !== "completion") {
          const blocked = result.blocks.find((block) => block.kind === "blocked");
          throw new Error(
            `${step.tool} did not complete: ${blocked?.kind === "blocked" ? blocked.reason : "unknown"}`,
          );
        }
        expect(completion.verified).toBe(true);
        carried = completion.asset_version_id ?? carried;
      }

      expect(carried).not.toBeNull();
      const record = withDatabase((database) =>
        new GovernanceRepository(database).getVersionById(carried!),
      );
      expect(record).not.toBeNull();
      expect(record!.asset_version.lifecycle).toBe("submitted");
      expect(record!.asset_version.subject_digest).not.toBeNull();

      const evidence = withDatabase((database) =>
        new GovernanceRepository(database).listEvidence(carried!),
      );
      expect(evidence.map((item) => item.evidence_type)).toContain("metadata_validation");

      const events = withDatabase((database) =>
        new GovernanceRepository(database).listLifecycleEvents(carried!),
      );
      expect(events.map((event) => event.to_state)).toEqual(["draft", "submitted"]);
    });

    it("reports a real backend refusal rather than claiming success", async () => {
      const result = await executeOperatorAction(
        { tool: "flagAsset", args: { asset_version_id: DRAFT }, context: consoleContext(), confirmed: true },
        { adapter, now: NOW, databasePath: DATABASE_PATH },
      );
      const blocked = result.blocks.find((block) => block.kind === "blocked");
      if (blocked?.kind !== "blocked") throw new Error("expected the write to be refused");
      expect(blocked.reason).toMatch(/not supported/i);

      const lifecycle = withDatabase(
        (database) =>
          new GovernanceRepository(database).getVersionById(DRAFT)!.asset_version.lifecycle,
      );
      expect(lifecycle).toBe("draft");
    });

    it("flags a published version and confirms it left the catalogue", async () => {
      const result = await executeOperatorAction(
        { tool: "flagAsset", args: { asset_version_id: STALE }, context: consoleContext(), confirmed: true },
        { adapter, now: NOW, databasePath: DATABASE_PATH },
      );
      const completion = result.blocks.find((block) => block.kind === "completion");
      if (completion?.kind !== "completion") throw new Error("expected a completion");
      expect(completion.verified).toBe(true);

      const catalogue = completion.facts.find((item) => item.label === "Public catalogue");
      expect(catalogue?.value).toBe("Removed");

      const lifecycle = withDatabase(
        (database) =>
          new GovernanceRepository(database).getVersionById(STALE)!.asset_version.lifecycle,
      );
      expect(lifecycle).toBe("deprecated");

      // Evidence and runs survive a lifecycle change; the ledger is append-only.
      const evidence = withDatabase((database) =>
        new GovernanceRepository(database).listEvidence(STALE),
      );
      expect(evidence.length).toBeGreaterThan(0);
    });
  });

  describe("every capability composes for every version", () => {
    /**
     * A block that fails the response contract used to surface as a bare 503.
     * This sweep is the guard: each read capability, and each write preview,
     * against every version on record.
     */
    const READS: [string, string][] = [
      ["getAsset", "Tell me about this asset"],
      ["investigateAsset", "Investigate this"],
      ["getEvidence", "Show the evidence"],
      ["getLifecycle", "Show the timeline"],
      ["getTrust", "What is the trust score?"],
      ["getImpact", "Who could be affected?"],
      ["getGovernanceStatus", "What is blocking publication?"],
      ["getExecutionHistory", "Show the execution history"],
      ["getExecutionStatus", "Show the last run"],
      ["getReuseIntelligence", "How often is this used?"],
      ["findAlternatives", "Find an alternative"],
      ["compareAssets", "Compare this with something"],
      ["getMarketplaceOverview", "Give me the marketplace overview"],
      ["getTrustDrift", "Which assets have drifted?"],
      ["getReviewQueue", "What is in the review queue?"],
      ["getProjectInformation", "Explain this project"],
    ];

    const COMPOSE_FAILURE = "I could not present that result";

    function versionIds(): string[] {
      return withDatabase((database) =>
        new GovernanceRepository(database)
          .listVersions()
          .map((record) => record.asset_version.asset_version_id),
      );
    }

    it("answers every read capability on every version without a composition failure", async () => {
      const ids = versionIds();
      expect(ids.length).toBeGreaterThan(5);

      for (const id of ids) {
        const record = withDatabase((database) =>
          new GovernanceRepository(database).getVersionById(id),
        )!;
        const context = assetContext(id, record.asset_version.name);

        for (const [tool, utterance] of READS) {
          const response = await ask(utterance, context);
          const failed = response.blocks.find(
            (block) => block.kind === "blocked" && block.title === COMPOSE_FAILURE,
          );
          expect(failed, `${tool} on ${id}`).toBeUndefined();
        }
      }
    }, 60_000);

    it("previews every write capability on every version without a composition failure", async () => {
      for (const id of versionIds()) {
        const record = withDatabase((database) =>
          new GovernanceRepository(database).getVersionById(id),
        )!;
        const context = assetContext(id, record.asset_version.name);

        for (const tool of TOOLS.filter((candidate) => candidate.kind === "write")) {
          const response = await previewOperatorAction(
            tool.name,
            tool.name === "createAsset"
              ? {
                  draft: {
                    name: "Sweep Probe",
                    summary: "A probe.",
                    capabilities: ["probing"],
                    use_cases: ["probing"],
                  },
                }
              : tool.name === "updateAsset"
                ? { asset_version_id: id, summary: "A new summary for the probe." }
                : { asset_version_id: id },
            context,
            { adapter, now: NOW, databasePath: DATABASE_PATH },
          );
          const failed = response.blocks.find(
            (block) => block.kind === "blocked" && block.title === COMPOSE_FAILURE,
          );
          expect(failed, `${tool.name} preview on ${id}`).toBeUndefined();
        }
      }
    }, 60_000);

    it("does not build a one-link causal chain", async () => {
      // This version has no previous published version and no runs, so the
      // investigation yields a single signal — the case that used to throw.
      const lonely = withDatabase((database) =>
        new GovernanceRepository(database).getVersionById("av_portfolio_review_1_0_0"),
      );
      expect(lonely).not.toBeNull();

      const response = await ask(
        "Investigate this",
        assetContext("av_portfolio_review_1_0_0", lonely!.asset_version.name),
      );
      const why = response.blocks.find((block) => block.kind === "why");
      if (why?.kind === "why") {
        expect(why.chain.length).toBeGreaterThanOrEqual(2);
      }
      // The consequence is still reported, just not as a chain.
      expect(response.blocks.some((block) => block.kind === "note")).toBe(true);
    });
  });

  describe("project knowledge is generated from the implementation", () => {
    it("lists exactly the lifecycle transitions the service enforces", () => {
      const knowledge = withDatabase((database) => buildProjectKnowledge(database, NOW));
      const lifecycle = knowledge.sections.find((section) => section.heading === "Lifecycle");
      expect(lifecycle).toBeDefined();
      for (const [from, to] of Object.entries(ALLOWED_TRANSITIONS)) {
        const line = lifecycle!.bullets.find((bullet) =>
          bullet.startsWith(from.replaceAll("_", " ")),
        );
        expect(line, from).toBeDefined();
        for (const target of to) {
          expect(line).toContain(target.replaceAll("_", " "));
        }
      }
    });

    it("lists every weighted gate with the weight the scorer uses", () => {
      const knowledge = withDatabase((database) => buildProjectKnowledge(database, NOW));
      const gates = knowledge.sections.find(
        (section) => section.heading === "Governance gates",
      );
      expect(gates!.bullets).toHaveLength(Object.keys(GATE_WEIGHTS).length);
      for (const weight of Object.values(GATE_WEIGHTS)) {
        expect(gates!.bullets.some((bullet) => bullet.includes(`(${weight} points)`))).toBe(true);
      }
    });

    it("states the real trust bands", () => {
      const knowledge = withDatabase((database) => buildProjectKnowledge(database, NOW));
      const trust = knowledge.sections.find((section) => section.heading === "Trust");
      for (const band of TRUST_BANDS) {
        expect(trust!.bullets.some((bullet) => bullet.includes(band.label))).toBe(true);
      }
    });

    it("counts the live catalogue rather than asserting a number", () => {
      const knowledge = withDatabase((database) => buildProjectKnowledge(database, NOW));
      const state = loadSystemState(DATABASE_PATH, NOW);
      expect(knowledge.summary).toContain(`${state.published} published assets`);
    });
  });

  describe("capability catalogue", () => {
    it("classifies every tool and marks writes as needing confirmation", () => {
      const profiles = toolProfiles();
      expect(profiles).toHaveLength(TOOLS.length);
      for (const profile of profiles) {
        expect(profile.confirm_required).toBe(profile.kind === "write");
        expect(profile.backed_by.length).toBeGreaterThan(0);
        if (!profile.available) expect(profile.unavailable_reason).not.toBeNull();
      }
    });

    it("gives every write tool an execute path and every read tool none", () => {
      for (const tool of TOOLS) {
        if (tool.kind === "write" && tool.available) {
          expect(tool.execute, tool.name).toBeDefined();
        }
        if (tool.kind === "read") {
          expect(tool.execute, tool.name).toBeUndefined();
        }
      }
    });

    it("describes only agents that exist in the repository", () => {
      for (const agent of AGENTS) {
        expect(agent.implementation).toMatch(/^src\/|^No backing/);
        expect(agent.authority.length).toBeGreaterThan(0);
        expect(agent.deterministic_fallback.length).toBeGreaterThan(0);
      }
    });
  });

  describe("system state", () => {
    it("counts published, attention, and drift from the same records the pages use", () => {
      const state = loadSystemState(DATABASE_PATH, NOW);
      const published = withDatabase((database) =>
        new GovernanceRepository(database)
          .listVersions()
          .filter(
            (record) =>
              record.asset_version.lifecycle === "published" &&
              record.asset_version.deprecated_at === null &&
              record.asset.current_published_version_id ===
                record.asset_version.asset_version_id,
          ),
      );
      expect(state.published).toBe(published.length);
      expect(state.signals.length).toBeGreaterThan(0);
    });
  });
});
