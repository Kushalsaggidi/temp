import { closeDatabase, openDatabase } from "../../src/server/db/connection";
import { resolveDatabasePath } from "../../src/server/db/config";
import { seedDatabase, seedPublishedCatalog } from "../../src/server/db/seed";

const requestedPath = process.argv[2];
const databasePath = resolveDatabasePath(requestedPath);
const database = openDatabase(databasePath);

try {
  const seeded = seedDatabase(database);
  seedPublishedCatalog(database);
  console.log(
    `Seeded ${seeded.asset_version.asset_version_id} as ${seeded.asset_version.lifecycle} in ${databasePath}`,
  );
} finally {
  closeDatabase(database);
}
