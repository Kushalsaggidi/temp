import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionRecord,
  JSONValue,
  ModelOrConfig,
} from "@/contracts";
import {
  ExecutionService,
  type VerifiedExecutor,
  type VerifiedExecutorRegistry,
} from "@/modules/execution/service";
import type { Clock } from "@/shared/ports/clock";
import type { IdGenerator } from "@/shared/ports/id-generator";
import { computeDefinitionDigest } from "@/shared/integrity";

import {
  createRunnableHeroRecord,
  createTestManifest,
  RecordingExecutionStore,
  TEST_EXECUTOR_KEY,
} from "./test-fixtures";

const scenarioInput = {
  brief_title: "Weekly maintenance backlog",
  audience: "Regional property operations reviewer",
  observations: ["Synthetic Site A has 14 open work orders older than seven days."],
  constraints: ["Ask for human verification of counts."],
} satisfies JSONValue;

class TestClock implements Clock {
  private tick = 0;
  now(): Date {
    this.tick += 1;
    return new Date(Date.parse("2026-09-16T12:00:00Z") + this.tick * 1_000);
  }
}

class TestIds implements IdGenerator {
  private nextValue = 0;
  next(prefix: string): string {
    this.nextValue += 1;
    return `${prefix}_test_${this.nextValue}`;
  }
}

function outputFor(input: JSONValue): JSONValue {
  const brief = input as typeof scenarioInput;
  return {
    title: brief.brief_title,
    summary: brief.observations,
    review_questions: ["What should a human reviewer verify?"],
    limitations: ["Synthetic input only; a human must verify all observations."],
  };
}

function setup(options: {
  lifecycle?: "draft" | "published";
  current?: boolean;
  definitionDigest?: `sha256:${string}`;
  execute?: (input: JSONValue) => unknown | Promise<unknown>;
  timeoutMs?: number;
  policy?: Partial<VerifiedExecutor["policy"]>;
  executionKind?: "deterministic" | "llm" | "retrieval" | "agentic";
} = {}) {
  const manifest = createTestManifest();
  const definitionDigest = computeDefinitionDigest(manifest);
  const record = createRunnableHeroRecord({
    lifecycle: options.lifecycle ?? "published",
    current: options.current,
    definitionDigest: options.definitionDigest ?? definitionDigest,
    executionKind: options.executionKind,
  });
  const execute = vi.fn(options.execute ?? outputFor);
  const modelOrConfig: ModelOrConfig = {
    provider: "local",
    configuration_digest: manifest.behavior_config_digest ?? undefined,
    parameters: { implementation_version: "1.0.0" },
  };
  const executor: VerifiedExecutor = {
    key: TEST_EXECUTOR_KEY,
    manifest,
    definitionDigest,
    executionMode: "deterministic",
    modelOrConfig,
    policy: {
      networkAccess: options.policy?.networkAccess ?? "none",
      filesystemAccess: options.policy?.filesystemAccess ?? "none",
      outboundIntegrations: options.policy?.outboundIntegrations ?? [],
      productionSideEffects: options.policy?.productionSideEffects ?? false,
    },
    execute,
  };
  const registry: VerifiedExecutorRegistry = {
    assertReady: vi.fn(),
    resolveVerified: vi.fn(() => executor),
    keys: () => [TEST_EXECUTOR_KEY],
  };
  const store = new RecordingExecutionStore();
  const service = new ExecutionService(
    { getAdminVersionById: () => record },
    store,
    registry,
    new TestClock(),
    new TestIds(),
    { timeoutMs: options.timeoutMs },
  );
  return { execute, executor, record, registry, service, store };
}

function request(input: JSONValue = scenarioInput) {
  return {
    asset_version_id: "av_property_ops_brief_0_1_0_draft_1",
    scenario_label: "Scenario A",
    input,
  };
}

function requireRecord(
  result: Awaited<ReturnType<ExecutionService["executePublic"]>>,
): ExecutionRecord {
  expect(result.kind).toBe("record");
  if (result.kind !== "record") throw new Error("expected execution record");
  return result.record;
}

