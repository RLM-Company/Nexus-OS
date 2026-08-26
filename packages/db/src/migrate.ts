import { loadServerConfig } from "@cosmora/config";
import { openDatabase, runMigrations } from "./index.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);

try {
  await runMigrations(database);
  process.stdout.write(`SQLite migrations applied to ${config.databaseUrl}\n`);
} finally {
  database.close();
}
