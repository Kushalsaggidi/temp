import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveDatabasePath } from "./config";

export type MarketplaceDatabase = DatabaseSync;

export function openDatabase(path?: string): MarketplaceDatabase {
  const databasePath = resolveDatabasePath(path);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");

  return database;
}

export function closeDatabase(database: MarketplaceDatabase): void {
  database.close();
}
