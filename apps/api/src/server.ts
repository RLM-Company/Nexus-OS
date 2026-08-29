import { EnvironmentSecretResolver, loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  EmergencyStopStore,
  IdentityStore,
  openDatabase,
  PolicyStore,
  PatternLibraryStore,
  ProjectStore,
  runMigrations,
  StepUpProofStore
} from "@cosmora/db";
import { buildApp } from "./app.js";
import {
  BearerSessionIdentityResolver,
  LOCAL_DEVELOPMENT_IDENTITY,
  StaticIdentityResolver,
  StoredStepUpProofConsumer
} from "./identity.js";
import { buildModelRuntime } from "./model-runtime.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);
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
  const modelRuntime = await buildModelRuntime(config, {
    secretResolver: new EnvironmentSecretResolver()
  });
  const projectStore = new ProjectStore(database.sqlite);
  const emergencyStopStore = new EmergencyStopStore(database.sqlite);
  const identityStore = new IdentityStore(database.sqlite);
  const stepUpProofStore = new StepUpProofStore(database.sqlite);
  const identityResolver =
    config.nodeEnv === "production"
      ? new BearerSessionIdentityResolver(identityStore)
      : new StaticIdentityResolver(LOCAL_DEVELOPMENT_IDENTITY);
  if (config.runtimeEmergencyStop) {
    emergencyStopStore.activateProcess(
      "RUNTIME_EMERGENCY_STOP environment switch",
      "system:environment"
    );
  }
  const recoveredRuns = projectStore.recoverInterruptedRuns();
  app = buildApp({
    config,
    database,
    identityStore,
    projectStore,
    emergencyStopStore,
    policyStore: new PolicyStore(database.sqlite),
    patternLibraryStore: new PatternLibraryStore(database.sqlite),
    agentBlueprintStore: new AgentBlueprintStore(database.sqlite),
    agentInstanceStore: new AgentInstanceStore(database.sqlite),
    modelGateway: modelRuntime.gateway,
    manager: modelRuntime.manager,
    modelRegistryVersion: modelRuntime.registryVersion,
    identityResolver,
    stepUpProofConsumer: new StoredStepUpProofConsumer(stepUpProofStore),
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
