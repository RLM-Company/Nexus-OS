import { loadServerConfig } from "@cosmora/config";
import { openDatabase, ProjectStore, runMigrations, UsageStore } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { StepUpProofConsumption } from "../src/identity.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { projectUsageLimitStepUpChallenge } from "../src/step-up-challenge.js";

describe("project usage API", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let projectStore: ProjectStore;
  let app: ReturnType<typeof buildApp>;
  let consumedStepUps: StepUpProofConsumption[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    projectStore = new ProjectStore(database.sqlite);
    consumedStepUps = [];
    app = buildApp({
      config,
      database,
      projectStore,
      usageStore: new UsageStore(database.sqlite),
      modelGateway: runtime.gateway,
      manager: runtime.manager,
      stepUpProofConsumer: {
        consume: (input) => {
          consumedStepUps.push(input);
          return Promise.resolve(input.token === "valid-step-up");
        }
      }
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

    const limit = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${hidden.project.id}/usage-limit`
    });
    expect(limit.statusCode).toBe(404);
    expect(limit.body).not.toContain(hidden.run.id);
  });

  it("previews and applies a restrictive versioned limit without step-up", async () => {
    const accepted = projectStore.createProject("Configure usage limits", "usage-limit-api-1");

    const initial = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      limit: {
        project_id: accepted.project.id,
        version: 1,
        max_total_tokens: null,
        max_cost: null
      }
    });

    const input = {
      expected_version: 1,
      max_total_tokens: 10_000,
      max_cost: { amount: 2, currency: "USD" }
    };
    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit/preview`,
      payload: input
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      current_version: 1,
      proposed_limit: {
        version: 2,
        max_total_tokens: 10_000,
        max_cost: { amount: 2, currency: "USD" }
      },
      requires_step_up: false
    });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`,
      payload: input
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      limit: {
        version: 2,
        max_total_tokens: 10_000,
        max_cost: { amount: 2, currency: "USD" }
      }
    });

    const expansion = {
      expected_version: 2,
      max_total_tokens: 20_000,
      max_cost: { amount: 3, currency: "USD" }
    };
    const expansionPreview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit/preview`,
      payload: expansion
    });
    expect(expansionPreview.json<{ requires_step_up: boolean }>().requires_step_up).toBe(true);
    const forbidden = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`,
      payload: expansion
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ error: { code: string } }>().error.code).toBe("STEP_UP_REQUIRED");

    const stale = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`,
      payload: input
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("USAGE_LIMIT_CONFLICT");
  });

  it("rejects values that could otherwise be coerced into an unlimited project ceiling", async () => {
    const accepted = projectStore.createProject("Reject unsafe limits", "usage-limit-invalid-1");

    const zeroTokens = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit/preview`,
      payload: { expected_version: 1, max_total_tokens: 0, max_cost: null }
    });
    const numericCost = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit/preview`,
      payload: { expected_version: 1, max_total_tokens: null, max_cost: 0 }
    });

    expect(zeroTokens.statusCode).toBe(400);
    expect(numericCost.statusCode).toBe(400);

    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`
    });
    expect(stored.json()).toMatchObject({
      limit: { version: 1, max_total_tokens: null, max_cost: null }
    });
  });

  it("fails a run before provider output when the project token ceiling is exhausted", async () => {
    const accepted = projectStore.createProject(
      "Block before provider output",
      "usage-limit-run-1"
    );
    const limit = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`,
      payload: { expected_version: 1, max_total_tokens: 1, max_cost: null }
    });
    expect(limit.statusCode).toBe(200);

    const events = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${accepted.run.id}/events`
    });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain("PROJECT_TOKEN_LIMIT_EXCEEDED");
    expect(events.body).not.toContain("message.delta");
    expect(projectStore.getModelUsageForRun(accepted.run.id)).toEqual([]);
    expect(projectStore.getRun(accepted.run.id)?.status).toBe("failed");
  });

  it("binds a successful expansion step-up to the exact proposed project limit", async () => {
    const accepted = projectStore.createProject("Expand usage limits", "usage-limit-step-up-1");
    const usageStore = new UsageStore(database.sqlite);
    usageStore.ensureLimit(accepted.project.id);
    usageStore.updateLimit(accepted.project.id, {
      expected_version: 1,
      max_total_tokens: 100,
      max_cost: null
    });

    const expanded = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${accepted.project.id}/usage-limit`,
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { expected_version: 2, max_total_tokens: 200, max_cost: null }
    });
    expect(expanded.statusCode).toBe(200);
    expect(expanded.json()).toMatchObject({
      limit: { version: 3, max_total_tokens: 200, max_cost: null }
    });
    expect(consumedStepUps).toHaveLength(1);
    expect(consumedStepUps[0]).toMatchObject({
      token: "valid-step-up",
      purpose: "project_usage_limit_expansion",
      challenge: projectUsageLimitStepUpChallenge(accepted.project.id, {
        expected_version: 2,
        max_total_tokens: 200,
        max_cost: null
      })
    });
  });
});