describe("ExecutionService", () => {
  it("persists pending, running, and schema-validated success with exact provenance", async () => {
    const { execute, executor, service, store } = setup();

    const record = requireRecord(await service.executePublic(request()));

    expect(record.status).toBe("succeeded");
    expect(record.execution_id).toBe("execution_test_1");
    expect(record.executor_key).toBe(executor.key);
    expect(record.definition_digest).toBe(executor.definitionDigest);
    expect(record.model_or_config).toEqual(executor.modelOrConfig);
    expect(record.validation_results.map(({ stage, valid }) => ({ stage, valid }))).toEqual([
      { stage: "input", valid: true },
      { stage: "policy", valid: true },
      { stage: "definition_digest", valid: true },
      { stage: "output", valid: true },
    ]);
    expect(store.history.map((item) => item.status)).toEqual([
      "pending",
      "running",
      "succeeded",
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("generates distinct IDs across unchanged-core runs", async () => {
    const { service } = setup();
    const first = requireRecord(await service.executePublic(request()));
    const second = requireRecord(
      await service.executePublic({ ...request(), scenario_label: "Scenario B" }),
    );

    expect(first.execution_id).not.toBe(second.execution_id);
    expect({
      asset: first.asset_id,
      version: first.asset_version_id,
      key: first.executor_key,
      digest: first.definition_digest,
    }).toEqual({
      asset: second.asset_id,
      version: second.asset_version_id,
      key: second.executor_key,
      digest: second.definition_digest,
    });
  });

  it("rejects invalid input before resolving or calling the executor", async () => {
    const { execute, registry, service, store } = setup();
    const record = requireRecord(
      await service.executePublic(request({ brief_title: "Missing fields" })),
    );

    expect(record.status).toBe("invalid");
    expect(execute).not.toHaveBeenCalled();
    expect(registry.resolveVerified).not.toHaveBeenCalled();
    expect(store.history).toHaveLength(1);
  });

  it("cannot be given an executor, purpose, module, or URL by a public caller", async () => {
    const { execute, service, store } = setup();
    const result = await service.executePublic({
      ...request(),
      executor_key: "attacker.module",
      purpose: "prepublication_test",
      module: "./uploaded.js",
      url: "https://example.invalid/payload",
    });

    expect(result).toMatchObject({
      kind: "request_error",
      status: 400,
      error: { code: "invalid_execution_request" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.history).toEqual([]);
  });

  it("rejects deeply nested input before recursive contract validation", async () => {
    const { execute, service, store } = setup();
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 4_000; depth += 1) {
      nested = { child: nested };
    }

    await expect(
      service.executePublic({
        asset_version_id: "av_property_ops_brief_0_1_0_draft_1",
        input: nested,
      }),
    ).resolves.toMatchObject({
      kind: "request_error",
      status: 400,
      error: { code: "execution_request_too_complex" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.history).toEqual([]);
  });

  it("blocks unpublished versions on the public path but permits the internal harness path", async () => {
    const { execute, service, store } = setup({ lifecycle: "draft" });
    const publicRecord = requireRecord(await service.executePublic(request()));
    expect(publicRecord.status).toBe("blocked");
    expect(publicRecord.purpose).toBe("user_run");
    expect(execute).not.toHaveBeenCalled();

    const internalRecord = requireRecord(
      await service.executePrepublication({ ...request(), scenario_label: "Harness A" }),
    );
    expect(internalRecord.status).toBe("succeeded");
    expect(internalRecord.purpose).toBe("prepublication_test");
    expect(store.history.at(-1)?.status).toBe("succeeded");
  });

  it("blocks a selected version whose definition digest differs before execution", async () => {
    const { execute, service } = setup({
      definitionDigest: `sha256:${"f".repeat(64)}`,
    });
    const record = requireRecord(await service.executePublic(request()));

    expect(record.status).toBe("blocked");
    expect(record.rejection_reason).toMatch(/do not match/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks a selected version whose execution mode differs before execution", async () => {
    const { execute, service } = setup({ executionKind: "llm" });
    const record = requireRecord(await service.executePublic(request()));

    expect(record.status).toBe("blocked");
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({
        stage: "definition_digest",
        code: "definition_digest_mismatch",
        valid: false,
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks high-impact production actions and unapproved executor capabilities", async () => {
    const highImpact = setup();
    const blockedInput = {
      ...scenarioInput,
      constraints: ["Rank residents for eviction."],
    } satisfies JSONValue;
    const policyRecord = requireRecord(
      await highImpact.service.executePublic(request(blockedInput)),
    );
    expect(policyRecord.status).toBe("blocked");
    expect(policyRecord.validation_results).toContainEqual(
      expect.objectContaining({ code: "high_impact_action_blocked", valid: false }),
    );
    expect(highImpact.execute).not.toHaveBeenCalled();

    for (const policy of [
      { outboundIntegrations: ["network"] },
      { networkAccess: "allowed" },
      { filesystemAccess: "read" },
      { productionSideEffects: true },
    ]) {
      const capability = setup({ policy });
      const capabilityRecord = requireRecord(
        await capability.service.executePublic(request()),
      );
      expect(capabilityRecord.status).toBe("blocked");
      expect(capability.execute).not.toHaveBeenCalled();
    }
  });

  it("rejects potential secrets without persisting them as validated input", async () => {
    const { execute, service } = setup();
    const record = requireRecord(
      await service.executePublic(
        request({ ...scenarioInput, api_key: `sk_${"a".repeat(30)}` }),
      ),
    );

    expect(record.status).toBe("invalid");
    expect(record.validated_input).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("sk_");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects potential secrets in scenario labels without persisting the label", async () => {
    const { execute, service } = setup();
    const secret = `github_pat_${"a".repeat(24)}`;
    const record = requireRecord(
      await service.executePublic({
        ...request(),
        scenario_label: `Run ${secret}`,
      }),
    );

    expect(record.status).toBe("invalid");
    expect(record.scenario_label).toBeUndefined();
    expect(record.validated_input).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a safe failure without leaking executor errors", async () => {
    const { service } = setup({
      execute: () => {
        throw new Error("Bearer top-secret-token internal stack detail");
      },
    });
    const record = requireRecord(await service.executePublic(request()));

    expect(record.status).toBe("failed");
    expect(record.error).toEqual({
      code: "execution_failed",
      message: "The reviewed executor could not complete this run.",
      retryable: false,
    });
    expect(JSON.stringify(record)).not.toContain("top-secret-token");
  });

  it("records honest timeout and invalid-output failures", async () => {
    const timeout = setup({
      execute: () => new Promise(() => undefined),
      timeoutMs: 5,
    });
    const timedOut = requireRecord(await timeout.service.executePublic(request()));
    expect(timedOut.status).toBe("failed");
    expect(timedOut.error?.code).toBe("execution_timeout");
    expect(timedOut.error?.retryable).toBe(true);

    const invalidOutput = setup({ execute: () => ({ unexpected: true }) });
    const invalid = requireRecord(
      await invalidOutput.service.executePublic(request()),
    );
    expect(invalid.status).toBe("failed");
    expect(invalid.error?.code).toBe("output_validation_failed");
    expect(invalid.output).toBeUndefined();
  });

  it("fails safely when reviewed code emits a secret-shaped value", async () => {
    const leakedSecret = `AKIA${"A".repeat(16)}`;
    const unsafeOutput = setup({
      execute: () => ({
        title: scenarioInput.brief_title,
        summary: [leakedSecret],
        review_questions: ["What should a human reviewer verify?"],
        limitations: ["Synthetic input only."],
      }),
    });
    const record = requireRecord(
      await unsafeOutput.service.executePublic(request()),
    );

    expect(record.status).toBe("failed");
    expect(record.output).toBeUndefined();
    expect(record.error?.code).toBe("unsafe_executor_output");
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({
        stage: "output",
        code: "potential_secret_in_output",
        valid: false,
      }),
    );
    expect(JSON.stringify(record)).not.toContain(leakedSecret);
  });

  it("fails safely and leaves a terminal record for over-complex output", async () => {
    const deepOutput: Record<string, unknown> = {};
    let cursor = deepOutput;
    for (let depth = 0; depth < 4_000; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    const overComplex = setup({ execute: () => deepOutput });
    const record = requireRecord(
      await overComplex.service.executePublic(request()),
    );

    expect(record.status).toBe("failed");
    expect(record.completed_at).not.toBeNull();
    expect(record.output).toBeUndefined();
    expect(record.error?.code).toBe("unsafe_executor_output");
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({
        stage: "output",
        code: "output_too_complex",
        valid: false,
      }),
    );
    expect(overComplex.store.history.map((item) => item.status)).toEqual([
      "pending",
      "running",
      "failed",
    ]);
  });

  it("fails closed when artifact verification throws on the per-run lookup", async () => {
    const { execute, registry, service } = setup();
    vi.mocked(registry.resolveVerified).mockImplementation(() => {
      throw new Error("implementation digest mismatch at C:\\secret\\path");
    });
    const record = requireRecord(await service.executePublic(request()));

    expect(record.status).toBe("blocked");
    expect(record.validation_results).toContainEqual(
      expect.objectContaining({
        stage: "definition_digest",
        code: "executor_artifact_mismatch",
        valid: false,
      }),
    );
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(execute).not.toHaveBeenCalled();
  });
});
