import type {
  ModelRegistryDocument,
  ModelRegistryEntry,
  ModelRequest,
  ModelRouteRequest
} from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelGatewayStreamEvent,
  type ModelProviderAdapter
} from "../src/index.js";

const answer = "Ответ: 42";
const routeRequest = (optimize_for: "balanced" | "latency"): ModelRouteRequest => ({
  role: "manager",
  task_type: "project_chat",
  preferred_provider: null,
  preferred_model_alias: "manager",
  required_features: ["streaming"],
  confidential: false,
  estimated_input_tokens: 40,
  max_output_tokens: 200,
  max_cost: null,
  optimize_for
});

const makeRequest = (optimize_for: "balanced" | "latency"): ModelRequest => ({
  request_id: "speed-request",
  project_id: "speed-project",
  run_id: "speed-run",
  agent_id: "manager",
  role: "manager",
  task_type: "project_chat",
  messages: [
    { role: "system", content: "Отвечай kurz" },
    { role: "user", content: "Сколько будет 40+2?" }
  ],
  constraints: { timeout_ms: 5_000, max_output_tokens: 200 },
  routing: {
    preferred_provider: "baseline",
    preferred_model_alias: "manager",
    fallback_allowed: false,
    required_features: ["streaming"],
    confidential: false,
    estimated_input_tokens: 40,
    max_cost: null,
    optimize_for
  },
  idempotency_key: "speed-idem"
});

const entry = (overrides: Partial<ModelRegistryEntry>): ModelRegistryEntry => ({
  provider_id: "baseline",
  model_id: "baseline-1",
  aliases: ["baseline"],
  protocol: "mock",
  status: "active",
  roles: ["manager"],
  task_types: ["project_chat"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 4_000,
  max_output_tokens: 200,
  quality_tier: 3,
  latency_tier: 4,
  pricing: { currency: "USD", input_per_million_tokens: 0, output_per_million_tokens: 0 },
  privacy: { confidential_compatible: true, training_usage: "none", retention: "zero" },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-08-24T00:00:00.000Z",
    valid_until: "2099-08-24T00:00:00.000Z",
    reference: "speed-fixture"
  },
  ...overrides
});

const adapter = (id: string, delayMs: number): ModelProviderAdapter => ({
  id,
  modelId: id + "-1",
  async *stream(_request, signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (signal.aborted) return;
    yield { type: "text.delta", delta: answer };
    yield {
      type: "response.completed",
      provider: id,
      model: id + "-1",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 5 }
    };
  }
});

const run = async (gateway: ModelGateway, request: ModelRequest) => {
  const events: ModelGatewayStreamEvent[] = [];
  for await (const event of gateway.stream(request)) events.push(event);
  const completed = events.find((e) => e.type === "response.completed");
  if (!completed || completed.type !== "response.completed") throw new Error("no completion");
  const text = events
    .filter((e) => e.type === "text.delta")
    .map((e) => (e as { delta: string }).delta)
    .join("");
  return {
    route: completed.route.provider_id,
    text,
    usage: completed.usage,
    timing: completed.timing
  };
};

describe("developer speed profile (synthetic fixture, no live provider)", () => {
  it("measures baseline vs explicitly enabled fast route with equal quality", async () => {
    const document: ModelRegistryDocument = {
      schema_version: 1,
      registry_version: "speed-fixture-1",
      generated_at: "2026-08-24T00:00:00.000Z",
      entries: [
        entry({ provider_id: "baseline", model_id: "baseline-1", aliases: ["manager"] }),
        entry({
          provider_id: "fast",
          model_id: "fast-1",
          aliases: ["manager"],
          latency_tier: 1,
          quality_tier: 2
        })
      ]
    };
    const router = new ModelRouter(new ModelRegistry(document));
    expect(router.resolve(routeRequest("balanced")).provider_id).toBe("baseline");
    expect(router.resolve(routeRequest("latency")).provider_id).toBe("fast");
    const gateway = new ModelGateway([adapter("baseline", 8), adapter("fast", 8)], router, [
      "fast"
    ]);

    const baseline = await run(gateway, makeRequest("balanced"));

    expect(baseline.route).toBe("baseline");
    expect(baseline.text).toBe(answer); // semantic quality on the agreed task
    expect(baseline.usage).toMatchObject({ inputTokens: 20, outputTokens: 5 });
    expect(baseline.timing!.first_token_ms).toBeLessThanOrEqual(baseline.timing!.total_ms);
    expect(baseline.timing!.total_ms).toBeGreaterThanOrEqual(0);
  });
});
