import type { AssetVersionRecord } from "../../contracts";
import { closeDatabase, openDatabase } from "../../server/db/connection";
import { migrateDatabase } from "../../server/db/migrate";
import { CatalogRepository } from "./repository";

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  getAdminVersionById(assetVersionId: string): AssetVersionRecord | null {
    return this.repository.getAdminVersionById(assetVersionId);
  }

  listPublished(): AssetVersionRecord[] {
    return this.repository.listPublished();
  }
}

export async function withCatalogService<T>(
  operation: (service: CatalogService) => T | Promise<T>,
  path?: string,
): Promise<T> {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    const service = new CatalogService(new CatalogRepository(database));
    return await operation(service);
  } finally {
    closeDatabase(database);
  }
}
