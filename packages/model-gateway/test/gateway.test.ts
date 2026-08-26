import type { ModelRegistryDocument, ModelRegistryEntry, ModelRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  GatewayRunError,
  MockProviderAdapter,
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  OpenAICompatibleAdapter,
  type ModelGatewayStreamEvent,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "../src/index.js";

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  request_id: "request-1",
  project_id: "project-1",
  run_id: "run-1",
  agent_id: "manager",
  role: "manager",
  task_type: "project_chat",
  messages: [
    { role: "system", content: "System" },
    { role: "user", content: "Создай проект" }
  ],
  constraints: { timeout_ms: 1_000, max_output_tokens: 500 },
  routing: {
    preferred_provider: "mock",
    preferred_model_alias: "manager",
    fallback_allowed: true,
    required_features: ["streaming"],
    confidential: false,
    estimated_input_tokens: 100,
    max_cost: null,
    optimize_for: "balanced"
  },
  idempotency_key: "run-1",
  ...overrides
});

const entry = (overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry => ({
  provider_id: "mock",
  model_id: "manager-b0.1",
  aliases: ["manager"],
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
  context_window_tokens: 10_000,
  max_output_tokens: 2_000,
  quality_tier: 1,
  latency_tier: 1,
  pricing: {
    currency: "USD",
    input_per_million_tokens: 0,
    output_per_million_tokens: 0
  },
  privacy: {
    confidential_compatible: true,
    training_usage: "none",
    retention: "zero"
  },
  source: {
    kind: "static",
    verified_at: "2026-08-24T00:00:00.000Z",
    reference: "test"
  },
  ...overrides
});

const router = (entries: ModelRegistryEntry[]): ModelRouter => {
  const document: ModelRegistryDocument = {
    schema_version: 1,
    registry_version: "gateway-test-1",
    generated_at: "2026-08-24T00:00:00.000Z",
    entries
  };
  return new ModelRouter(new ModelRegistry(document));
};

const collectGateway = async (
  events: AsyncIterable<ModelGatewayStreamEvent>
): Promise<ModelGatewayStreamEvent[]> => {
  const result: ModelGatewayStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

const collectProvider = async (
  events: AsyncIterable<ProviderStreamEvent>
): Promise<ProviderStreamEvent[]> => {
  const result: ProviderStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

describe("ModelGateway", () => {
  it("rejects duplicate provider adapter identities", () => {
    expect(
      () =>
        new ModelGateway([new MockProviderAdapter(), new MockProviderAdapter()], router([entry()]))
    ).toThrow("adapter IDs must be unique");
  });

  it("routes and streams deterministic mock output", async () => {
    const gateway = new ModelGateway([new MockProviderAdapter()], router([entry()]));
    const events = await collectGateway(gateway.stream(request()));

    expect(events[0]).toMatchObject({
      type: "route.selected",
      route: {
        registry_version: "gateway-test-1",
        provider_id: "mock",
        model_id: "manager-b0.1"
      }
    });
    expect(events.filter((event) => event.type === "text.delta")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      provider: "mock",
      model: "manager-b0.1",
      calculatedCost: { amount: 0, currency: "USD" }
    });
  });

  it("falls back through another registry-approved route before the first delta", async () => {
    const failing: ModelProviderAdapter = {
      id: "primary",
      modelId: "primary-model",
      stream: async function* () {
        await Promise.resolve();
        yield* [] as ProviderStreamEvent[];
        throw new GatewayRunError("PROVIDER_ERROR", "primary", "Unavailable", true);
      }
    };
    const gateway = new ModelGateway(
      [failing, new MockProviderAdapter()],
      router([
        entry({
          provider_id: "primary",
          model_id: "primary-model",
          protocol: "openai-compatible"
        }),
        entry()
      ]),
      ["mock"]
    );
    const events = await collectGateway(
      gateway.stream(
        request({
          routing: {
            ...request().routing,
            preferred_provider: "primary",
            preferred_model_alias: "primary-model"
          }
        })
      )
    );

    expect(events.filter((event) => event.type === "route.selected")).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "route.failed", errorCode: "PROVIDER_ERROR" })
    );
    expect(events.at(-1)).toMatchObject({ type: "response.completed", provider: "mock" });
  });

  it("does not fall back after partial provider output", async () => {
    const partial: ModelProviderAdapter = {
      id: "primary",
      modelId: "primary-model",
      stream: async function* () {
        await Promise.resolve();
        yield { type: "text.delta", delta: "partial" };
        throw new GatewayRunError("PROVIDER_ERROR", "primary", "Disconnected", true);
      }
    };
    const gateway = new ModelGateway(
      [partial, new MockProviderAdapter()],
      router([
        entry({
          provider_id: "primary",
          model_id: "primary-model",
          protocol: "openai-compatible"
        }),
        entry()
      ]),
      ["mock"]
    );

    await expect(
      collectGateway(
        gateway.stream(
          request({
            routing: {
              ...request().routing,
              preferred_provider: "primary",
              preferred_model_alias: "primary-model"
            }
          })
        )
      )
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", provider: "primary" });
  });

  it("normalizes provider timeouts and records the failed route", async () => {
    const gateway = new ModelGateway([new MockProviderAdapter("timeout")], router([entry()]));
    await expect(
      collectGateway(
        gateway.stream(
          request({
            constraints: { timeout_ms: 20, max_output_tokens: 500 },
            routing: { ...request().routing, fallback_allowed: false }
          })
        )
      )
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
  });

  it("fails closed when no adapter matches the selected registry model", async () => {
    const gateway = new ModelGateway(
      [new MockProviderAdapter()],
      router([entry({ model_id: "different-model" })])
    );
    await expect(collectGateway(gateway.stream(request()))).rejects.toMatchObject({
      code: "ROUTE_UNAVAILABLE",
      retryable: false
    });
  });

  it("rejects provider events emitted after completion", async () => {
    const invalid: ModelProviderAdapter = {
      id: "mock",
      modelId: "manager-b0.1",
      stream: async function* () {
        await Promise.resolve();
        yield {
          type: "response.completed",
          provider: "mock",
          model: "manager-b0.1",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 }
        };
        yield { type: "text.delta", delta: "late" };
      }
    };
    const gateway = new ModelGateway([invalid], router([entry()]));

    await expect(collectGateway(gateway.stream(request()))).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false
    });
  });

  it("rejects a completion identity that differs from the registry route", async () => {
    const mismatched: ModelProviderAdapter = {
      id: "mock",
      modelId: "manager-b0.1",
      stream: async function* () {
        await Promise.resolve();
        yield {
          type: "response.completed",
          provider: "mock",
          model: "different-model",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 }
        };
      }
    };
    const gateway = new ModelGateway([mismatched], router([entry()]));

    await expect(collectGateway(gateway.stream(request()))).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false
    });
  });

  it("rejects invalid provider token usage", async () => {
    const invalidUsage: ModelProviderAdapter = {
      id: "mock",
      modelId: "manager-b0.1",
      stream: async function* () {
        await Promise.resolve();
        yield {
          type: "response.completed",
          provider: "mock",
          model: "manager-b0.1",
          finishReason: "stop",
          usage: { inputTokens: -1, outputTokens: 1 }
        };
      }
    };
    const gateway = new ModelGateway([invalidUsage], router([entry()]));

    await expect(collectGateway(gateway.stream(request()))).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false
    });
  });

  it("keeps cost unknown when the provider omits streaming usage", async () => {
    const noUsage: ModelProviderAdapter = {
      id: "mock",
      modelId: "manager-b0.1",
      stream: async function* () {
        await Promise.resolve();
        yield {
          type: "response.completed",
          provider: "mock",
          model: "manager-b0.1",
          finishReason: "stop",
          usage: { inputTokens: null, outputTokens: null }
        };
      }
    };
    const gateway = new ModelGateway([noUsage], router([entry()]));
    const events = await collectGateway(gateway.stream(request()));

    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      usage: { inputTokens: null, outputTokens: null },
      calculatedCost: null
    });
  });
});

describe("OpenAICompatibleAdapter", () => {
  it("parses text, usage and model from an SSE response", async () => {
    let authorization = "";
    const adapter = new OpenAICompatibleAdapter({
      id: "primary",
      baseUrl: "https://provider.example/v1/",
      apiKey: "test-key",
      model: "requested-model",
      fetchImplementation: (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Promise.resolve(
          new Response(
            [
              'data: {"model":"resolved-model","choices":[{"delta":{"content":"Привет"},"finish_reason":null}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
              "data: [DONE]",
              ""
            ].join("\n\n"),
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        );
      }
    });

    const events = await collectProvider(adapter.stream(request(), new AbortController().signal));
    expect(authorization).toBe("Bearer test-key");
    expect(events).toEqual([
      { type: "text.delta", delta: "Привет" },
      {
        type: "response.completed",
        provider: "primary",
        model: "resolved-model",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 2 }
      }
    ]);
  });

  it("classifies retryable provider HTTP errors", async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: "primary",
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      model: "model",
      fetchImplementation: () => Promise.resolve(new Response(null, { status: 429 }))
    });

    await expect(
      collectProvider(adapter.stream(request(), new AbortController().signal))
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });
});
