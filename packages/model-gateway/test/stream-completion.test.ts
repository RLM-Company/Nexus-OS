import type { ModelRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AnthropicCompatibleAdapter,
  OpenAICompatibleAdapter,
  type ProviderStreamEvent
} from "../src/index.js";

const request = {
  messages: [{ role: "user", content: "hello" }],
  constraints: { max_output_tokens: 128 }
} as ModelRequest;
const sse = (...events: unknown[]) =>
  events.map((e) => "data: " + (typeof e === "string" ? e : JSON.stringify(e)) + "\n\n").join("");
const openText = { choices: [{ delta: { content: "answer" } }] };
const openEnd = (reason = "stop") => ({ choices: [{ delta: {}, finish_reason: reason }] });
const start = { type: "message_start", message: { model: "test" } };
const text = { type: "content_block_delta", delta: { type: "text_delta", text: "answer" } };
const end = (reason = "end_turn") => ({ type: "message_delta", delta: { stop_reason: reason } });
const stop = { type: "message_stop" };

describe.each([
  {
    name: "OpenAI",
    Adapter: OpenAICompatibleAdapter,
    good: sse(openText, openEnd(), "[DONE]"),
    bad: [
      "",
      sse("[DONE]"),
      sse(openText),
      sse(openText, openEnd()),
      sse(openText, "[DONE]"),
      sse(openText, openEnd("length"), "[DONE]"),
      sse(openText, openEnd("tool_calls"), "[DONE]"),
      sse(openText, { error: { message: "private provider detail" } }, "[DONE]"),
      sse(null),
      sse("{invalid")
    ]
  },
  {
    name: "Anthropic",
    Adapter: AnthropicCompatibleAdapter,
    good: sse(start, text, end(), stop),
    bad: [
      "",
      sse(stop),
      sse(start, text),
      sse(start, text, end()),
      sse(start, text, stop),
      sse(start, text, end("max_tokens"), stop),
      sse(start, text, end("tool_use"), stop),
      sse(start, text, { type: "error", error: { message: "private provider detail" } }),
      sse(null),
      sse("{invalid")
    ]
  }
])("$name stream completion", ({ Adapter, good, bad }) => {
  it("sends image bytes as provider-native multimodal blocks instead of text metadata", async () => {
    let sent: { messages: Array<{ content: unknown }> } | undefined;
    const adapter = new Adapter({
      id: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture-key",
      model: "test",
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON body");
        sent = JSON.parse(init.body) as typeof sent;
        return Promise.resolve(new Response(good));
      }
    });
    const imageRequest = {
      ...request,
      messages: [
        {
          role: "user" as const,
          content: "Что на изображении?",
          images: [{ media_type: "image/png" as const, data_base64: "fixture-image-bytes" }]
        }
      ]
    };
    for await (const event of adapter.stream(imageRequest, new AbortController().signal))
      expect(event.type).toMatch(/text.delta|response.completed/);
    const blocks = sent?.messages[0]?.content;
    expect(blocks).toEqual(
      Adapter === OpenAICompatibleAdapter
        ? [
            { type: "text", text: "Что на изображении?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,fixture-image-bytes" } }
          ]
        : [
            { type: "text", text: "Что на изображении?" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "fixture-image-bytes" }
            }
          ]
    );
  });
  it.each(bad)("never completes an empty, truncated or erroneous stream (%#)", async (body) => {
    const seen: ProviderStreamEvent[] = [];
    const adapter = new Adapter({
      id: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "test",
      model: "test",
      fetchImplementation: () => Promise.resolve(new Response(body))
    });
    await expect(
      (async () => {
        for await (const e of adapter.stream(request, new AbortController().signal)) seen.push(e);
      })()
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    expect(seen.some((e) => e.type === "response.completed")).toBe(false);
  });

  it("handles fragmented CRLF/UTF-8 data and cancels the reader at the terminal marker", async () => {
    let cancelled = false;
    const bytes = new TextEncoder().encode(good.replaceAll("\n", "\r\n"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      },
      cancel() {
        cancelled = true;
      }
    });
    const adapter = new Adapter({
      id: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "test",
      model: "test",
      fetchImplementation: () => Promise.resolve(new Response(body))
    });
    const seen: ProviderStreamEvent[] = [];
    for await (const e of adapter.stream(request, new AbortController().signal)) seen.push(e);
    expect(seen).toHaveLength(2);
    expect(seen.at(-1)?.type).toBe("response.completed");
    expect(cancelled).toBe(true);
  });
});
