import {
  ExecutionRecordSchema,
  ExecutionRequestSchema,
  JSONValueSchema,
  ModelOrConfigSchema,
  type AssetVersionRecord,
  type ExecutionMode,
  type ExecutionRecord,
  type ExecutionRequest,
  type ExecutorManifest,
  type JSONValue,
  type ModelOrConfig,
  type ValidationResult,
} from "@/contracts";
import type { Clock } from "@/shared/ports/clock";
import type { IdGenerator } from "@/shared/ports/id-generator";
import { sha256Digest } from "@/shared/integrity";

import {
  EXECUTION_LIMITS,
  isJsonStructureWithinLimits,
  jsonByteLength,
} from "./limits";
import {
  containsPotentialSecret,
  evaluateHighImpactPolicy,
  evaluateVersionPolicy,
  type ExecutionPurpose,
} from "./policy";
import { validateAgainstSchema } from "./schema-validator";

export interface ExecutionCatalogReader {
  getAdminVersionById(assetVersionId: string): AssetVersionRecord | null;
}

export interface ExecutionRecordStore {
  insert(record: ExecutionRecord): void;
  update(record: ExecutionRecord): void;
  getById(executionId: string): ExecutionRecord | null;
}

export interface VerifiedExecutor {
  readonly key: string;
  readonly manifest: ExecutorManifest;
  readonly definitionDigest: `sha256:${string}`;
  readonly executionMode: ExecutionMode;
  readonly modelOrConfig: ModelOrConfig;
  readonly policy: {
    readonly networkAccess: string;
    readonly filesystemAccess: string;
    readonly outboundIntegrations: readonly string[];
    readonly productionSideEffects: boolean;
  };
  execute(
    input: JSONValue,
    context: {
      executionId: string;
      assetVersionId: string;
      purpose: ExecutionPurpose;
    },
  ): Promise<unknown> | unknown;
}

export interface VerifiedExecutorRegistry {
  assertReady(): void;
  resolveVerified(key: string): VerifiedExecutor | undefined;
  keys(): readonly string[];
}

export type ExecutionServiceResult =
  | { kind: "record"; record: ExecutionRecord }
  | {
      kind: "request_error";
      status: 400 | 404;
      error: { code: string; message: string };
    };

export interface ExecutionServiceOptions {
  timeoutMs?: number;
  inputBytes?: number;
  outputBytes?: number;
}

class ExecutionTimeoutError extends Error {
  constructor() {
    super("Execution timed out.");
    this.name = "ExecutionTimeoutError";
  }
}

function resolvedTimestamp(clock: Clock): string {
  return clock.now().toISOString();
}

function executionModeFor(record: AssetVersionRecord): ExecutionMode {
  const kind = record.asset_version.execution_kind;
  return kind === "none" ? "deterministic" : kind;
}

function inputValidation(valid: boolean, message: string): ValidationResult {
  return {
    stage: "input",
    valid,
    code: valid ? "schema_valid" : "schema_invalid",
    message,
  };
}

function policyValidation(
  valid: boolean,
  code: string,
  message: string,
): ValidationResult {
  return { stage: "policy", valid, code, message };
}

