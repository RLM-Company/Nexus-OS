import { EnvironmentSecretResolver, loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  AgentStudioMutationStore,
  DemoManagerStore,
  EmergencyStopStore,
  GeneralChatStore,
  IdentityStore,
  openDatabase,
  PolicyStore,
  PatternLibraryStore,
  runMigrations,
  StepUpProofStore,
  UsageStore
} from "@cosmora/db";
import { validateAgentDelegation } from "@cosmora/policy-engine";
import { buildApp } from "./app.js";
import {
  BearerSessionIdentityResolver,
  LOCAL_DEVELOPMENT_IDENTITY,
  StaticIdentityResolver,
  StoredStepUpProofConsumer
} from "./identity.js";
import { ManagerBackgroundRunCoordinator } from "./manager-background-run-coordinator.js";
import { DemoManagerCoordinator } from "./demo-manager-coordinator.js";
import { ManagerRuntimeProjectStore } from "./manager-runtime-project-store.js";
import { buildModelRuntime } from "./model-runtime.js";
import { RuntimeMetrics } from "./operations.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);
let app: ReturnType<typeof buildApp> | undefined;
let backgroundCoordinator: ManagerBackgroundRunCoordinator | undefined;
let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!app) {
    database.close();
    process.exitCode = 0;
    return;
  }
  app.log.info({ signal }, "Shutting down Cosmora API");
  await backgroundCoordinator?.stop();
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
  const projectStore = new ManagerRuntimeProjectStore(database.sqlite);
  const generalChatStore = new GeneralChatStore(database.sqlite);
  const demoManagerStore = new DemoManagerStore(database.sqlite);
  const emergencyStopStore = new EmergencyStopStore(database.sqlite);
  const identityStore = new IdentityStore(database.sqlite);
  const stepUpProofStore = new StepUpProofStore(database.sqlite);
  const runtimeMetrics = new RuntimeMetrics();
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
  const recoveredChatRuns = generalChatStore.recoverInterruptedRuns();
  app = buildApp({
    config,
    database,
    identityStore,
    generalChatStore,
    projectStore,
    demoManagerStore,
    demoManagerCoordinator: new DemoManagerCoordinator(demoManagerStore),
    usageStore: new UsageStore(database.sqlite),
    emergencyStopStore,
    policyStore: new PolicyStore(database.sqlite),
    patternLibraryStore: new PatternLibraryStore(database.sqlite),
    agentBlueprintStore: new AgentBlueprintStore(database.sqlite),
    agentInstanceStore: new AgentInstanceStore(database.sqlite, {
      delegationValidator: validateAgentDelegation
    }),
    agentStudioMutationStore: new AgentStudioMutationStore(database.sqlite),
    modelGateway: modelRuntime.gateway,
    chat: modelRuntime.chat,
    manager: modelRuntime.manager,
    modelRegistryVersion: modelRuntime.registryVersion,
    identityResolver,
    stepUpProofConsumer: new StoredStepUpProofConsumer(stepUpProofStore),
    runtimeMetrics,
    managerRunExecutionMode: "background",
    closeDatabase: () => database.close()
  });
  backgroundCoordinator = new ManagerBackgroundRunCoordinator({
    store: projectStore,
    modelGateway: modelRuntime.gateway,
    manager: modelRuntime.manager,
    runtimeMetrics,
    emergencyStopStore,
    logger: app.log
  });
  if (recoveredRuns > 0) {
    app.log.warn({ recoveredRuns }, "Recovered interrupted runs after restart");
  }
  if (recoveredChatRuns > 0) {
    app.log.warn({ recoveredChatRuns }, "Recovered interrupted ordinary-chat runs after restart");
  }
  await app.listen({ host: config.apiHost, port: config.apiPort });
  backgroundCoordinator.start();
} catch (error) {
  await backgroundCoordinator?.stop();
  if (app) {
    app.log.error(error, "Failed to start Cosmora API");
    await app.close();
  } else {
    database.close();
    process.stderr.write("Failed to start Cosmora API\n");
  }
  process.exitCode = 1;
}
