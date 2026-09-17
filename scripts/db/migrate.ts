import { closeDatabase, openDatabase } from "../../src/server/db/connection";
import { resolveDatabasePath } from "../../src/server/db/config";
import { migrateDatabase } from "../../src/server/db/migrate";

const requestedPath = process.argv[2];
const databasePath = resolveDatabasePath(requestedPath);
const database = openDatabase(databasePath);

try {
  const migrations = migrateDatabase(database);
  if (migrations.length === 0) {
    console.log(`Database already up to date: ${databasePath}`);
  } else {
    console.log(
      `Applied ${migrations.length} migration(s) to ${databasePath}: ${migrations
        .map(({ version, name }) => `${version}_${name}`)
        .join(", ")}`,
    );
  }
} finally {
  closeDatabase(database);
}
