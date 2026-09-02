import { loadServerConfig } from "@cosmora/config";
import { openDatabase, ProjectStore, runMigrations, UsageStore } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("project usage API", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let projectStore: ProjectStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    projectStore = new ProjectStore(database.sqlite);
    app = buildApp({
      config,
      database,
      projectStore,
      usageStore: new UsageStore(database.sqlite),
      modelGateway: runtime.gateway,
      manager: runtime.manager
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("returns a bounded content-free owner summary from the Usage Ledger", async () => {
    const accepted = projectStore.createProject("Summarize project usage", "usage-api-1");
    projectStore.startAssistantMessage(accepted.run.id);
    projectStore.reserveModelUsage(accepted.run.id, {
      attempt: 0,
      registry_version: "registry-private-api",
      provider_id: "provider-private-api",
      model_id: "model-private-api",
      estimated_input_tokens: 50,
      max_output_tokens: 150,
      estimated_cost: { amount: 0.4, currency: "USD" }
    });
    projectStore.completeRun(
      accepted.run.id,
      "provider-private-api",
      "model-private-api",
      { inputTokens: 31, outputTokens: 9 },
      { attempt: 0, calculatedCost: { amount: 0.2, currency: "USD" } }
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${accepted.project.id}/usage-summary`
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      project_id: accepted.project.id,
      attempts: { total: 1, reserved: 0, committed: 1, failed: 0, cancelled: 0 },
      tokens: {
        committed_input: 31,
        committed_output: 9,
        reserved_upper_bound: 0,
        unknown_committed_attempts: 0
      },
      costs: [{ currency: "USD", committed_amount: 0.2, reserved_amount: 0 }],
      unknown_committed_cost_attempts: 0,
      unknown_reserved_cost_attempts: 0
    });
    expect(response.body).not.toContain("provider-private-api");
    expect(response.body).not.toContain("model-private-api");
    expect(response.body).not.toContain("registry-private-api");
    expect(response.body).not.toContain(accepted.run.id);
  });

  it("does not disclose another owner's project or usage", async () => {
    const hidden = projectStore.createProject("Hidden usage", "usage-api-hidden-1", "other-owner");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${hidden.project.id}/usage-summary`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");
    expect(response.body).not.toContain(hidden.run.id);
  });
});
