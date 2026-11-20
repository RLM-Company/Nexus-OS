#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { OpenAICompatibleAdapter } from "../packages/model-gateway/dist/index.js";

const prompt = "List exactly three short tips for keeping a project folder organized.";

export async function measureStream(adapter, now = () => performance.now()) {
  const started = now();
  let firstText = null;
  let lastText = null;
  let visibleCharacters = 0;
  let firstChunkCharacters = 0;
  let chunks = 0;
  let completion;

  const stream = adapter.stream(
    { messages: [{ role: "user", content: prompt }], constraints: { max_output_tokens: 256 } },
    AbortSignal.timeout(30_000)
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
  const wire = packets.map((packet) => `data: ${JSON.stringify(packet)}\n\n`).join("");
  return Promise.resolve(new Response(`${wire}data: [DONE]\n\n`));
}

function makeAdapter(live, env) {
  const model = live ? env.MODEL_NAME?.trim() : "stream-fixture";
  const apiKey = live ? env.MODEL_API_KEY?.trim() : "fixture";
  const baseUrl = new URL(live ? (env.MODEL_BASE_URL ?? "") : "https://fixture.invalid/v1");
  if (
    !model ||
    !apiKey ||
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Invalid HTTPS provider configuration.");
  }
  return new OpenAICompatibleAdapter({
    id: "stream-benchmark",
    baseUrl: baseUrl.href,
    model,
    apiKey,
    fetchImplementation: live
      ? (url, options) => fetch(url, { ...options, redirect: "error" })
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    const diagnostic = error?.message;
    const safe =
      /^(?:Provider returned HTTP [1-5]\d\d|Provider stream did not finish a non-empty text response|Invalid provider stream event|Provider returned invalid streaming JSON|No completed visible answer\.)$/u;
    console.error(
      safe.test(diagnostic)
        ? diagnostic
        : "Stream measurement failed. Check the model configuration and provider status."
    );
    process.exitCode = 1;
  });
}
