import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { MarketplaceDatabase } from "./connection";
import { PROJECT_ROOT } from "./config";

const MIGRATION_FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/;

export interface AppliedMigration {
  version: number;
  name: string;
}

interface MigrationFile extends AppliedMigration {
  checksum: string;
  sql: string;
}

interface AppliedMigrationRow extends AppliedMigration {
  checksum: string;
}

function readMigrations(): MigrationFile[] {
  const migrationDirectory = resolve(PROJECT_ROOT, "db", "migrations");
  const migrations = readdirSync(migrationDirectory)
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .map((fileName) => {
      const match = MIGRATION_FILE_PATTERN.exec(fileName);
      if (!match) {
        throw new Error(`Invalid migration file name: ${fileName}`);
      }

      const sql = readFileSync(resolve(migrationDirectory, fileName), "utf8");
      return {
        version: Number.parseInt(match[1], 10),
        name: match[2],
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    })
    .sort((left, right) => left.version - right.version);

  const seenVersions = new Set<number>();
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) {
      throw new Error(`Duplicate database migration version: ${migration.version}`);
    }
    seenVersions.add(migration.version);
  }

  return migrations;
}

export function migrateDatabase(database: MarketplaceDatabase): AppliedMigration[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  const appliedRows = database
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all() as unknown as AppliedMigrationRow[];
  const appliedByVersion = new Map(
    appliedRows.map((migration) => [migration.version, migration]),
  );
  const newlyApplied: AppliedMigration[] = [];

  for (const migration of readMigrations()) {
    const appliedMigration = appliedByVersion.get(migration.version);
    if (appliedMigration !== undefined) {
      if (appliedMigration.name !== migration.name) {
        throw new Error(
          `Migration ${migration.version} was applied as ${appliedMigration.name}, ` +
            `but the file is now named ${migration.name}.`,
        );
      }
      if (appliedMigration.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.version}_${migration.name} changed after it was applied.`,
        );
      }
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          migration.version,
          migration.name,
          migration.checksum,
          new Date().toISOString(),
        );
      database.exec("COMMIT");
      newlyApplied.push({ version: migration.version, name: migration.name });
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return newlyApplied;
}
