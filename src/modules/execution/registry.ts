import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

import {
  ExecutorManifestSchema,
  JSONValueSchema,
  JsonSchemaDocumentSchema,
  type ExecutorManifest,
  type JsonSchemaDocument,
  type ModelOrConfig,
} from "@/contracts";
import type {
  AllowlistedExecutor,
  ExecutorLookup,
} from "@/shared/ports";
import { computeDefinitionDigest, sha256Digest } from "@/shared/integrity";

import {
  PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST,
  PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY,
  PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION,
  PropertyOperationsBriefBehaviorConfigSchema,
} from "./executors/property-operations-brief/artifacts";
import {
  propertyOperationsBriefExecutor,
} from "./executors/property-operations-brief/executor";
import { createPropertyOperationsBriefRegistration } from "./executors/property-operations-brief/registration";

export type ExecutorIntegrityErrorCode =
  | "artifact_load_failed"
  | "invalid_manifest"
  | "executor_key_mismatch"
  | "implementation_version_mismatch"
  | "implementation_digest_mismatch"
  | "input_schema_digest_mismatch"
  | "output_schema_digest_mismatch"
  | "behavior_config_digest_mismatch"
  | "definition_digest_mismatch";

export class ExecutorIntegrityError extends Error {
  readonly name = "ExecutorIntegrityError";

