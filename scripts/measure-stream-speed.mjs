#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { OpenAICompatibleAdapter } from "../packages/model-gateway/dist/index.js";

const prompt = "List exactly three short tips for keeping a project folder organized.";
const directAnswerInstruction =
  "For straightforward requests, start with the requested answer immediately. Follow the user's requested format and level of detail.";

export async function measureStream(adapter, now = () => performance.now(), options = {}) {
  const started = now();
  let firstText = null;
  let lastText = null;
  let visibleCharacters = 0;
  let firstChunkCharacters = 0;
  let chunks = 0;
  let completion;

  const stream = adapter.stream(
    {
      messages: [
        ...(options.directAnswer ? [{ role: "system", content: directAnswerInstruction }] : []),
        { role: "user", content: options.prompt ?? prompt }
      ],
      constraints: { max_output_tokens: options.maxOutputTokens ?? 256 }
    },
    options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
  );

  for await (const event of stream) {
    if (event.type === "text.delta") {
      if (firstText === null && !event.delta.trim()) continue;
      const received = now();
      const characters = [...event.delta].length;
      if (firstText === null) firstChunkCharacters = characters;
      firstText ??= received;
      lastText = received;
      visibleCharacters += characters;
      chunks++;
      options.onText?.(event.delta);
    }
    if (event.type === "response.completed") completion = event;
  }

  const elapsed = now() - started;
  if (firstText === null || !completion) throw new Error("No completed visible answer.");
  const visibleSpan = lastText - firstText;

  return {
    first_visible_text_ms: Math.round(firstText - started),
    visible_stream_ms: Math.round(visibleSpan),
    total_ms: Math.round(elapsed),
    visible_characters: visibleCharacters,
    visible_chunks: chunks,
    visible_characters_per_second:
      visibleSpan >= 1
        ? Math.round(((visibleCharacters - firstChunkCharacters) * 1_000) / visibleSpan)
        : null,
    provider_input_tokens: completion.usage.inputTokens,
    provider_completion_tokens: completion.usage.outputTokens,
    provider_completion_tokens_per_second_end_to_end:
      completion.usage.outputTokens !== null && elapsed > 0
        ? Math.round((completion.usage.outputTokens * 1_000) / elapsed)
        : null,
    finish: completion.finishReason === "stop" ? "stop" : "other"
  };
}

function mockFetch() {
  const packets = [
    { choices: [{ delta: { role: "assistant" } }] },
    { choices: [{ delta: { content: "Organize " } }] },
    { choices: [{ delta: { content: "your files." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 14, completion_tokens: 5 } }
  ];
  const encoder = new TextEncoder();
  const frames = [...packets.map((packet) => JSON.stringify(packet)), "[DONE]"].values();
  return Promise.resolve(
    new Response(
      new ReadableStream({
        async pull(controller) {
          const frame = frames.next();
          if (frame.done) {
            controller.close();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
          controller.enqueue(encoder.encode(`data: ${frame.value}\n\n`));
        }
      })
    )
  );
}

export function makeAdapter(live, env, { allowLoopback = false, requestFastTier = false } = {}) {
  const model = live ? env.MODEL_NAME?.trim() : "stream-fixture";
  const apiKey = live ? env.MODEL_API_KEY?.trim() : "fixture";
  const baseUrl = new URL(live ? (env.MODEL_BASE_URL ?? "") : "https://fixture.invalid/v1");
  const localHttp =
    allowLoopback &&
    baseUrl.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname);
  if (
    !model ||
    (!apiKey && !localHttp) ||
    (baseUrl.protocol !== "https:" && !localHttp) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Invalid provider configuration.");
  }
  return new OpenAICompatibleAdapter({
    id: "stream-benchmark",
    baseUrl: baseUrl.href,
    model,
    apiKey: apiKey || "local",
    fetchImplementation: live
      ? (url, options) =>
          fetch(url, {
            ...options,
            redirect: "error",
            ...(requestFastTier
              ? { body: JSON.stringify({ ...JSON.parse(options.body), service_tier: "fast" }) }
              : {})
          })
      : mockFetch
  });
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.length === 1 && args[0] === "--live";
  if (args.length && !live) throw new Error("Expected no arguments or --live.");
  const adapter = makeAdapter(live, process.env);
  const result = await measureStream(adapter);
  console.log(JSON.stringify({ mode: live ? "live" : "fixture", ...result }, null, 2));
  if (result.finish !== "stop") process.exitCode = 1;
}

export function streamDiagnostic(error) {
  const safe =
    /^(?:Provider returned HTTP [1-5]\d\d|Provider stream did not finish a non-empty text response|Invalid provider stream event|Provider returned invalid streaming JSON|No completed visible answer\.)$/u;
  return safe.test(error?.message) ? error.message : "Stream measurement failed.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(streamDiagnostic(error));
    process.exitCode = 1;
  });
}
