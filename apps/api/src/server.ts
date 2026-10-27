import { EnvironmentSecretResolver, loadServerConfig } from "@cosmora/config";
import {
  AgentBlueprintStore,
  AgentInstanceStore,
  AgentStudioMutationStore,
  DemoManagerStore,
  ManagerWorkStore,
  EmergencyStopStore,
  IdentityStore,
  openDatabase,
  PolicyStore,
  PayStore,
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
import { GeneralChatBackgroundRunCoordinator } from "./general-chat-background-run-coordinator.js";
import { GeneralChatRuntimeStore } from "./general-chat-runtime-store.js";
import { ManagerBackgroundRunCoordinator } from "./manager-background-run-coordinator.js";
import { DemoManagerCoordinator } from "./demo-manager-coordinator.js";
import { ManagerWorkCoordinator } from "./manager-work-coordinator.js";
import { ManagerRuntimeProjectStore } from "./manager-runtime-project-store.js";
import { buildModelRuntime } from "./model-runtime.js";
import { RuntimeMetrics } from "./operations.js";
import { YooKassaGateway } from "./pay-gateway.js";

const config = loadServerConfig();
const database = openDatabase(config.databaseUrl);
let app: ReturnType<typeof buildApp> | undefined;
let managerBackgroundCoordinator: ManagerBackgroundRunCoordinator | undefined;
let generalChatBackgroundCoordinator: GeneralChatBackgroundRunCoordinator | undefined;
let managerWorkCoordinator: ManagerWorkCoordinator | undefined;
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
  await Promise.all([
    managerBackgroundCoordinator?.stop(),
    generalChatBackgroundCoordinator?.stop(),
    managerWorkCoordinator?.stop()
  ]);
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
  const generalChatStore = new GeneralChatRuntimeStore(database.sqlite);
  const demoManagerStore = new DemoManagerStore(database.sqlite);
  const emergencyStopStore = new EmergencyStopStore(database.sqlite);
  const identityStore = new IdentityStore(database.sqlite);
  // No live payment creation without explicit merchant configuration.
  const payEnabled = process.env.KOSMORA_PAY_ENABLED === "true";
  const plansRaw = process.env.KOSMORA_PAY_PLANS_JSON ?? "{}";
  const payPlans: Record<string, number> = JSON.parse(plansRaw) as Record<string, number>;
  if (typeof payPlans !== "object" || payPlans === null || Array.isArray(payPlans)) {
    throw new Error("KOSMORA_PAY_PLANS_JSON must be a JSON object");
  }
  const payGateway = payEnabled
    ? new YooKassaGateway(
        process.env.YOOKASSA_SHOP_ID ?? "",
        process.env.YOOKASSA_SECRET_KEY ?? "",
        process.env.KOSMORA_PAY_RETURN_URL ?? ""
      )
    : undefined;
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
  const managerWorkStore = new ManagerWorkStore(database.sqlite);
  const policyStore = new PolicyStore(database.sqlite);
  managerWorkCoordinator = new ManagerWorkCoordinator({
    store: managerWorkStore,
    projects: projectStore,
    policy: policyStore,
    emergency: emergencyStopStore,
    gateway: modelRuntime.gateway,
    manager: modelRuntime.manager
  });
  app = buildApp({
    config,
    database,
    identityStore,
    generalChatStore,
    projectStore,
    demoManagerStore,
    managerWorkStore,
    managerWorkCoordinator,
    demoManagerCoordinator: new DemoManagerCoordinator(demoManagerStore),
    usageStore: new UsageStore(database.sqlite),
    payStore: new PayStore(database.sqlite),
    ...(payGateway ? { payGateway } : {}),
    payPlans,
    emergencyStopStore,
    policyStore,
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
    generalChatRunExecutionMode: "background",
    closeDatabase: () => database.close()
  });
  managerBackgroundCoordinator = new ManagerBackgroundRunCoordinator({
    store: projectStore,
    modelGateway: modelRuntime.gateway,
    manager: modelRuntime.manager,
    runtimeMetrics,
    emergencyStopStore,
    logger: app.log
  });
  generalChatBackgroundCoordinator = new GeneralChatBackgroundRunCoordinator({
    store: generalChatStore,
    modelGateway: modelRuntime.gateway,
    chat: modelRuntime.chat,
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
  managerWorkCoordinator.start();
  managerBackgroundCoordinator.start();
  generalChatBackgroundCoordinator.start();
} catch (error) {
  await Promise.all([
    managerBackgroundCoordinator?.stop(),
    generalChatBackgroundCoordinator?.stop(),
    managerWorkCoordinator?.stop()
  ]);
  if (app) {
    app.log.error(error, "Failed to start Cosmora API");
    await app.close();
  } else {
    database.close();
    process.stderr.write("Failed to start Cosmora API\n");
  }
  process.exitCode = 1;
}
