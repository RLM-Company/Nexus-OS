import type { ModelRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { AnthropicCompatibleAdapter, type ProviderStreamEvent } from "../src/index.js";

const request = (): ModelRequest => ({
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
    preferred_provider: "primary",
    preferred_model_alias: "manager",
    fallback_allowed: true,
    required_features: ["streaming"],
    confidential: false,
    estimated_input_tokens: 100,
    max_cost: null,
    optimize_for: "balanced"
  },
  idempotency_key: "run-1"
});

const collect = async (events: AsyncIterable<ProviderStreamEvent>) => {
  const result: ProviderStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

describe("AnthropicCompatibleAdapter", () => {
  it("translates messages and parses Anthropic SSE events", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    let requestBody: unknown;
    const adapter = new AnthropicCompatibleAdapter({
      id: "primary",
      baseUrl: "https://provider.example/v1/",
      apiKey: "test-key",
      model: "requested-model",
      fetchImplementation: (input, init) => {
        requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requestHeaders = new Headers(init?.headers);
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        requestBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"model":"resolved-model","usage":{"input_tokens":10,"output_tokens":1}}}',
              'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Привет"}}',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
              'event: message_stop\ndata: {"type":"message_stop"}',
              ""
            ].join("\n\n"),
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        );
      }
    });

    const events = await collect(adapter.stream(request(), new AbortController().signal));

    expect(requestUrl).toBe("https://provider.example/v1/messages");
    expect(requestHeaders.get("x-api-key")).toBe("test-key");
    expect(requestHeaders.get("anthropic-version")).toBe("2023-06-01");
    expect(requestBody).toEqual({
      model: "requested-model",
      max_tokens: 500,
      messages: [{ role: "user", content: "Создай проект" }],
      stream: true,
      system: "System"
    });
    expect(events).toEqual([
      { type: "text.delta", delta: "Привет" },
      {
        type: "response.completed",
        provider: "primary",
        model: "resolved-model",
        finishReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 2 }
      }
    ]);
  });

  it("classifies retryable provider HTTP errors", async () => {
    const adapter = new AnthropicCompatibleAdapter({
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
