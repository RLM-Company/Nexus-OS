import type { ModelRequest } from "@nexus/contracts";
import { describe, expect, it } from "vitest";
import {
  GatewayRunError,
  MockProviderAdapter,
  ModelGateway,
  OpenAICompatibleAdapter,
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
    fallback_allowed: true
  },
  idempotency_key: "run-1",
  ...overrides
});

const collect = async (
  events: AsyncIterable<ProviderStreamEvent>
): Promise<ProviderStreamEvent[]> => {
  const result: ProviderStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

describe("ModelGateway", () => {
  it("streams deterministic mock output", async () => {
    const gateway = new ModelGateway([new MockProviderAdapter()]);
    const events = await collect(gateway.stream(request()));

    expect(events.filter((event) => event.type === "text.delta")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      provider: "mock",
      model: "manager-b0.1"
    });
  });

  it("falls back when the primary fails before the first delta", async () => {
    const failing: ModelProviderAdapter = {
      id: "primary",
      stream: async function* () {
        await Promise.resolve();
        yield* [] as ProviderStreamEvent[];
        throw new GatewayRunError("PROVIDER_ERROR", "primary", "Unavailable", true);
      }
    };
    const gateway = new ModelGateway([failing, new MockProviderAdapter()], ["mock"]);
    const events = await collect(
      gateway.stream(
        request({
          routing: {
            preferred_provider: "primary",
            preferred_model_alias: "manager",
            fallback_allowed: true
          }
        })
      )
    );

    expect(events.at(-1)).toMatchObject({ type: "response.completed", provider: "mock" });
  });

  it("does not fall back after partial provider output", async () => {
    const partial: ModelProviderAdapter = {
      id: "primary",
      stream: async function* () {
        await Promise.resolve();
        yield { type: "text.delta", delta: "partial" };
        throw new GatewayRunError("PROVIDER_ERROR", "primary", "Disconnected", true);
      }
    };
    const gateway = new ModelGateway([partial, new MockProviderAdapter()], ["mock"]);

    await expect(
      collect(
        gateway.stream(
          request({
            routing: {
              preferred_provider: "primary",
              preferred_model_alias: "manager",
              fallback_allowed: true
            }
          })
        )
      )
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", provider: "primary" });
  });

  it("normalizes provider timeouts", async () => {
    const gateway = new ModelGateway([new MockProviderAdapter("timeout")]);
    await expect(
      collect(
        gateway.stream(
          request({
            constraints: { timeout_ms: 20, max_output_tokens: 500 },
            routing: {
              preferred_provider: "mock",
              preferred_model_alias: "manager",
              fallback_allowed: false
            }
          })
        )
      )
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
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

    const events = await collect(adapter.stream(request(), new AbortController().signal));
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
      collect(adapter.stream(request(), new AbortController().signal))
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });
});
