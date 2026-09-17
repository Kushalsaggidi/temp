import { existsSync, rmSync } from "node:fs";

import { assertSafeResetPath, resolveDatabasePath } from "./config";
import { closeDatabase, openDatabase } from "./connection";
import { migrateDatabase } from "./migrate";
import { seedDatabase } from "./seed";
import { seedDemoCatalog } from "./seed-demo";

const SQLITE_FILES = ["", "-wal", "-shm"] as const;

export function removeDatabaseFiles(path?: string): string[] {
  const databasePath = assertSafeResetPath(resolveDatabasePath(path));
  const removedFiles: string[] = [];

  for (const suffix of SQLITE_FILES) {
    const candidate = `${databasePath}${suffix}`;
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
      removedFiles.push(candidate);
    }
  }

  return removedFiles;
}

/** Migrates and seeds the foundation bootstrap draft only. */
export function resetAndSeedDatabase(path?: string): string {
  const databasePath = assertSafeResetPath(resolveDatabasePath(path));
  removeDatabaseFiles(databasePath);

  const database = openDatabase(databasePath);
  try {
    migrateDatabase(database);
    seedDatabase(database);
  } finally {
    closeDatabase(database);
  }

  return databasePath;
}

/**
 * Resets to the full demo state. This is what `npm run db:reset` runs, so the
 * documented setup leaves a populated catalog and a runnable hero rather than
 * an empty marketplace.
 */
export async function resetAndSeedDemoDatabase(path?: string): Promise<string> {
  const databasePath = resetAndSeedDatabase(path);
  const database = openDatabase(databasePath);
  try {
    await seedDemoCatalog(database);
  } finally {
    closeDatabase(database);
  }
  return databasePath;
}