function digestValidation(
  valid: boolean,
  code: string,
  message: string,
): ValidationResult {
  return { stage: "definition_digest", valid, code, message };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ExecutionTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class ExecutionService {
  private readonly timeoutMs: number;
  private readonly inputBytes: number;
  private readonly outputBytes: number;

  constructor(
    private readonly catalog: ExecutionCatalogReader,
    private readonly records: ExecutionRecordStore,
    private readonly registry: VerifiedExecutorRegistry,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    options: ExecutionServiceOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? EXECUTION_LIMITS.timeoutMs;
    this.inputBytes = options.inputBytes ?? EXECUTION_LIMITS.inputBytes;
    this.outputBytes = options.outputBytes ?? EXECUTION_LIMITS.outputBytes;
    this.registry.assertReady();
  }

  executePublic(value: unknown): Promise<ExecutionServiceResult> {
    return this.execute(value, "user_run");
  }

  /** Internal entry point. Expose only through the code-only maintainer harness. */
  executePrepublication(value: unknown): Promise<ExecutionServiceResult> {
    return this.execute(value, "prepublication_test");
  }

  private async execute(
    value: unknown,
    purpose: ExecutionPurpose,
  ): Promise<ExecutionServiceResult> {
    if (!isJsonStructureWithinLimits(value)) {
      return {
        kind: "request_error",
        status: 400,
        error: {
          code: "execution_request_too_complex",
          message: "The execution request exceeds the allowed structural limits.",
        },
      };
    }
    const parsedRequest = ExecutionRequestSchema.safeParse(value);
    if (!parsedRequest.success) {
      return {
        kind: "request_error",
        status: 400,
        error: {
          code: "invalid_execution_request",
          message: "Invalid execution request.",
        },
      };
    }

    const request = parsedRequest.data;
    const selected = this.catalog.getAdminVersionById(request.asset_version_id);
    if (selected === null) {
      return {
        kind: "request_error",
        status: 404,
        error: {
          code: "asset_version_not_found",
          message: "Asset version not found.",
        },
      };
    }

    const executionId = this.ids.next("execution");
    const startedAt = resolvedTimestamp(this.clock);
    const version = selected.asset_version;
    const containsRequestSecret =
      containsPotentialSecret(request.input) ||
      (request.scenario_label !== undefined &&
        containsPotentialSecret({ scenario_label: request.scenario_label }));
    const base = {
      execution_id: executionId,
      asset_id: selected.asset.asset_id,
      asset_version_id: version.asset_version_id,
      asset_version: version.version,
      purpose,
      ...(request.scenario_label === undefined || containsRequestSecret
        ? {}
        : { scenario_label: request.scenario_label }),
      execution_mode: executionModeFor(selected),
      started_at: startedAt,
    } as const;

    if (containsRequestSecret) {
      return this.persistTerminal({
        ...base,
        executor_key: version.executor_key,
        definition_digest: version.definition_digest,
        status: "invalid",
        validation_results: [
          policyValidation(
            false,
            "potential_secret_rejected",
            "Potential secrets are not accepted in execution requests.",
          ),
        ],
        rejection_reason: "Potential secrets are not accepted in execution requests.",
      });
    }

    const versionPolicy = evaluateVersionPolicy(selected, purpose);
    if (!versionPolicy.allowed) {
      return this.persistTerminal({
        ...base,
        status: "blocked",
        validation_results: [
          policyValidation(false, versionPolicy.code, versionPolicy.message),
        ],
        rejection_reason: versionPolicy.message,
      });
    }

    // The policy above requires both fields. Keep the explicit guard here so
    // later refactors cannot accidentally turn that policy fact into an unsafe
    // non-null assertion at the registry boundary.
    if (!version.executor_key || !version.definition_digest) {
      return this.persistTerminal({
        ...base,
        status: "blocked",
        validation_results: [
          policyValidation(
            false,
            "executor_metadata_missing",
            "This asset version does not have complete reviewed executor metadata.",
          ),
        ],
        rejection_reason:
          "This asset version does not have complete reviewed executor metadata.",
      });
    }
    const executorKey = version.executor_key;
    const selectedDefinitionDigest = version.definition_digest;

    if (jsonByteLength(request.input) > this.inputBytes) {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "invalid",
        validation_results: [
          inputValidation(false, "The input exceeds the allowed execution size."),
        ],
        rejection_reason: "The input exceeds the allowed execution size.",
      });
    }

    const schemaResult = validateAgainstSchema(version.input_schema, request.input);
    if (!schemaResult.valid) {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "invalid",
        validation_results: [
          inputValidation(
            false,
            schemaResult.issues[0] ?? "The input does not match the declared schema.",
          ),
        ],
        rejection_reason: "The input does not match the declared schema.",
      });
    }

    const highImpactPolicy = evaluateHighImpactPolicy(request.input);
    if (!highImpactPolicy.allowed) {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "blocked",
        validated_input: request.input,
        validation_results: [
          inputValidation(true, "The input matched the declared schema."),
          policyValidation(
            false,
            highImpactPolicy.code,
            highImpactPolicy.message,
          ),
        ],
        rejection_reason: highImpactPolicy.message,
      });
    }

    let executor: VerifiedExecutor | undefined;
    try {
      // Artifact hashes are recomputed by the registry here, immediately before
      // accepting the run. This is intentionally not a cached lookup.
      executor = this.registry.resolveVerified(executorKey);
    } catch {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "blocked",
        validated_input: request.input,
        validation_results: [
          inputValidation(true, "The input matched the declared schema."),
          digestValidation(
            false,
            "executor_artifact_mismatch",
            "The reviewed executor artifacts do not match the registered manifest.",
          ),
        ],
        rejection_reason:
          "The executor failed its reviewed-artifact integrity check.",
      });
    }

    if (!executor) {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "blocked",
        validated_input: request.input,
        validation_results: [
          inputValidation(true, "The input matched the declared schema."),
          policyValidation(
            false,
            "executor_not_allowlisted",
            "The selected executor is not in the server allowlist.",
          ),
        ],
        rejection_reason: "The selected executor is not server-allowlisted.",
      });
    }

    const selectedInputDigest = sha256Digest(
      JSONValueSchema.parse(version.input_schema),
    );
    const selectedOutputDigest = sha256Digest(
      JSONValueSchema.parse(version.output_schema),
    );
    const digestMatches =
      executor.key === executorKey &&
      executor.executionMode === version.execution_kind &&
      executor.definitionDigest === selectedDefinitionDigest &&
      executor.manifest.input_schema_digest === selectedInputDigest &&
      executor.manifest.output_schema_digest === selectedOutputDigest &&
      executor.manifest.behavior_config_digest !== null &&
      executor.modelOrConfig.configuration_digest ===
        executor.manifest.behavior_config_digest;
    if (!digestMatches) {
      return this.persistTerminal({
        ...base,
        executor_key: executorKey,
        definition_digest: selectedDefinitionDigest,
        status: "blocked",
        validated_input: request.input,
        validation_results: [
          inputValidation(true, "The input matched the declared schema."),
          digestValidation(
            false,
            "definition_digest_mismatch",
            "The selected version does not match the reviewed executor definition.",
          ),
        ],
        rejection_reason:
          "The selected version and reviewed executor definition do not match.",
      });
    }

    if (
      executor.policy.networkAccess !== "none" ||
      executor.policy.filesystemAccess !== "none" ||
      executor.policy.productionSideEffects ||
      executor.policy.outboundIntegrations.length !== 0
    ) {
      return this.persistTerminal({
        ...base,
        executor_key: executor.key,
        definition_digest: executor.definitionDigest,
        status: "blocked",
        validated_input: request.input,
        validation_results: [
          inputValidation(true, "The input matched the declared schema."),
          policyValidation(
            false,
            "executor_capability_blocked",
            "This executor requests integrations or production side effects that are not approved.",
          ),
        ],
        rejection_reason:
          "The executor requests capabilities outside the approved boundary.",
      });
    }

    const validations: ValidationResult[] = [
      inputValidation(true, "The input matched the declared schema."),
      policyValidation(true, highImpactPolicy.code, highImpactPolicy.message),
      digestValidation(
        true,
        "definition_digest_verified",
        "The selected version and reviewed executor artifacts match.",
      ),
    ];
    const modelOrConfig = ModelOrConfigSchema.parse(executor.modelOrConfig);
    const acceptedBase = {
      ...base,
      executor_key: executor.key,
      definition_digest: executor.definitionDigest,
      validated_input: request.input,
      validation_results: validations,
      execution_mode: executor.executionMode,
      model_or_config: modelOrConfig,
    } as const;

    const pending = ExecutionRecordSchema.parse({
      ...acceptedBase,
      status: "pending",
      completed_at: null,
    });
    this.records.insert(pending);

    const running = ExecutionRecordSchema.parse({
      ...acceptedBase,
      status: "running",
      completed_at: null,
    });
    this.records.update(running);

    let rawOutput: unknown;
    try {
      rawOutput = await withTimeout(
        Promise.resolve().then(() =>
          executor.execute(request.input, {
            executionId,
            assetVersionId: version.asset_version_id,
            purpose,
          }),
        ),
        this.timeoutMs,
      );
    } catch (error) {
      const timedOut = error instanceof ExecutionTimeoutError;
      const failed = ExecutionRecordSchema.parse({
        ...acceptedBase,
        status: "failed",
        error: {
          code: timedOut ? "execution_timeout" : "execution_failed",
          message: timedOut
            ? "Execution exceeded the allowed time limit."
            : "The reviewed executor could not complete this run.",
          retryable: timedOut,
        },
        completed_at: resolvedTimestamp(this.clock),
      });
      this.records.update(failed);
      return { kind: "record", record: failed };
    }

    if (!isJsonStructureWithinLimits(rawOutput)) {
      const failed = ExecutionRecordSchema.parse({
        ...acceptedBase,
        status: "failed",
        validation_results: [
          ...validations,
          {
            stage: "output",
            valid: false,
            code: "output_too_complex",
            message:
              "The executor output exceeded the allowed structural limits.",
          },
        ],
        error: {
          code: "unsafe_executor_output",
          message: "The executor produced an output that could not be returned safely.",
          retryable: false,
        },
        completed_at: resolvedTimestamp(this.clock),
      });
      this.records.update(failed);
      return { kind: "record", record: failed };
    }

    const parsedOutput = JSONValueSchema.safeParse(rawOutput);
    const outputContainsSecret =
      parsedOutput.success && containsPotentialSecret(parsedOutput.data);
    if (
      !parsedOutput.success ||
      jsonByteLength(parsedOutput.data) > this.outputBytes ||
      outputContainsSecret
    ) {
      const failed = ExecutionRecordSchema.parse({
        ...acceptedBase,
        status: "failed",
        validation_results: [
          ...validations,
          {
            stage: "output",
            valid: false,
            code: !parsedOutput.success
              ? "output_not_json"
              : outputContainsSecret
                ? "potential_secret_in_output"
                : "output_too_large",
            message: !parsedOutput.success
              ? "The executor output was not valid JSON data."
              : outputContainsSecret
                ? "The executor output contained data that cannot be returned safely."
                : "The executor output exceeded the allowed size.",
          },
        ],
        error: {
          code: "unsafe_executor_output",
          message: "The executor produced an output that could not be returned safely.",
          retryable: false,
        },
        completed_at: resolvedTimestamp(this.clock),
      });
      this.records.update(failed);
      return { kind: "record", record: failed };
    }

    const outputValidation = validateAgainstSchema(
      version.output_schema,
      parsedOutput.data,
    );
    if (!outputValidation.valid) {
      const failed = ExecutionRecordSchema.parse({
        ...acceptedBase,
        status: "failed",
        validation_results: [
          ...validations,
          {
            stage: "output",
            valid: false,
            code: "output_schema_invalid",
            message:
              outputValidation.issues[0] ??
              "The output did not match the declared schema.",
          },
        ],
        error: {
          code: "output_validation_failed",
          message: "The executor output failed the declared output contract.",
          retryable: false,
        },
        completed_at: resolvedTimestamp(this.clock),
      });
      this.records.update(failed);
      return { kind: "record", record: failed };
    }

    const succeeded = ExecutionRecordSchema.parse({
      ...acceptedBase,
      status: "succeeded",
      output: parsedOutput.data,
      validation_results: [
        ...validations,
        {
          stage: "output",
          valid: true,
          code: "schema_valid",
          message: "The output matched the declared schema.",
        },
      ],
      completed_at: resolvedTimestamp(this.clock),
    });
    this.records.update(succeeded);
    return { kind: "record", record: succeeded };
  }

  private persistTerminal(
    value: Omit<ExecutionRecord, "completed_at">,
  ): ExecutionServiceResult {
    const record = ExecutionRecordSchema.parse({
      ...value,
      completed_at: resolvedTimestamp(this.clock),
    });
    this.records.insert(record);
    return { kind: "record", record };
  }
}
