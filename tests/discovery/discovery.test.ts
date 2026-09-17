import { describe, expect, it } from "vitest";
import { publishedCatalogFixtures } from "../../fixtures/catalog/published-catalog";
import { getBootstrapRecord } from "@/server/db";
import {
  discover,
  type SemanticEnhancement,
  type SemanticEnhancementInput,
} from "@/modules/discovery";
import { DisabledAiProvider, type OptionalAiProvider } from "@/shared/ports";

const disabled = new DisabledAiProvider<
  SemanticEnhancementInput,
  SemanticEnhancement
>();

describe("deterministic discovery policy", () => {
  it("finds published assets and explains actual field values and terms", async () => {
    const result = await discover(
      { query: "prepare a property operations review" },
      publishedCatalogFixtures,
      disabled,
    );

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.candidates[0]?.matched_fields).toContain("domains");
      expect(result.candidates[0]?.rationale.join(" ")).toMatch(
        /property operations.*property|property.*property operations/i,
      );
      expect(result.candidates[0]).not.toHaveProperty("ranking_score_internal");
    }
  });

  it("uses audience context and lets useful context resolve a short query", async () => {
    const result = await discover({
      query: "find a tool",
      optional_context: { audience: "property managers" },
    }, publishedCatalogFixtures, disabled);

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.candidates[0]?.matched_fields).toContain("audiences");
      expect(
        result.candidates.every((candidate) =>
          candidate.rationale.some((reason) => /property managers/i.test(reason)),
        ),
      ).toBe(true);
    }
  });

  it("clarifies broad and multi-intent queries", async () => {
    await expect(discover(
      { query: "help me" }, publishedCatalogFixtures, disabled,
    )).resolves.toMatchObject({ status: "clarification_required" });
    const multi = await discover(
      { query: "review leases and draft resident updates" },
      publishedCatalogFixtures,
      disabled,
    );
    expect(multi.status).toBe("clarification_required");
    expect(multi.interpreted_intent.intents).toHaveLength(2);
  });

  it("guards high-impact language in either query or optional context", async () => {
    await expect(discover(
      { query: "approve or deny an applicant" }, publishedCatalogFixtures, disabled,
    )).resolves.toMatchObject({ status: "guardrail" });
    await expect(discover({
      query: "make a summary",
      optional_context: { constraints: ["automatically decide rent pricing"] },
    }, publishedCatalogFixtures, disabled)).resolves.toMatchObject({ status: "guardrail" });
  });

  it("returns no match rather than a closest-match claim", async () => {
    await expect(discover(
      { query: "quantum astrophysics simulation" },
      publishedCatalogFixtures,
      disabled,
    )).resolves.toMatchObject({ status: "no_match", candidates: [] });
  });

  it("never retrieves an unpublished version", async () => {
    const result = await discover(
      { query: "turn site observations into a review-ready brief" },
      [getBootstrapRecord()],
      disabled,
    );
    expect(result.status).toBe("no_match");
  });

  it("uses bounded semantic terms only when canonical fields support them", async () => {
    const semantic = {
      state: "ready" as const,
      enhance: async () => ({
        state: "ready" as const,
        output: { additional_terms: ["resident communications"] },
        modelOrConfig: "test-semantic-provider",
      }),
    } satisfies OptionalAiProvider<SemanticEnhancementInput, SemanticEnhancement>;
    const result = await discover(
      { query: "notify occupants" },
      publishedCatalogFixtures,
      semantic,
    );

    expect(result).toMatchObject({ status: "matches", mode: "hybrid", fallback_used: false });
    if (result.status === "matches") {
      expect(result.candidates[0]?.asset_id).toMatch(
        /^asset_(resident_comms|notice_composer)$/,
      );
      expect(result.candidates[0]?.scoring_method).toContain("semantic query expansion");
    }
  });

  it("does not let one weak semantic term force a match", async () => {
    const weakSemantic = {
      state: "ready" as const,
      enhance: async () => ({
        state: "ready" as const,
        output: { additional_terms: ["procurement"] },
        modelOrConfig: "test-semantic-provider",
      }),
    } satisfies OptionalAiProvider<SemanticEnhancementInput, SemanticEnhancement>;
    const result = await discover(
      { query: "quantum astrophysics simulation" },
      publishedCatalogFixtures,
      weakSemantic,
    );
    expect(result.status).toBe("no_match");
  });

  it("visibly falls back to deterministic results when the provider fails", async () => {
    const failing = {
      state: "ready" as const,
      enhance: async () => ({
        state: "unavailable" as const,
        reason: "test provider failure",
      }),
    } satisfies OptionalAiProvider<SemanticEnhancementInput, SemanticEnhancement>;
    const result = await discover(
      { query: "prepare a property operations review" },
      publishedCatalogFixtures,
      failing,
    );
    expect(result).toMatchObject({
      status: "matches",
      mode: "hybrid",
      fallback_used: true,
      fallback_reason: "test provider failure",
    });
  });

  it("contains an adapter exception and still uses deterministic discovery", async () => {
    const throwing = {
      state: "ready" as const,
      enhance: async (): Promise<never> => {
        throw new Error("provider implementation bug");
      },
    } satisfies OptionalAiProvider<SemanticEnhancementInput, SemanticEnhancement>;
    const result = await discover(
      { query: "prepare a property operations review" },
      publishedCatalogFixtures,
      throwing,
    );
    expect(result).toMatchObject({
      status: "matches",
      fallback_used: true,
      fallback_reason: expect.stringContaining("failed unexpectedly"),
    });
  });

  it("normalizes the full valid request range into the narrower intent contract", async () => {
    const result = await discover(
      { query: `specialized ${"x".repeat(980)}` },
      publishedCatalogFixtures,
      disabled,
    );
    expect(result.interpreted_intent.intents[0]?.goal.length).toBeLessThanOrEqual(500);
  });

  it("rejects malformed requests through the canonical schema", async () => {
    await expect(discover(
      { query: "", unsupported: true }, publishedCatalogFixtures, disabled,
    )).rejects.toBeDefined();
  });
});
