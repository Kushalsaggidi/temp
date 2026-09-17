import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  loadAlternatives,
  loadComparison,
  loadImpactGraph,
  loadImpactPreview,
  loadMarketplaceMetrics,
  loadReuseIntelligence,
  loadTrustDrift,
} from "@/modules/insights";
import { ExecutionRepository } from "@/modules/execution";
import { GovernanceRepository } from "@/modules/governance/repository";
import { DATA_DIRECTORY, closeDatabase, openDatabase, removeDatabaseFiles } from "@/server/db";
import { resetAndSeedDemoDatabase } from "@/server/db/reset";

const DATABASE_PATH = join(DATA_DIRECTORY, "insights.test.sqlite");
const HERO = "av_property_ops_brief_1_0_0";
const STALE = "av_resident_comms_1_1_0";
const PREVIOUS = "av_resident_comms_1_0_0";

describe("insights", () => {
  beforeAll(async () => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    await resetAndSeedDemoDatabase(DATABASE_PATH);
  }, 90_000);

  afterAll(() => {
    removeDatabaseFiles(DATABASE_PATH);
  });

  describe("impact preview", () => {
    it("states the real catalog effect of removing a published version", () => {
      const preview = loadImpactPreview(STALE, "flag_for_review", DATABASE_PATH);

      expect(preview).not.toBeNull();
      expect(preview!.available).toBe(true);
      expect(preview!.reversible).toBe(false);

      const catalog = preview!.affected.find((item) => item.label === "Public catalog entries");
      expect(catalog?.count).toBe(1);
      expect(catalog?.at_risk).toBe(true);
      expect(catalog?.detail).toMatch(/10 to 9/);

      // Evidence survives a lifecycle change and must never be described as lost.
      const evidence = preview!.affected.find((item) => item.label === "Evidence records");
      expect(evidence?.at_risk).toBe(false);
      expect(evidence!.count).toBeGreaterThan(0);
    });

    it("refuses to offer an action the lifecycle rules would reject", () => {
      const preview = loadImpactPreview(STALE, "publish", DATABASE_PATH);

      expect(preview!.available).toBe(false);
      expect(preview!.endpoint).toBeNull();
      expect(preview!.unavailable_reason).toBeTruthy();
    });

    it("marks a read-only check as changing nothing in the catalog", () => {
      const preview = loadImpactPreview(HERO, "metadata_validation", DATABASE_PATH);

      expect(preview!.available).toBe(true);
      expect(preview!.affected.every((item) => !item.at_risk)).toBe(true);
    });
  });

  describe("impact graph", () => {
    it("builds every node from a record that exists", () => {
      const graph = loadImpactGraph(HERO, DATABASE_PATH);
      const database = openDatabase(DATABASE_PATH);
      try {
        const evidence = new GovernanceRepository(database).listEvidence(HERO);
        const executions = new ExecutionRepository(database).listByAssetVersionId(HERO);

        const evidenceNodes = graph!.nodes.filter((node) => node.kind === "evidence");
        const executionNodes = graph!.nodes.filter((node) => node.kind === "execution");

        expect(evidenceNodes).toHaveLength(evidence.length);
        expect(executionNodes).toHaveLength(executions.length);

        const evidenceIds = new Set(evidence.map((row) => row.evidence_id));
        for (const node of evidenceNodes) expect(evidenceIds.has(node.id)).toBe(true);
      } finally {
        closeDatabase(database);
      }
    });

    it("labels an inferred relationship as derived and a stored one as not", () => {
      const graph = loadImpactGraph(HERO, DATABASE_PATH);
      const related = graph!.edges.filter((edge) => edge.label === "covers similar work");
      const stored = graph!.edges.filter((edge) => edge.label === "evidenced by");

      expect(related.every((edge) => edge.derived)).toBe(true);
      expect(stored.every((edge) => !edge.derived)).toBe(true);
    });

    it("connects every edge to a node that exists", () => {
      const graph = loadImpactGraph(STALE, DATABASE_PATH);
      const ids = new Set(graph!.nodes.map((node) => node.id));
      for (const edge of graph!.edges) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
      }
    });
  });

  describe("alternatives", () => {
    it("finds a genuinely better-checked asset covering the same job", () => {
      const result = loadAlternatives(STALE, DATABASE_PATH);

      expect(result!.alternatives.length).toBeGreaterThan(0);
      const top = result!.alternatives[0]!;
      expect(top.safer).toBe(true);
      expect(top.trust.score).toBeGreaterThan(result!.subject_trust);
      expect(top.similarity).toBeGreaterThan(30);
    });

    it("never offers the asset under investigation as its own alternative", () => {
      const result = loadAlternatives(STALE, DATABASE_PATH);
      expect(
        result!.alternatives.some((item) => item.asset_version_id === STALE),
      ).toBe(false);
    });
  });

  describe("reuse intelligence", () => {
    it("counts only persisted executions of that exact version", () => {
      const reuse = loadReuseIntelligence(HERO, DATABASE_PATH);
      const database = openDatabase(DATABASE_PATH);
      try {
        const executions = new ExecutionRepository(database).listByAssetVersionId(HERO);
        expect(reuse!.total).toBe(executions.length);
        expect(reuse!.succeeded).toBe(
          executions.filter((record) => record.status === "succeeded").length,
        );
        expect(reuse!.succeeded + reuse!.rejected).toBe(reuse!.total);
        expect(reuse!.user_runs + reuse!.prepublication_runs).toBe(reuse!.total);
      } finally {
        closeDatabase(database);
      }
    });

    it("names the dimension it cannot report instead of inventing one", () => {
      const reuse = loadReuseIntelligence(HERO, DATABASE_PATH);
      expect(reuse!.not_recorded.join(" ")).toMatch(/do not record who ran an asset/);
    });

    it("reports zero for an asset nobody has run", () => {
      const reuse = loadReuseIntelligence(STALE, DATABASE_PATH);
      expect(reuse!.total).toBe(0);
      expect(reuse!.reuse_proved).toBe(false);
      expect(reuse!.observation).toMatch(/Nobody has run this version yet/);
    });
  });

  describe("trust drift", () => {
    it("detects both a version change and aging evidence", () => {
      const drift = loadTrustDrift(DATABASE_PATH);

      expect(drift.entries.length).toBeGreaterThanOrEqual(2);
      const stale = drift.entries.find((entry) => entry.asset_version_id === STALE);
      expect(stale?.delta).toBeLessThan(0);
      expect(stale?.severity).toBe("critical");
    });

    it("plots only recorded states, each with a timestamp", () => {
      const drift = loadTrustDrift(DATABASE_PATH);
      for (const entry of drift.entries) {
        expect(entry.steps.length).toBeGreaterThanOrEqual(2);
        for (const step of entry.steps) {
          expect(Number.isNaN(Date.parse(step.timestamp))).toBe(false);
          expect(step.score).toBeGreaterThanOrEqual(0);
          expect(step.score).toBeLessThanOrEqual(100);
        }
        // Steps run forward in time.
        const times = entry.steps.map((step) => Date.parse(step.timestamp));
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      }
    });

    it("never reports a healthy asset as drifting", () => {
      const drift = loadTrustDrift(DATABASE_PATH);
      expect(drift.entries.some((entry) => entry.asset_version_id === HERO)).toBe(false);
      expect(drift.entries.every((entry) => entry.delta < 0)).toBe(true);
    });
  });

  describe("comparison", () => {
    it("states each side factually and marks which rows differ", () => {
      const comparison = loadComparison([STALE, PREVIOUS], DATABASE_PATH);

      expect(comparison!.subjects).toHaveLength(2);
      expect(comparison!.differing_rows).toBeGreaterThan(0);
      expect(comparison!.rows.every((row) => row.values.length === 2)).toBe(true);
      // It reports differences; it never names a winner.
      expect(comparison!.observation).not.toMatch(/better|best|winner|recommend/i);
    });

    it("requires at least two subjects", () => {
      expect(loadComparison([STALE], DATABASE_PATH)).toBeNull();
    });
  });

  describe("marketplace metrics", () => {
    it("derives every bucket from the published catalog", () => {
      const metrics = loadMarketplaceMetrics(DATABASE_PATH);

      const bandTotal = metrics.trust_bands.reduce((sum, bucket) => sum + bucket.value, 0);
      expect(bandTotal).toBe(metrics.published);

      const gateTotal = metrics.gate_health.reduce((sum, bucket) => sum + bucket.value, 0);
      expect(gateTotal).toBeGreaterThan(0);

      expect(metrics.total_runs).toBeGreaterThan(0);
      expect(metrics.usage.every((item) => item.runs > 0)).toBe(true);
      expect(metrics.usage.every((item) => item.succeeded <= item.runs)).toBe(true);
    });

    it("orders usage by real run counts", () => {
      const metrics = loadMarketplaceMetrics(DATABASE_PATH);
      const runs = metrics.usage.map((item) => item.runs);
      expect([...runs].sort((a, b) => b - a)).toEqual(runs);
    });
  });
});
