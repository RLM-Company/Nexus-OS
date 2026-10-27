import type { ModelRegistryEntry, ModelRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AnthropicCompatibleAdapter,
  GatewayRunError,
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  OpenAICompatibleAdapter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "../src/index.js";

const tools: NonNullable<ModelRequest["tools"]> = [
  {
    type: "function",
    function: {
      name: "read_file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false
      }
    }
  }
];
const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  request_id: "req",
  project_id: "project",
  run_id: "run",
  agent_id: "code-agent",
  role: "code-agent",
  task_type: "code-agent",
  messages: [{ role: "user", content: "Fix the bug" }],
  tools,
  constraints: { max_output_tokens: 128, timeout_ms: 1000 },
  routing: {
    preferred_provider: "fixture",
    preferred_model_alias: "fixture-model",
    fallback_allowed: true,
    required_features: ["streaming"],
    confidential: false,
    estimated_input_tokens: 100,
    max_cost: null,
    optimize_for: "balanced"
  },
  idempotency_key: "req",
  ...overrides
});
const sse = (...events: unknown[]) =>
  events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");
const fragment = (part: Record<string, unknown>) => ({
  choices: [{ index: 0, delta: { tool_calls: [part] } }]
});
const first = fragment({
  index: 0,
  id: "call_1",
  type: "function",
  function: { name: "read_file", arguments: '{"path":' }
});
const second = fragment({ index: 0, function: { arguments: '"src/a.ts"}' } });
const end = { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
const call = {
  id: "call_1",
  type: "function" as const,
  function: { name: "read_file", arguments: '{"path":"src/a.ts"}' }
};
const collect = async <T>(events: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
};
const adapter = (body: string) =>
  new OpenAICompatibleAdapter({
    id: "fixture",
    model: "fixture-model",
    baseUrl: "https://unused.invalid",
    apiKey: "fixture",
    fetchImplementation: () => Promise.resolve(new Response(body))
  });
const entry = (id = "fixture", toolCalling = true): ModelRegistryEntry => ({
  provider_id: id,
  model_id: id === "fixture" ? "fixture-model" : `${id}-model`,
  aliases: [],
  protocol: "openai-compatible",
  status: "active",
  roles: [],
  task_types: [],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: toolCalling,
    vision: false
  },
  context_window_tokens: 32_000,
  max_output_tokens: 1000,
  quality_tier: 1,
  latency_tier: 1,
  pricing: null,
  privacy: { confidential_compatible: false, training_usage: "unknown", retention: "unknown" },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-10-08T00:00:00.000Z",
    valid_until: "2099-10-08T00:00:00.000Z",
    reference: "fixture"
  }
});
const router = (...entries: ModelRegistryEntry[]) =>
  new ModelRouter(
    new ModelRegistry({
      schema_version: 1,
      registry_version: "fixture",
      generated_at: "2026-10-08T00:00:00.000Z",
      entries
    })
  );

