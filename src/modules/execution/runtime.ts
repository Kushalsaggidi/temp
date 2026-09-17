import { CatalogRepository } from "@/modules/catalog";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";
import { SystemClock } from "@/shared/ports/clock";
import { CryptoIdGenerator } from "@/shared/ports/id-generator";

import { ExecutionRepository } from "./repository";
import { serverExecutorRegistry } from "./registry";
import { assertExecutionCatalogReadiness } from "./readiness";
import { ExecutionService } from "./service";

export function assertExecutionRuntimeReady(path?: string): void {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    assertExecutionCatalogReadiness(database, serverExecutorRegistry);
  } finally {
    closeDatabase(database);
  }
}

export async function withExecutionService<T>(
  operation: (service: ExecutionService) => T | Promise<T>,
  path?: string,
): Promise<T> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    assertExecutionCatalogReadiness(database, serverExecutorRegistry);
    const service = new ExecutionService(
      new CatalogRepository(database),
      new ExecutionRepository(database),
      serverExecutorRegistry,
      new SystemClock(),
      new CryptoIdGenerator(),
    );
    return await operation(service);
  } finally {
    closeDatabase(database);
  }
}
