import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";

import heroFixture from "../../fixtures/catalog/bootstrap-draft.json";
import { JSONValueSchema } from "@/contracts";
import {
  ExecutorIntegrityError,
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
  PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA,
  PROPERTY_OPERATIONS_BRIEF_MANIFEST,
  PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA,
  createExecutorRegistry,
  loadPropertyOperationsBriefArtifacts,
  loadPropertyOperationsBriefImplementationSources,
  propertyOperationsBriefExecutor,
  resolvePropertyOperationsBriefExecutorDirectory,
  serverExecutorRegistry,
  type ExecutorArtifactSnapshot,
  type ExecutorIntegrityErrorCode,
} from "@/modules/execution";
import { sha256Digest } from "@/shared/integrity";

const EXPECTED_DEFINITION_DIGEST =
  "sha256:be8b5c34fd414d32619f665398d9f710c18004c5f7644ea16e3e591198e2008e";

function expectIntegrityFailure(
  operation: () => unknown,
  code: ExecutorIntegrityErrorCode,
): void {
  try {
    operation();
    throw new Error("Expected executor integrity verification to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutorIntegrityError);
    expect((error as ExecutorIntegrityError).code).toBe(code);
  }
}

function cloneSnapshot(): ExecutorArtifactSnapshot {
  const snapshot = loadPropertyOperationsBriefArtifacts();
  return {
    implementationBytes: Uint8Array.from(snapshot.implementationBytes),
    inputSchema: structuredClone(snapshot.inputSchema),
    outputSchema: structuredClone(snapshot.outputSchema),
    behaviorConfig: structuredClone(snapshot.behaviorConfig),
    manifest: structuredClone(snapshot.manifest),
  };
}

describe("server-owned executor registry", () => {
  it("is ready only for the exact reviewed hero artifacts", () => {
    expect(() => serverExecutorRegistry.assertReady()).not.toThrow();
    expect(serverExecutorRegistry.keys()).toEqual([
      PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    ]);

    const entry = serverExecutorRegistry.resolveVerified(
      PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
    );
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      key: "property_ops.brief_builder",
      implementationVersion: "1.0.0",
      definitionDigest: EXPECTED_DEFINITION_DIGEST,
      executionMode: "deterministic",
      policy: {
        networkAccess: "none",
        filesystemAccess: "none",
        outboundIntegrations: [],
        productionSideEffects: false,
      },
    });
    expect(entry?.manifest).toEqual(PROPERTY_OPERATIONS_BRIEF_MANIFEST);
    expect(entry?.execute).toBe(propertyOperationsBriefExecutor.execute);
    expect(entry?.inputSchema).toEqual(PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA);
    expect(entry?.outputSchema).toEqual(PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA);
    expect(PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION).toBe("1.0.0");
    expect(Object.isFrozen(entry?.policy.outboundIntegrations)).toBe(true);
    expect(
      Object.isFrozen(PROPERTY_OPERATIONS_BRIEF_BEHAVIOR_CONFIG.limitations),
    ).toBe(true);
    expect(PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST).toBe(
      EXPECTED_DEFINITION_DIGEST,
    );
  });

  it("stores schemas that exactly match the current hero version", () => {
    expect(PROPERTY_OPERATIONS_BRIEF_INPUT_SCHEMA).toEqual(
      heroFixture.asset_version.input_schema,
    );
    expect(PROPERTY_OPERATIONS_BRIEF_OUTPUT_SCHEMA).toEqual(
      heroFixture.asset_version.output_schema,
    );
  });

  it("does not resolve any client-selected or unknown implementation", () => {
    expect(serverExecutorRegistry.resolveVerified("property_ops.other")).toBeUndefined();
    expect(serverExecutorRegistry.find("request.supplied.module")).toBeUndefined();
    expect(serverExecutorRegistry.keys()).toHaveLength(1);
  });

  it("locates reviewed artifacts from a repository child working directory", () => {
    const fromRoot = resolvePropertyOperationsBriefExecutorDirectory();
    const fromScripts = resolvePropertyOperationsBriefExecutorDirectory(
      resolve(process.cwd(), "scripts", "execution"),
    );

    expect(fromScripts).toBe(fromRoot);
    expect(dirname(dirname(dirname(fromRoot)))).toBe(
      resolve(process.cwd(), "src", "modules"),
    );
  });

  it("fails construction when implementation bytes differ from the manifest", () => {
    const snapshot = cloneSnapshot();
    const loader = () => ({
      ...snapshot,
      implementationBytes: new TextEncoder().encode("tampered implementation"),
    });

    expectIntegrityFailure(
      () => createExecutorRegistry(loader),
      "implementation_digest_mismatch",
    );
  });

  it("recomputes artifacts on every resolution and rejects later tampering", () => {
    const snapshot = cloneSnapshot();
    let tampered = false;
    const registry = createExecutorRegistry(() => ({
      ...snapshot,
      behaviorConfig: tampered
        ? {
            ...(snapshot.behaviorConfig as Record<string, unknown>),
            limitations: ["Changed after startup."],
          }
        : snapshot.behaviorConfig,
    }));

    expect(registry.resolveVerified(PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY)).toBeDefined();
    tampered = true;
    expectIntegrityFailure(
      () => registry.resolveVerified(PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY),
      "behavior_config_digest_mismatch",
    );
  });

  it("rejects a coordinated schema/manifest change as a new unreviewed definition", () => {
    const snapshot = cloneSnapshot();
    const changedSchema = {
      ...(snapshot.inputSchema as Record<string, unknown>),
      title: "Unreviewed schema change",
    };
    const changedManifest = {
      ...(snapshot.manifest as Record<string, unknown>),
      input_schema_digest: sha256Digest(JSONValueSchema.parse(changedSchema)),
    };

    expectIntegrityFailure(
      () =>
        createExecutorRegistry(() => ({
          ...snapshot,
          inputSchema: changedSchema,
          manifest: changedManifest,
        })),
      "definition_digest_mismatch",
    );
  });

  it("contains no scenario-specific or outbound implementation branch", () => {
    const source = loadPropertyOperationsBriefImplementationSources()
      .map((file) => new TextDecoder().decode(file.bytes))
      .join("\n");
    expect(source).not.toContain("scenario_maintenance_backlog");
    expect(source).not.toContain("scenario_energy_variance");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+["']node:(?:fs|http|https|net)/);
  });
});
