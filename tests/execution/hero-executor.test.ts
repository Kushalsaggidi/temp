import { afterEach, describe, expect, it, vi } from "vitest";

import heroFixture from "../../fixtures/catalog/bootstrap-draft.json";
import {
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  executePropertyOperationsBrief,
  propertyOperationsBriefExecutor,
  type PropertyOperationsBriefInput,
} from "@/modules/execution";

const scenarios = heroFixture.asset_version.test_scenarios;

function inputFor(index: number): PropertyOperationsBriefInput {
  return structuredClone(
    scenarios[index]!.input_fixture,
  ) as PropertyOperationsBriefInput;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Property Operations Brief Builder executor", () => {
  it.each([
    ["Scenario A", 0],
    ["Scenario B", 1],
  ] as const)("generically transforms %s while preserving reviewed input", async (_label, index) => {
    const input = inputFor(index);
    const before = structuredClone(input);
    const output = await executePropertyOperationsBrief(input);

    expect(input).toEqual(before);
    expect(output.title).toBe(input.brief_title);
    expect(output.summary).toEqual(input.observations);
    for (const observation of input.observations) {
      expect(output.review_questions.some((question) => question.includes(observation))).toBe(
        true,
      );
    }
    for (const constraint of input.constraints ?? []) {
      expect(output.review_questions.some((question) => question.includes(constraint))).toBe(
        true,
      );
    }
    expect(output.review_questions[0]).toContain(input.audience);
    expect(output.limitations.join(" ")).toMatch(/synthetic/i);
    expect(output.limitations.join(" ")).toMatch(/human.*verify/i);
    expect(output.limitations.join(" ")).toMatch(/does not make or automate/i);
  });

  it("handles a third materially different brief without a special branch", async () => {
    const input: PropertyOperationsBriefInput = {
      brief_title: "Elevator inspection follow-up",
      audience: "Facilities compliance reviewer",
      observations: [
        "Synthetic Tower C has one inspection record awaiting human confirmation.",
        "The supplied synthetic record contains no completion timestamp.",
      ],
    };

    const output = await executePropertyOperationsBrief(input);
    expect(output).toMatchObject({
      title: input.brief_title,
      summary: input.observations,
    });
    expect(output.review_questions).toHaveLength(1 + input.observations.length);
    expect(output.review_questions.join(" ")).toContain("no completion timestamp");
  });

  it("does not change behavior based on execution identity, purpose, or scenario label", async () => {
    const input = inputFor(0);
    const first = await propertyOperationsBriefExecutor.execute(input, {
      executionId: "execution_scenario_a",
      assetVersionId: "av_property_ops_brief_0_1_0_draft_1",
      purpose: "prepublication_test",
    });
    const second = await propertyOperationsBriefExecutor.execute(input, {
      executionId: "execution_unrelated_label",
      assetVersionId: "av_property_ops_brief_0_1_0_draft_1",
      purpose: "user_run",
    });

    expect(first).toEqual(second);
  });

  it("performs no outbound network call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network access is forbidden."));

    await expect(executePropertyOperationsBrief(inputFor(1))).resolves.toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(propertyOperationsBriefExecutor.key).toBe(
      PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    );
  });
});
