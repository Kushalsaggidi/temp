import { describe, expect, it, vi } from "vitest";

import {
  createMaintainerExecutionHarness,
  type PrepublicationExecutionEntryPoint,
} from "@/modules/execution/maintainer-harness";

const request = {
  asset_version_id: "av_property_ops_brief_0_1_0_draft_1",
  scenario_label: "Synthetic maintenance backlog review",
  input: {
    brief_title: "Weekly maintenance backlog",
    audience: "Regional property operations reviewer",
    observations: ["Synthetic Site A has 14 open work orders."],
  },
};

const successfulRecord = {
  execution_id: "execution_maintainer_harness_a",
  asset_id: "asset_property_ops_brief",
  asset_version_id: request.asset_version_id,
  asset_version: "0.1.0-draft.1",
  executor_key: "property_ops.brief",
  definition_digest: `sha256:${"d".repeat(64)}`,
  purpose: "prepublication_test" as const,
  scenario_label: request.scenario_label,
  status: "succeeded" as const,
  validated_input: request.input,
  output: {
    title: "Weekly maintenance backlog",
    summary: ["Synthetic Site A has 14 open work orders."],
    review_questions: ["Can a reviewer verify the supplied count?"],
  },
  validation_results: [
    {
      stage: "output" as const,
      valid: true,
      code: "schema_valid",
      message: "Output matched the canonical schema.",
    },
  ],
  execution_mode: "deterministic" as const,
  started_at: "2026-09-16T10:00:00Z",
  completed_at: "2026-09-16T10:00:01Z",
};

describe("maintainer-only execution harness", () => {
  it("exposes only runScenario and delegates through the prepublication capability", async () => {
    const executePrepublication = vi.fn<
      PrepublicationExecutionEntryPoint["executePrepublication"]
    >(async () => ({ kind: "record", record: successfulRecord }));
    const harness = createMaintainerExecutionHarness({ executePrepublication });

    await expect(harness.runScenario(request)).resolves.toEqual(successfulRecord);
    expect(Object.keys(harness)).toEqual(["runScenario"]);
    expect(executePrepublication).toHaveBeenCalledExactlyOnceWith(request);
    expect(executePrepublication.mock.calls[0]?.[0]).not.toHaveProperty("purpose");
    expect(executePrepublication.mock.calls[0]?.[0]).not.toHaveProperty(
      "executor_key",
    );
  });

  it("rejects caller-controlled purpose or executor selection before delegation", async () => {
    const executePrepublication = vi.fn<
      PrepublicationExecutionEntryPoint["executePrepublication"]
    >(async () => ({ kind: "record", record: successfulRecord }));
    const harness = createMaintainerExecutionHarness({ executePrepublication });

    await expect(harness.runScenario({
      ...request,
      purpose: "user_run",
    })).rejects.toBeDefined();
    await expect(harness.runScenario({
      ...request,
      executor_key: "request.controlled",
    })).rejects.toBeDefined();
    expect(executePrepublication).not.toHaveBeenCalled();
  });

  it("rejects a callback result that is not an honest prepublication run", async () => {
    const entryPoint: PrepublicationExecutionEntryPoint = {
      executePrepublication: vi.fn<
        PrepublicationExecutionEntryPoint["executePrepublication"]
      >(async () => ({
        kind: "record",
        record: { ...successfulRecord, purpose: "user_run" as const },
      })),
    };
    const harness = createMaintainerExecutionHarness(entryPoint);

    await expect(harness.runScenario(request)).rejects.toThrow(
      /only prepublication execution records/,
    );
  });
});
