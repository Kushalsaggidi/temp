import {
  ExecutionRecordSchema,
  ExecutionRequestSchema,
  type ExecutionRecord,
  type ExecutionRequest,
} from "../../contracts";

/** Server-code capability supplied by the execution service, never by a request. */
export interface PrepublicationExecutionEntryPoint {
  executePrepublication(value: ExecutionRequest): Promise<
    | { kind: "record"; record: ExecutionRecord }
    | {
        kind: "request_error";
        status: 400 | 404;
        error: { code: string; message: string };
      }
  >;
}

export interface MaintainerExecutionHarness {
  runScenario(request: unknown): Promise<ExecutionRecord>;
}

/**
 * Creates the non-HTTP maintainer test boundary. The returned object exposes no
 * general execute method and the canonical request has no purpose or executor
 * selection field for a caller to override.
 */
export function createMaintainerExecutionHarness(
  entryPoint: PrepublicationExecutionEntryPoint,
): MaintainerExecutionHarness {
  return Object.freeze({
    async runScenario(requestValue: unknown): Promise<ExecutionRecord> {
      const request = ExecutionRequestSchema.parse(requestValue);
      const result = await entryPoint.executePrepublication(request);
      if (result.kind !== "record") {
        throw new Error(
          `Prepublication scenario rejected: ${result.error.code}.`,
        );
      }
      const record = ExecutionRecordSchema.parse(result.record);

      if (record.purpose !== "prepublication_test") {
        throw new Error(
          "The maintainer harness accepts only prepublication execution records.",
        );
      }
      if (record.asset_version_id !== request.asset_version_id) {
        throw new Error(
          "The prepublication result does not match the selected asset version.",
        );
      }
      if (
        request.scenario_label !== undefined &&
        record.scenario_label !== request.scenario_label
      ) {
        throw new Error(
          "The prepublication result does not match the requested scenario.",
        );
      }

      return record;
    },
  });
}
