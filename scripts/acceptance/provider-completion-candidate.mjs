import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL, URL } from "node:url";
import process from "node:process";

if (!process.env.COSMORA_CODE_PROPOSAL_CHECKER) throw Error("CHECKER_SOURCE_REQUIRED");
const { checkProviderConnection } = await import(
  pathToFileURL(process.env.COSMORA_CODE_PROPOSAL_CHECKER).href
);
const frame = (data) => "data: " + JSON.stringify(data) + "\n\n";
const env = {
  MODEL_PROVIDER: "openai-compatible",
  MODEL_PROVIDER_ID: "fixture",
  MODEL_BASE_URL: "https://fixture.invalid/v1",
  MODEL_NAME: "acceptance-fixture",
  MODEL_API_KEY: "synthetic-private-value-never-send",
  RUNTIME_EMERGENCY_STOP: "false",
  MODEL_FALLBACK_TO_MOCK: "false",
  MODEL_MAX_ATTEMPTS_PER_ROUTE: "1",
  COSMORA_ALLOW_PAID_CONNECTION_TEST: "SEND_ONE_BOUNDED_REQUEST"
};
async function check(body, protocol = "openai-compatible", reject = false) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path === "/v1/models") return globalThis.Response.json({ data: [{ id: env.MODEL_NAME }] });
    assert.ok(["/v1/chat/completions", "/v1/messages"].includes(path));
    return new globalThis.Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  const operation = checkProviderConnection({ ...env, MODEL_PROVIDER: protocol }, fetch);
  if (reject)
    await assert.rejects(operation, (error) => {
      assert.ok(!error.message.includes(env.MODEL_API_KEY));
      return true;
    });
  else assert.equal((await operation).streaming_verified, true);
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
  assert.equal(calls.length, 2);
}
const openai = (reason) =>
  frame({ choices: [{ delta: { content: "OK" } }] }) +
  frame({ choices: [{ delta: {}, finish_reason: reason }] }) +
  "data: [DONE]\n\n";
const anthropic = (reason) =>
  frame({ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } }) +
  frame({ type: "message_delta", delta: { stop_reason: reason } }) +
  frame({ type: "message_stop" });

for (const reason of ["length", "content_filter", "tool_calls", "function_call", "unknown", ""])
  test("OpenAI must reject non-text-success finish_reason=" + JSON.stringify(reason), () =>
    check(openai(reason), "openai-compatible", true)
  );
for (const reason of [
  "max_tokens",
  "tool_use",
  "pause_turn",
  "refusal",
  "model_context_window_exceeded",
  "unknown"
])
  test("Anthropic must reject non-text-success stop_reason=" + reason, () =>
    check(anthropic(reason), "anthropic-compatible", true)
  );
test("OpenAI explicit stop still succeeds", () => check(openai("stop")));
test("OpenAI legacy stream without a reason still succeeds", () =>
  check(frame({ choices: [{ delta: { content: "OK" } }] }) + "data: [DONE]\n\n"));
for (const reason of ["end_turn", "stop_sequence"])
  test("Anthropic normal stop still succeeds: " + reason, () =>
    check(anthropic(reason), "anthropic-compatible")
  );