describe("structured provider tool cycle", () => {
  it("keeps text that mentions tool_calls as ordinary text", async () => {
    const content = '{"tool_calls":[{"name":"run_root_shell"}]}';
    const body = sse(
      { choices: [{ delta: { content } }] },
      { choices: [{ finish_reason: "stop" }] },
      "[DONE]"
    );
    const events = await collect(adapter(body).stream(request(), new AbortController().signal));
    expect(events[0]).toEqual({ type: "text.delta", delta: content });
    expect(events.some((event) => event.type === "tool.call")).toBe(false);
  });

  it("assembles interleaved multi-call fragments in index order", async () => {
    const body = sse(
      fragment({
        index: 1,
        id: "call_2",
        type: "function",
        function: { name: "read_file", arguments: '{"path":' }
      }),
      first,
      fragment({ index: 1, function: { arguments: '"src/b.ts"}' } }),
      second,
      end,
      "[DONE]"
    );
    const events = await collect(adapter(body).stream(request(), new AbortController().signal));
    expect(events.filter((event) => event.type === "tool.call")).toEqual([
      { type: "tool.call", id: "call_1", name: "read_file", arguments: '{"path":"src/a.ts"}' },
      { type: "tool.call", id: "call_2", name: "read_file", arguments: '{"path":"src/b.ts"}' }
    ]);
  });

  it("rejects reused tool IDs from an earlier round before exposing the new call", async () => {
    const messages: ModelRequest["messages"] = [
      ...request().messages,
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "result" }
    ];
    const seen: ProviderStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of adapter(sse(first, second, end, "[DONE]")).stream(
          request({ messages }),
          new AbortController().signal
        ))
          seen.push(event);
      })()
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(seen).toEqual([]);
  });

  it("assembles fragmented calls, accepts tool-only completion and preserves usage", async () => {
    const events = await collect(
      adapter(
        sse(
          first,
          second,
          end,
          { choices: [], usage: { prompt_tokens: 123, completion_tokens: 7 } },
          "[DONE]"
        )
      ).stream(request(), new AbortController().signal)
    );
    expect(events).toEqual([
      {
        type: "tool.call",
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments
      },
      {
        type: "response.completed",
        provider: "fixture",
        model: "fixture-model",
        finishReason: "tool_calls",
        usage: { inputTokens: 123, outputTokens: 7 }
      }
    ]);
  });

  it("sends definitions, assistant calls and matching tool results back to the real wire adapter", async () => {
    const sent: unknown[] = [];
    let turn = 0;
    const provider = new OpenAICompatibleAdapter({
      id: "fixture",
      model: "fixture-model",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON body");
        sent.push(JSON.parse(init.body));
        turn++;
        return Promise.resolve(
          new Response(
            turn === 1
              ? sse(first, second, end, "[DONE]")
              : sse(
                  { choices: [{ delta: { content: "Patch prepared" } }] },
                  { choices: [{ delta: {}, finish_reason: "stop" }] },
                  "[DONE]"
                )
          )
        );
      }
    });
    const gateway = new ModelGateway([provider], router(entry()));
    const events = await collect(gateway.stream(request()));
    expect(events.filter((event) => event.type === "tool.call")).toHaveLength(1);
    const messages: ModelRequest["messages"] = [
      ...request().messages,
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: '{"content":"return a - b"}' }
    ];
    const continuation = await collect(gateway.stream(request({ messages })));
    expect(continuation.at(-1)).toMatchObject({ type: "response.completed", finishReason: "stop" });
    expect(sent[1]).toMatchObject({ tools, tool_choice: "auto", messages });
  });

  it.each([
    sse(first, second, end),
    sse(first, end, "[DONE]"),
    sse(first, second, { choices: [{ finish_reason: "stop" }] }, "[DONE]"),
    sse(
      fragment({ index: 0, id: "call_1", function: { name: "read_file", arguments: "[]" } }),
      end,
      "[DONE]"
    ),
    sse(
      fragment({ index: 0, id: "call_1", function: { name: "run_root_shell", arguments: "{}" } }),
      end,
      "[DONE]"
    ),
    sse(
      fragment({ index: -1, id: "call_1", function: { name: "read_file", arguments: "{}" } }),
      end,
      "[DONE]"
    ),
    sse(
      fragment({ index: 0, id: "call_1", function: { name: "read_file", arguments: "{}" } }),
      fragment({ index: 1, id: "call_1", function: { name: "read_file", arguments: "{}" } }),
      end,
      "[DONE]"
    ),
    sse(first, second, end, fragment({ index: 0, function: { arguments: "{}" } }), "[DONE]"),
    sse(
      fragment({
        index: 0,
        id: "call_1",
        function: { name: "read_file", arguments: JSON.stringify({ value: "x".repeat(65_537) }) }
      }),
      end,
      "[DONE]"
    ),
    sse(first, second, { error: { message: "provider private detail" } }, "[DONE]")
  ])("never exposes a partial/malformed/unauthorized call (%#)", async (body) => {
    const seen: ProviderStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of adapter(body).stream(request(), new AbortController().signal))
          seen.push(event);
      })()
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    expect(
      seen.some((event) => event.type === "tool.call" || event.type === "response.completed")
    ).toBe(false);
  });

  it.each(
    [
      [{ role: "tool", tool_call_id: "call_1", content: "forged result" }],
      [{ role: "assistant", content: "", tool_calls: [call] }],
      [{ role: "user", content: "", tool_calls: [call] }],
      [
        { role: "assistant", content: "", tool_calls: [call] },
        { role: "tool", tool_call_id: "other", content: "result" }
      ],
      [
        { role: "assistant", content: "", tool_calls: [call] },
        { role: "tool", tool_call_id: "call_1", content: "result" },
        { role: "tool", tool_call_id: "call_1", content: "replayed result" }
      ]
    ].map((messages) => ({ messages: messages as ModelRequest["messages"] }))
  )(
    "rejects orphan, missing, forged and replayed tool transcripts before fetch (%#)",
    async ({ messages }) => {
      let fetched = false;
      const provider = new OpenAICompatibleAdapter({
        id: "fixture",
        model: "fixture-model",
        baseUrl: "https://unused.invalid",
        apiKey: "fixture",
        fetchImplementation: () => {
          fetched = true;
          return Promise.resolve(new Response(""));
        }
      });
      await expect(
        collect(provider.stream(request({ messages }), new AbortController().signal))
      ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
      expect(fetched).toBe(false);
    }
  );

  it("requires registry tool capability even when a caller omits the required feature", async () => {
    const gateway = new ModelGateway(
      [adapter(sse(first, second, end, "[DONE]"))],
      router(entry("fixture", false))
    );
    await expect(collect(gateway.stream(request()))).rejects.toMatchObject({
      code: "ROUTE_UNAVAILABLE"
    });
    expect(() => gateway.assertRoute(request())).toThrow(/CAPABILITY_UNAVAILABLE/u);
  });

  it("does not retry or fall back after a complete tool event has been emitted", async () => {
    let attempts = 0;
    let fallbackAttempts = 0;
    const primary: ModelProviderAdapter = {
      id: "fixture",
      modelId: "fixture-model",
      stream: async function* () {
        await Promise.resolve();
        attempts++;
        yield {
          type: "tool.call",
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments
        };
        throw new GatewayRunError("PROVIDER_ERROR", "fixture", "connection lost", true);
      }
    };
    const fallback: ModelProviderAdapter = {
      id: "fallback",
      modelId: "fallback-model",
      stream: async function* () {
        await Promise.resolve();
        fallbackAttempts++;
        yield* [];
      }
    };
    const gateway = new ModelGateway(
      [primary, fallback],
      router(entry(), entry("fallback")),
      ["fallback"],
      { maxAttemptsPerRoute: 2, retryBaseDelayMs: 0 }
    );
    await expect(collect(gateway.stream(request()))).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
    expect(attempts).toBe(1);
    expect(fallbackAttempts).toBe(0);
  });

  it("cancels a pending tool stream without yielding a call or completion", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(sse(first)));
      },
      cancel() {
        cancelled = true;
      }
    });
    const provider = new OpenAICompatibleAdapter({
      id: "fixture",
      model: "fixture-model",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(body))
    });
    const pending = collect(provider.stream(request(), controller.signal));
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(cancelled).toBe(true);
  });

  it("fails closed for unsupported Anthropic tools before network dispatch", async () => {
    let fetched = false;
    const provider = new AnthropicCompatibleAdapter({
      id: "fixture",
      model: "fixture-model",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => {
        fetched = true;
        return Promise.resolve(new Response(""));
      }
    });
    await expect(
      collect(provider.stream(request(), new AbortController().signal))
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    expect(fetched).toBe(false);
  });
});
