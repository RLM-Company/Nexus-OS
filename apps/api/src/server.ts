import { loadServerConfig } from "@cosmora/config";
import { openDatabase, PolicyStore, ProjectStore, runMigrations } from "@cosmora/db";
import { buildApp } from "./app.js";
import { buildModelRuntime } from "./model-runtime.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);
const modelRuntime = buildModelRuntime(config);
let app: ReturnType<typeof buildApp> | undefined;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (!app) {
    database.close();
    process.exitCode = 0;
    return;
  }
  app.log.info({ signal }, "Shutting down Cosmora API");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await runMigrations(database);
  const projectStore = new ProjectStore(database.sqlite);
  const recoveredRuns = projectStore.recoverInterruptedRuns();
  app = buildApp({
    config,
    database,
    projectStore,
    policyStore: new PolicyStore(database.sqlite),
    modelGateway: modelRuntime.gateway,
    manager: modelRuntime.manager,
    closeDatabase: () => database.close()
  });
  if (recoveredRuns > 0) {
    app.log.warn({ recoveredRuns }, "Recovered interrupted runs after restart");
  }
  await app.listen({ host: config.apiHost, port: config.apiPort });
} catch (error) {
  if (app) {
    app.log.error(error, "Failed to start Cosmora API");
    await app.close();
  } else {
    database.close();
    process.stderr.write("Failed to start Cosmora API\n");
  }
  process.exitCode = 1;
}
