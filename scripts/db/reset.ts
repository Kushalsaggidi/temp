import { resetAndSeedDemoDatabase } from "../../src/server/db/reset";

const databasePath = await resetAndSeedDemoDatabase(process.argv[2]);
console.log(`Reset, migrated, and seeded database: ${databasePath}`);
