import { loadServerConfig } from "../../packages/config/dist/index.js";
import { EmergencyStopStore, openDatabase, runMigrations } from "../../packages/db/dist/index.js";
import { ModelRegistry, ModelRouter } from "../../packages/model-gateway/dist/index.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../../apps/api/dist/model-runtime.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const config = loadServerConfig();
assert(config.nodeEnv === "production", "Production mode is required");
assert(config.modelProvider !== "mock", "An external model route is required");
assert(!config.modelFallbackToMock, "Mock fallback must be disabled");
assert(config.modelApiKeyConfigured, "Model credential is missing");
assert(config.modelRegistryPath, "An explicit reviewed Model Registry is required");
assert(config.modelMaxAttemptsPerRoute === 1, "First trial must allow one attempt per route");
assert(!config.runtimeEmergencyStop, "Environment emergency stop is active");

const document = loadModelRegistryDocument(config.modelRegistryPath);
const registry = new ModelRegistry(document);
const router = new ModelRouter(registry);
await buildModelRuntime(config);
const roles = [
  ["manager", "manager_work_plan"],
  ["analyst", "manager_work_draft"],
  ["critic", "manager_work_review"]
];
for (const [role, task_type] of roles) {
  const route = router.resolve({
    role,
    task_type,
    preferred_provider: config.modelProviderId,
    preferred_model_alias: config.modelName,
    required_features: ["streaming"],
    confidential: false,
    estimated_input_tokens: 8_000,
    max_output_tokens: config.managerMaxOutputTokens,
    max_cost: null,
    optimize_for: "balanced"
  });
  assert(
    route.provider_id === config.modelProviderId && route.model_id === config.modelName,
    `Unexpected route for ${role}:${task_type}`
  );
}

const database = openDatabase(config.databaseUrl);
try {
  await runMigrations(database);
  database.ping();
  const stops = new EmergencyStopStore(database.sqlite);
  assert(!stops.getProcessStop(), "Process emergency stop is active");
  assert(
    stops.countActiveProjectStops("hosted-alpha-owner") === 0,
    "Project emergency stop is active"
  );
} finally {
  database.close();
}

const entry = registry.get(config.modelProviderId, config.modelName);
process.stdout.write(
  [
    "Hosted Manager preflight PASS (no provider request sent)",
    `Registry: ${registry.version}`,
    `Route: ${config.modelProviderId}:${config.modelName}`,
    "Manager / Analyst / Critic stages: routable",
    "SQLite and emergency stops: clear",
    entry?.pricing
      ? "Pricing evidence: present"
      : "Pricing evidence: unknown; no monetary cap proven"
  ].join("\n") + "\n"
);