  constructor(
    readonly code: ExecutorIntegrityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ExecutorPolicyCapabilities {
  readonly networkAccess: "none";
  readonly filesystemAccess: "none";
  readonly outboundIntegrations: readonly [];
  readonly productionSideEffects: false;
}

export interface VerifiedExecutor extends AllowlistedExecutor<unknown, unknown> {
  readonly manifest: Readonly<ExecutorManifest>;
  readonly definitionDigest: `sha256:${string}`;
  readonly executionMode: "deterministic";
  readonly inputSchema: Readonly<JsonSchemaDocument>;
  readonly outputSchema: Readonly<JsonSchemaDocument>;
  readonly modelOrConfig: Readonly<ModelOrConfig>;
  readonly policy: ExecutorPolicyCapabilities;
}

export interface ExecutorArtifactSnapshot {
  readonly implementationBytes: Uint8Array;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly behaviorConfig: unknown;
  readonly manifest: unknown;
}

export type ExecutorArtifactLoader = () => ExecutorArtifactSnapshot;

const EXECUTOR_RELATIVE_PATH = [
  "src",
  "modules",
  "execution",
  "executors",
  "property-operations-brief",
] as const;

/**
 * Resolve from the launch directory or one of its parents. Next normally starts
 * at the application root, while maintenance commands may start in a child
 * directory. A bounded ancestor walk keeps both paths deterministic and never
 * falls back to a client-supplied location.
 */
export function resolvePropertyOperationsBriefExecutorDirectory(
  startDirectory = process.cwd(),
): string {
  let current = resolve(startDirectory);
  const filesystemRoot = parse(current).root;
  while (true) {
    const candidate = resolve(current, ...EXECUTOR_RELATIVE_PATH);
    if (
      existsSync(resolve(candidate, "manifest.json")) &&
      existsSync(resolve(candidate, "executor.ts")) &&
      existsSync(resolve(candidate, "artifacts.ts"))
    ) {
      return candidate;
    }
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  throw new ExecutorIntegrityError(
    "artifact_load_failed",
    "The reviewed executor artifact directory could not be located.",
  );
}

const EXECUTOR_DIRECTORY = resolvePropertyOperationsBriefExecutorDirectory();

function readJsonArtifact(fileName: string): unknown {
  return JSON.parse(readFileSync(resolve(EXECUTOR_DIRECTORY, fileName), "utf8"));
}

const REVIEWED_IMPLEMENTATION_FILES = [
  "artifacts.ts",
  "executor.ts",
  "registration.ts",
] as const;

export function loadPropertyOperationsBriefImplementationSources(): readonly {
  path: string;
  bytes: Uint8Array;
}[] {
  return REVIEWED_IMPLEMENTATION_FILES.map((path) => ({
    path,
    // Source artifacts are text. Normalize only platform line endings so the
    // same reviewed source has one digest on Windows and Unix checkouts.
    bytes: Buffer.from(
      readFileSync(resolve(EXECUTOR_DIRECTORY, path), "utf8").replaceAll(
        /\r\n?/g,
        "\n",
      ),
      "utf8",
    ),
  }));
}

function loadReviewedImplementationBundle(): Uint8Array {
  const bundle = {
    schema_version: "reviewed-implementation-bundle-v1",
    files: loadPropertyOperationsBriefImplementationSources().map((file) => ({
      path: file.path,
      content_base64: Buffer.from(file.bytes).toString("base64"),
    })),
  };
  return Buffer.from(JSON.stringify(bundle), "utf8");
}

/** Reads every reviewed artifact afresh; registry construction and resolution use this. */
export function loadPropertyOperationsBriefArtifacts(): ExecutorArtifactSnapshot {
  return {
    implementationBytes: loadReviewedImplementationBundle(),
    inputSchema: readJsonArtifact("input.schema.json"),
    outputSchema: readJsonArtifact("output.schema.json"),
    behaviorConfig: readJsonArtifact("behavior-config.json"),
    manifest: readJsonArtifact("manifest.json"),
  };
}

function rawSha256Digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

interface VerifiedArtifacts {
  manifest: ExecutorManifest;
  definitionDigest: `sha256:${string}`;
  inputSchema: JsonSchemaDocument;
  outputSchema: JsonSchemaDocument;
}

function integrityFailure(
  code: ExecutorIntegrityErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new ExecutorIntegrityError(code, message, cause === undefined ? undefined : { cause });
}

function verifyArtifacts(loader: ExecutorArtifactLoader): VerifiedArtifacts {
  let snapshot: ExecutorArtifactSnapshot;
  try {
    snapshot = loader();
  } catch (error) {
    integrityFailure(
      "artifact_load_failed",
      "The reviewed executor artifacts could not be loaded.",
      error,
    );
  }

  const manifestResult = ExecutorManifestSchema.safeParse(snapshot.manifest);
  if (!manifestResult.success) {
    integrityFailure(
      "invalid_manifest",
      "The reviewed executor manifest does not satisfy the canonical contract.",
      manifestResult.error,
    );
  }
  const manifest = manifestResult.data;

  if (manifest.executor_key !== PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY) {
    integrityFailure(
      "executor_key_mismatch",
      "The reviewed executor key does not match the server allowlist.",
    );
  }
  if (
    manifest.implementation_version !==
    PROPERTY_OPERATIONS_BRIEF_IMPLEMENTATION_VERSION
  ) {
    integrityFailure(
      "implementation_version_mismatch",
      "The reviewed implementation version does not match the server allowlist.",
    );
  }

  const implementationDigest = rawSha256Digest(snapshot.implementationBytes);
  if (implementationDigest !== manifest.implementation_digest) {
    integrityFailure(
      "implementation_digest_mismatch",
      "The executor implementation differs from its reviewed manifest.",
    );
  }

  const inputSchemaResult = JsonSchemaDocumentSchema.safeParse(snapshot.inputSchema);
  if (!inputSchemaResult.success) {
    integrityFailure(
      "input_schema_digest_mismatch",
      "The reviewed input schema is invalid.",
      inputSchemaResult.error,
    );
  }
  const inputSchemaDigest = sha256Digest(JSONValueSchema.parse(inputSchemaResult.data));
  if (inputSchemaDigest !== manifest.input_schema_digest) {
    integrityFailure(
      "input_schema_digest_mismatch",
      "The executor input schema differs from its reviewed manifest.",
    );
  }

  const outputSchemaResult = JsonSchemaDocumentSchema.safeParse(snapshot.outputSchema);
  if (!outputSchemaResult.success) {
    integrityFailure(
      "output_schema_digest_mismatch",
      "The reviewed output schema is invalid.",
      outputSchemaResult.error,
    );
  }
  const outputSchemaDigest = sha256Digest(JSONValueSchema.parse(outputSchemaResult.data));
  if (outputSchemaDigest !== manifest.output_schema_digest) {
    integrityFailure(
      "output_schema_digest_mismatch",
      "The executor output schema differs from its reviewed manifest.",
    );
  }

  const behaviorConfigResult = PropertyOperationsBriefBehaviorConfigSchema.safeParse(
    snapshot.behaviorConfig,
  );
  if (!behaviorConfigResult.success) {
    integrityFailure(
      "behavior_config_digest_mismatch",
      "The reviewed executor behavior configuration is invalid.",
      behaviorConfigResult.error,
    );
  }
  const behaviorConfigDigest = sha256Digest(
    JSONValueSchema.parse(behaviorConfigResult.data),
  );
  if (
    manifest.behavior_config_digest === null ||
    behaviorConfigDigest !== manifest.behavior_config_digest
  ) {
    integrityFailure(
      "behavior_config_digest_mismatch",
      "The executor behavior configuration differs from its reviewed manifest.",
    );
  }

  const definitionDigest = computeDefinitionDigest(manifest);
  if (definitionDigest !== PROPERTY_OPERATIONS_BRIEF_DEFINITION_DIGEST) {
    integrityFailure(
      "definition_digest_mismatch",
      "The executor definition differs from the server-reviewed definition.",
    );
  }
  if (
    propertyOperationsBriefExecutor.key !== manifest.executor_key ||
    propertyOperationsBriefExecutor.implementationVersion !==
      manifest.implementation_version ||
    propertyOperationsBriefExecutor.definitionDigest !== definitionDigest
  ) {
    integrityFailure(
      "definition_digest_mismatch",
      "The registered executor does not match its reviewed definition.",
    );
  }

  return {
    manifest,
    definitionDigest,
    inputSchema: inputSchemaResult.data,
    outputSchema: outputSchemaResult.data,
  };
}

function toVerifiedExecutor(artifacts: VerifiedArtifacts): VerifiedExecutor {
  const registration = createPropertyOperationsBriefRegistration(artifacts);
  if (
    registration.key !== artifacts.manifest.executor_key ||
    registration.implementationVersion !==
      artifacts.manifest.implementation_version ||
    registration.definitionDigest !== artifacts.definitionDigest ||
    registration.execute !== propertyOperationsBriefExecutor.execute
  ) {
    integrityFailure(
      "definition_digest_mismatch",
      "The registered executor does not match its reviewed implementation bundle.",
    );
  }
  return registration;
}

export class ServerOwnedExecutorRegistry implements ExecutorLookup {
  readonly #artifactLoader: ExecutorArtifactLoader;

  constructor(artifactLoader: ExecutorArtifactLoader = loadPropertyOperationsBriefArtifacts) {
    this.#artifactLoader = artifactLoader;
    this.assertReady();
  }

  assertReady(): void {
    verifyArtifacts(this.#artifactLoader);
  }

  resolveVerified(key: string): VerifiedExecutor | undefined {
    const artifacts = verifyArtifacts(this.#artifactLoader);
    if (key !== PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY) return undefined;
    return toVerifiedExecutor(artifacts);
  }

  find(key: string): AllowlistedExecutor | undefined {
    return this.resolveVerified(key);
  }

  keys(): readonly string[] {
    return Object.freeze([PROPERTY_OPERATIONS_BRIEF_EXECUTOR_KEY]);
  }
}

export function createExecutorRegistry(
  artifactLoader: ExecutorArtifactLoader = loadPropertyOperationsBriefArtifacts,
): ServerOwnedExecutorRegistry {
  return new ServerOwnedExecutorRegistry(artifactLoader);
}

/** Module construction is the execution subsystem's fail-closed readiness check. */
export const serverExecutorRegistry = createExecutorRegistry();
