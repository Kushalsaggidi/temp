import { ExecutionRepository, serverExecutorRegistry } from "@/modules/execution";
import { closeDatabase, openDatabase } from "@/server/db/connection";
import { migrateDatabase } from "@/server/db/migrate";
import { SystemClock } from "@/shared/ports/clock";
import { CryptoIdGenerator } from "@/shared/ports/id-generator";

import { GovernanceRepository } from "./repository";
import { GovernanceService } from "./service";

export async function withGovernanceService<T>(
  operation: (service: GovernanceService) => T | Promise<T>,
  path?: string,
): Promise<T> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const service = new GovernanceService(
      new GovernanceRepository(database),
      new SystemClock(),
      new CryptoIdGenerator(),
      serverExecutorRegistry,
      new ExecutionRepository(database),
    );
    return await operation(service);
  } finally {
    closeDatabase(database);
  }
}

