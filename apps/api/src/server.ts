import { loadServerConfig } from "@nexus/config";
import { openDatabase, ProjectStore, runMigrations } from "@nexus/db";
import { buildApp } from "./app.js";
import { buildModelRuntime } from "./model-runtime.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);
const modelRuntime = buildModelRuntime(config);
const app = buildApp({
  config,
  database,
  projectStore: new ProjectStore(database.sqlite),
  modelGateway: modelRuntime.gateway,
  manager: modelRuntime.manager,
  closeDatabase: () => database.close()
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Shutting down Nexus API");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await runMigrations(database);
  await app.listen({ host: config.apiHost, port: config.apiPort });
} catch (error) {
  app.log.error(error, "Failed to start Nexus API");
  await app.close();
  process.exitCode = 1;
}
