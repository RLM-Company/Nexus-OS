import type { ModelRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  AnthropicCompatibleAdapter,
  OpenAICompatibleAdapter,
  type ProviderStreamEvent
} from "../src/index.js";
const request = {
  messages: [{ role: "user", content: "test" }],
  constraints: { max_output_tokens: 128 }
} as ModelRequest;
const bodies = [
  {
    name: "OpenAI",
    Adapter: OpenAICompatibleAdapter,
    events: [
      { choices: [{ delta: { content: "Привет🙂" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 7 } },
      "[DONE]"
    ]
  },
  {
    name: "Anthropic",
    Adapter: AnthropicCompatibleAdapter,
    events: [
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Привет🙂" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
      { type: "message_stop" }
    ]
  }
];
function serialize(events: unknown[], newline = "\n", multiline = false): string {
  return (
    "\uFEFF: keepalive" +
    newline +
    newline +
    events
      .map((event) => {
        if (typeof event === "string") return "data: " + event + newline + newline;
        const json = JSON.stringify(event, null, multiline ? 2 : undefined);
        return (
          json
            .split("\n")
            .map((line) => "data: " + line + newline)
            .join("") + newline
        );
      })
      .join("")
  );
}
const collect = async (
  adapter: OpenAICompatibleAdapter | AnthropicCompatibleAdapter,
  signal = new AbortController().signal
) => {
  const result: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream(request, signal)) result.push(event);
  return result;
};
describe.each(bodies)("$name shared stream integration", ({ Adapter, events }) => {
  it("does not cap the complete answer at the individual-event bound", async () => {
    const delta = "x".repeat(4096);
    const chunk =
      Adapter === OpenAICompatibleAdapter
        ? { choices: [{ delta: { content: delta } }] }
        : { type: "content_block_delta", delta: { type: "text_delta", text: delta } };
    const chunks = Array.from({ length: 128 }, () => chunk);
    const expanded =
      Adapter === OpenAICompatibleAdapter
        ? [...chunks, ...events.slice(1)]
        : [events[0], ...chunks, ...events.slice(2)];
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(serialize(expanded)))
    });
    const seen = await collect(adapter);
    expect(
      seen.reduce(
        (count, event) => count + (event.type === "text.delta" ? event.delta.length : 0),
        0
      )
    ).toBe(524288);
    expect(seen.at(-1)).toMatchObject({
      type: "response.completed",
      usage: { inputTokens: 5, outputTokens: 7 }
    });
  });
  it.each(["\n", "\r\n", "\r"])(
    "accepts multiline JSON and preserves usage with %j framing",
    async (newline) => {
      const adapter = new Adapter({
        id: "test",
        model: "test",
        baseUrl: "https://unused.invalid",
        apiKey: "fixture",
        fetchImplementation: () => Promise.resolve(new Response(serialize(events, newline, true)))
      });
      const seen = await collect(adapter);
      expect(seen.filter((e) => e.type === "text.delta")).toEqual([
        { type: "text.delta", delta: "Привет🙂" }
      ]);
      expect(seen.at(-1)).toMatchObject({
        type: "response.completed",
        usage: { inputTokens: 5, outputTokens: 7 }
      });
    }
  );
  it("accepts >256KiB of small heartbeat events in a single chunk and stops at its marker", async () => {
    let cancels = 0;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            ": keepalive\n\n".repeat(25000) + serialize(events) + "data: " + "x".repeat(300000)
          )
        );
      },
      cancel() {
        cancels++;
        return new Promise(() => {});
      }
    });
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(source))
    });
    expect((await collect(adapter)).at(-1)?.type).toBe("response.completed");
    expect(cancels).toBe(1);
    expect(source.locked).toBe(false);
  });
  it("rejects an oversized event without a successful completion or a leaked payload", async () => {
    const body =
      "data: " + JSON.stringify({ private: "private marker " + "x".repeat(270000) }) + "\n\n";
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(body))
    });
    const seen: ProviderStreamEvent[] = [];
    let error: unknown;
    try {
      for await (const event of adapter.stream(request, new AbortController().signal))
        seen.push(event);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ diagnostic: "STREAM_EVENT_TOO_LARGE", retryable: false });
    expect(JSON.stringify(error)).not.toContain("private marker");
    expect(seen.some((e) => e.type === "response.completed")).toBe(false);
  });
  it("interrupts a stalled body even when cancellation never resolves", async () => {
    const controller = new AbortController();
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        return new Promise(() => {});
      }
    });
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(source))
    });
    const pending = collect(adapter, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(source.locked).toBe(false);
  });
  it("does not emit completion if cancellation occurs during terminal cleanup", async () => {
    const controller = new AbortController();
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(serialize(events)));
      },
      cancel() {
        controller.abort();
      }
    });
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => Promise.resolve(new Response(source))
    });
    const seen: ProviderStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of adapter.stream(request, controller.signal)) seen.push(event);
      })()
    ).rejects.toMatchObject({ code: "INTERRUPTED" });
    expect(seen.some((e) => e.type === "response.completed")).toBe(false);
  });
  it("never invokes the provider for a pre-aborted request", async () => {
    let calls = 0;
    const adapter = new Adapter({
      id: "test",
      model: "test",
      baseUrl: "https://unused.invalid",
      apiKey: "fixture",
      fetchImplementation: () => {
        calls++;
        return Promise.resolve(new Response(serialize(events)));
      }
    });
    const controller = new AbortController();
    controller.abort();
    await expect(collect(adapter, controller.signal)).rejects.toMatchObject({
      code: "INTERRUPTED"
    });
    expect(calls).toBe(0);
  });
  it("retains the EOF terminal compatibility but rejects a missing terminal event", async () => {
    const complete = serialize(events).replace(/\n+$/u, "");
    const adapter = (body: string) =>
      new Adapter({
        id: "test",
        model: "test",
        baseUrl: "https://unused.invalid",
        apiKey: "fixture",
        fetchImplementation: () => Promise.resolve(new Response(body))
      });
    expect((await collect(adapter(complete))).at(-1)?.type).toBe("response.completed");
    await expect(collect(adapter(serialize(events.slice(0, -1))))).rejects.toMatchObject({
      diagnostic: "INCOMPLETE_TEXT_RESPONSE",
      retryable: false
    });
  });
});
