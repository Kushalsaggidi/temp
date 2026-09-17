import { isDeepStrictEqual } from "node:util";

import {
  AssetVersionIdSchema,
  ExecutionIdSchema,
  ExecutionRecordSchema,
  type ExecutionRecord,
} from "../../contracts";
import type { MarketplaceDatabase } from "../../server/db/connection";

interface ExecutionRow {
  execution_id: string;
  asset_id: string;
  asset_version_id: string;
  purpose: string;
  status: string;
  record_json: string;
  started_at: string;
  completed_at: string | null;
}

const SELECT_EXECUTION = `
  SELECT
    execution_id,
    asset_id,
    asset_version_id,
    purpose,
    status,
    record_json,
    started_at,
    completed_at
  FROM executions
`;

const IMMUTABLE_RECORD_FIELDS = [
  "execution_id",
  "asset_id",
  "asset_version_id",
  "asset_version",
  "executor_key",
  "definition_digest",
  "purpose",
  "scenario_label",
  "validated_input",
  "execution_mode",
  "model_or_config",
  "started_at",
] as const satisfies readonly (keyof ExecutionRecord)[];

const TERMINAL_STATUSES = new Set<ExecutionRecord["status"]>([
  "succeeded",
  "failed",
  "invalid",
  "blocked",
]);

const ALLOWED_INITIAL_STATUSES = new Set<ExecutionRecord["status"]>([
  "pending",
  "invalid",
  "blocked",
]);

function parseRow(row: ExecutionRow): ExecutionRecord {
  const record = ExecutionRecordSchema.parse(JSON.parse(row.record_json));

  if (
    record.execution_id !== row.execution_id ||
    record.asset_id !== row.asset_id ||
    record.asset_version_id !== row.asset_version_id ||
    record.purpose !== row.purpose ||
    record.status !== row.status ||
    record.started_at !== row.started_at ||
    record.completed_at !== row.completed_at
  ) {
    throw new Error(
      `Execution row ${row.execution_id} disagrees with its canonical record JSON.`,
    );
  }

  return record;
}

function assertTransitionAllowed(
  previous: ExecutionRecord,
  next: ExecutionRecord,
): void {
  if (TERMINAL_STATUSES.has(previous.status)) {
    throw new Error(`Execution ${previous.execution_id} is already terminal.`);
  }

  for (const field of IMMUTABLE_RECORD_FIELDS) {
    if (!isDeepStrictEqual(previous[field], next[field])) {
      throw new Error(
        `Execution ${previous.execution_id} cannot change immutable field ${field}.`,
      );
    }
  }

  const allowedNextStatuses =
    previous.status === "pending"
      ? new Set<ExecutionRecord["status"]>([
          "running",
          "succeeded",
          "failed",
          "blocked",
        ])
      : new Set<ExecutionRecord["status"]>(["succeeded", "failed", "blocked"]);

  if (!allowedNextStatuses.has(next.status)) {
    throw new Error(
      `Execution ${previous.execution_id} cannot transition from ${previous.status} to ${next.status}.`,
    );
  }
}

/**
 * Persists canonical execution records while keeping the queryable columns and
 * record JSON in the same SQLite statement. Reads validate both representations.
 */
export class ExecutionRepository {
  constructor(private readonly database: MarketplaceDatabase) {}

  insert(recordValue: unknown): ExecutionRecord {
    const record = ExecutionRecordSchema.parse(recordValue);
    if (!ALLOWED_INITIAL_STATUSES.has(record.status)) {
      throw new Error(
        `Execution ${record.execution_id} cannot be inserted directly with status ${record.status}.`,
      );
    }

    this.database
      .prepare(`
        INSERT INTO executions (
          execution_id,
          asset_id,
          asset_version_id,
          purpose,
          status,
          record_json,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.execution_id,
        record.asset_id,
        record.asset_version_id,
        record.purpose,
        record.status,
        JSON.stringify(record),
        record.started_at,
        record.completed_at,
      );

    return this.requireById(record.execution_id);
  }

  update(recordValue: unknown): ExecutionRecord {
    const record = ExecutionRecordSchema.parse(recordValue);
    const previous = this.getById(record.execution_id);
    if (previous === null) {
      throw new Error(`Execution ${record.execution_id} does not exist.`);
    }
    assertTransitionAllowed(previous, record);

    const previousJson = JSON.stringify(previous);
    const result = this.database
      .prepare(`
        UPDATE executions
        SET purpose = ?,
            status = ?,
            record_json = ?,
            started_at = ?,
            completed_at = ?
        WHERE execution_id = ?
          AND record_json = ?
      `)
      .run(
        record.purpose,
        record.status,
        JSON.stringify(record),
        record.started_at,
        record.completed_at,
        record.execution_id,
        previousJson,
      );

    if (Number(result.changes) !== 1) {
      throw new Error(
        `Execution ${record.execution_id} changed concurrently; transition was not persisted.`,
      );
    }

    return this.requireById(record.execution_id);
  }

  getById(executionIdValue: string): ExecutionRecord | null {
    const executionId = ExecutionIdSchema.parse(executionIdValue);
    const row = this.database
      .prepare(`${SELECT_EXECUTION} WHERE execution_id = ?`)
      .get(executionId) as unknown as ExecutionRow | undefined;

    return row === undefined ? null : parseRow(row);
  }

  listByAssetVersionId(assetVersionIdValue: string): ExecutionRecord[] {
    const assetVersionId = AssetVersionIdSchema.parse(assetVersionIdValue);
    const rows = this.database
      .prepare(`
        ${SELECT_EXECUTION}
        WHERE asset_version_id = ?
        ORDER BY started_at, execution_id
      `)
      .all(assetVersionId) as unknown as ExecutionRow[];

    return rows.map(parseRow);
  }

  listByIds(executionIdValues: readonly string[]): ExecutionRecord[] {
    const executionIds = executionIdValues.map((value) =>
      ExecutionIdSchema.parse(value),
    );
    if (executionIds.length === 0) {
      return [];
    }

    const placeholders = executionIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(`
        ${SELECT_EXECUTION}
        WHERE execution_id IN (${placeholders})
        ORDER BY started_at, execution_id
      `)
      .all(...executionIds) as unknown as ExecutionRow[];

    return rows.map(parseRow);
  }

  private requireById(executionId: string): ExecutionRecord {
    const record = this.getById(executionId);
    if (record === null) {
      throw new Error(`Execution ${executionId} was not persisted.`);
    }
    return record;
  }
}
