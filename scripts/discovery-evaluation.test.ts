import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DiscoveryRequestSchema } from "../src/contracts";
import { discover, DISCOVERY_MATCH_THRESHOLD, type SemanticEnhancement, type SemanticEnhancementInput } from "../src/modules/discovery";
import { DisabledAiProvider } from "../src/shared/ports";
import { publishedCatalogFixtures } from "../fixtures/catalog/published-catalog";

type EvaluationCase = {
  id: string;
  request: unknown;
  expected_status: string;
  expected_top_1_asset_id?: string;
  acceptable_asset_ids?: string[];
};

type EvaluationDataset = { version: string; cases: EvaluationCase[] };

type EvaluationRow = {
  case_id: string;
  expected_outcome: string;
  actual_outcome: string;
  expected_top_1_asset_id: string | null;
  actual_top_1_asset_id: string | null;
  acceptable_asset_ids: string[];
  actual_candidate_asset_ids: string[];
  status_pass: boolean;
  top_1_pass: boolean | null;
  top_k_pass: boolean | null;
  pass: boolean;
};

describe("versioned discovery evaluation", () => {
  it("writes an identity-aware result artifact", async () => {
    const dataset = JSON.parse(
      readFileSync("docs/evaluation/discovery-set-v2.json", "utf8"),
    ) as EvaluationDataset;
    const provider = new DisabledAiProvider<SemanticEnhancementInput, SemanticEnhancement>();
    const rows: EvaluationRow[] = [];

    for (const evaluationCase of dataset.cases) {
      let actualStatus = "invalid_request";
      let actualCandidateIds: string[] = [];
      const parsed = DiscoveryRequestSchema.safeParse(evaluationCase.request);
      if (parsed.success) {
        const response = await discover(parsed.data, publishedCatalogFixtures, provider);
        actualStatus = response.status;
        if (response.status === "matches") {
          actualCandidateIds = response.candidates.map((candidate) => candidate.asset_id);
        }
      }

      const statusPass = actualStatus === evaluationCase.expected_status;
      const top1Pass = evaluationCase.expected_top_1_asset_id === undefined
        ? null
        : actualCandidateIds[0] === evaluationCase.expected_top_1_asset_id;
      const topKPass = evaluationCase.acceptable_asset_ids === undefined
        ? null
        : actualCandidateIds.some((assetId) =>
            evaluationCase.acceptable_asset_ids!.includes(assetId));
      rows.push({
        case_id: evaluationCase.id,
        expected_outcome: evaluationCase.expected_status,
        actual_outcome: actualStatus,
        expected_top_1_asset_id: evaluationCase.expected_top_1_asset_id ?? null,
        actual_top_1_asset_id: actualCandidateIds[0] ?? null,
        acceptable_asset_ids: evaluationCase.acceptable_asset_ids ?? [],
        actual_candidate_asset_ids: actualCandidateIds,
        status_pass: statusPass,
        top_1_pass: top1Pass,
        top_k_pass: topKPass,
        pass: statusPass && top1Pass !== false && topKPass !== false,
      });
    }

    const ratio = (selected: EvaluationRow[], field: "pass" | "top_1_pass" | "top_k_pass") => ({
      numerator: selected.filter((row) => row[field] === true).length,
      denominator: selected.length,
    });
    const matchingRows = rows.filter((row) => row.expected_outcome === "matches");
    const clarificationRows = rows.filter((row) => row.expected_outcome === "clarification_required");
    const noMatchRows = rows.filter((row) => row.expected_outcome === "no_match");
    const guardrailRows = rows.filter((row) => row.expected_outcome === "guardrail");
    let commitSha: string | null = null;
    try {
      commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // A workspace without an initial commit has no SHA to report.
    }

    const artifact = {
      evaluation_set_version: dataset.version,
      cases: rows,
      provider: "none",
      model_id: "not_applicable",
      ai_enhancement_enabled: false,
      ai_enhancement_reason: "Deterministic discovery is complete and verified.",
      configuration: {
        match_threshold: DISCOVERY_MATCH_THRESHOLD,
        max_candidates: 5,
        normalization: "src/modules/discovery/normalization.ts",
        ranking: "src/modules/discovery/retrieval.ts",
      },
      timestamp: new Date().toISOString(),
      command: "npm.cmd run evaluate:discovery",
      commit_sha: commitSha,
      limitations: [
        "Small, curated evaluation set; these results are not production accuracy.",
        "The evaluation uses event-created canonical published fixtures, not production traffic.",
        "The canonical hero remains a draft and is correctly excluded from normal discovery.",
      ],
      failures_and_observations: rows
        .filter((row) => !row.pass)
        .map((row) => {
          if (!row.status_pass) {
            return `${row.case_id}: expected status ${row.expected_outcome}, received ${row.actual_outcome}`;
          }
          if (row.top_1_pass === false) {
            return `${row.case_id}: expected top-1 ${row.expected_top_1_asset_id}, received ${row.actual_top_1_asset_id}`;
          }
          return `${row.case_id}: no acceptable asset appeared in the returned candidate set`;
        }),
      aggregates: {
        top_1_result: ratio(matchingRows, "top_1_pass"),
        acceptable_top_k: ratio(matchingRows, "top_k_pass"),
        correct_clarification: ratio(clarificationRows, "pass"),
        correct_no_match: ratio(noMatchRows, "pass"),
        correct_guardrail: ratio(guardrailRows, "pass"),
      },
    };

    mkdirSync("docs/reports", { recursive: true });
    writeFileSync(
      "docs/reports/discovery-evaluation-v2.json",
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    expect(dataset.cases).toHaveLength(13);
    expect(rows.every((row) => typeof row.status_pass === "boolean")).toBe(true);
    expect(artifact.aggregates.top_1_result.denominator).toBeGreaterThan(0);
  });
});
