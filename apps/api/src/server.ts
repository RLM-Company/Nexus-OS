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
import { GithubIntegration, GithubDraftStore } from "./github-integration.js";
import { WebSearch } from "./web-search.js";
import { AccountStore } from "./account-settings/account-store.js";
import { loadModelRegistryDocument } from "./model-runtime.js";
import { ResearchStore } from "./research/research-store.js";
import { MediaService } from "./media/media-service.js";

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
  app.log.info({ signal }, "Shutting down Kosmora API");
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
  const accountStore = new AccountStore(database.sqlite);
  const modelRuntime = await buildModelRuntime(config, {
    secretResolver: new EnvironmentSecretResolver()
  });
  const projectStore = new ManagerRuntimeProjectStore(database.sqlite);
  const generalChatStore = new GeneralChatRuntimeStore(database.sqlite);
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
  const managerWorkStore = new ManagerWorkStore(database.sqlite);
  const policyStore = new PolicyStore(database.sqlite);
  managerWorkCoordinator = new ManagerWorkCoordinator({
    ownerBudget: accountStore,
    store: managerWorkStore,
    projects: projectStore,
    policy: policyStore,
    emergency: emergencyStopStore,
    gateway: modelRuntime.gateway,
    manager: modelRuntime.manager
  });
  const mediaService = new MediaService({
    ...(process.env.KOSMORA_MEDIA_DIR
      ? { directory: process.env.KOSMORA_MEDIA_DIR }
      : config.nodeEnv === "production"
        ? { directory: "/var/lib/cosmora/media" }
        : {}),
    ...(process.env.KOSMORA_MEDIA_OPENAI_API_KEY
      ? { apiKey: process.env.KOSMORA_MEDIA_OPENAI_API_KEY }
      : {}),
    paidEnabled: process.env.KOSMORA_MEDIA_PAID_ENABLED === "true",
    emergencyStopped: () => emergencyStopStore.getProcessStop() !== null
  });
  app = buildApp({
    researchStore: new ResearchStore(database.sqlite),
    mediaService,
    webSearch: new WebSearch(process.env.WEB_SEARCH_ORIGIN),
    githubIntegration: new GithubIntegration({
      ownerId:
        process.env.GITHUB_OWNER_ID ?? (config.nodeEnv === "production" ? "" : "local-owner"),
      ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
      ...(process.env.GITHUB_REPOSITORY ? { repository: process.env.GITHUB_REPOSITORY } : {})
    }),
    githubDraftStore: new GithubDraftStore(database.sqlite),
    config,
    database,
    accountStore,
    accountModel: (() => {
      const entry = loadModelRegistryDocument(
        config.modelRegistryPath ?? "config/model-registry.v1.json"
      ).entries.find(
        (e) => e.provider_id === config.modelProviderId && e.model_id === config.modelName
      );
      return {
        provider: config.modelProviderId,
        model: config.modelName,
        capabilities: {
          streaming: Boolean(entry?.capabilities.streaming),
          vision: Boolean(entry?.capabilities.vision)
        }
      };
    })(),
    identityStore,
    generalChatStore,
    projectStore,
    demoManagerStore,
    managerWorkStore,
    managerWorkCoordinator,
    demoManagerCoordinator: new DemoManagerCoordinator(demoManagerStore),
    usageStore: new UsageStore(database.sqlite),
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
    accountStore,
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
    logger: app.log,
    accountStore
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
    app.log.error(error, "Failed to start Kosmora API");
    await app.close();
  } else {
    database.close();
    process.stderr.write("Failed to start Kosmora API\n");
  }
  process.exitCode = 1;
}
