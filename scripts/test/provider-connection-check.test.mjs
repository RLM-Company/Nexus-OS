import assert from "node:assert/strict";
import test from "node:test";
import { checkProviderConnection } from "../provider-connection-check.mjs";

const env = {
  MODEL_PROVIDER: "openai-compatible",
  MODEL_PROVIDER_ID: "cheapvibecode",
  MODEL_BASE_URL: "https://provider.example/v1",
  MODEL_NAME: "fixture-model",
  MODEL_API_KEY: "fixture-private-credential",
  MODEL_FALLBACK_TO_MOCK: "false",
  MODEL_MAX_ATTEMPTS_PER_ROUTE: "1",
  RUNTIME_EMERGENCY_STOP: "true"
};
const liveEnv = {
  ...env,
  RUNTIME_EMERGENCY_STOP: "false",
  COSMORA_ALLOW_PAID_CONNECTION_TEST: "SEND_ONE_BOUNDED_REQUEST"
};
const json = (value) => Response.json(value);
const stream = (body) => new Response(body, { headers: { "content-type": "text/event-stream" } });
const openaiStream = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';

function fixture({ balance = 0, generation = () => stream(openaiStream) } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    const path = new URL(url).pathname;
    if (path === "/v1/models") return json({ data: [{ id: env.MODEL_NAME }] });
    if (path === "/v1/balance") return json({ token_balance: balance });
    return generation();
  };
  return { calls, fetch };
}

test("discovery works while stopped and balance is zero without generation", async () => {
  const api = fixture();
  const result = await checkProviderConnection(env, api.fetch);
  assert.deepEqual(result, {
    mode: "discovery",
    model_available: true,
    catalog_count: 1,
    token_balance: 0,
    generation_requests: 0,
    streaming_verified: false
  });
  assert.deepEqual(
    api.calls.map((call) => call.url),
    ["https://provider.example/v1/models", "https://provider.example/v1/balance"]
  );
  assert.ok(api.calls.every((call) => !call.method && call.redirect === "error"));
  assert.ok(!JSON.stringify(result).includes(env.MODEL_API_KEY));
});

for (const [name, overrides, message] of [
  ["global stop", { RUNTIME_EMERGENCY_STOP: "true" }, /EMERGENCY_STOP/],
  ["missing stop", { RUNTIME_EMERGENCY_STOP: undefined }, /EMERGENCY_STOP/],
  ["mock fallback", { MODEL_FALLBACK_TO_MOCK: "true" }, /FALLBACK/],
  ["retries", { MODEL_MAX_ATTEMPTS_PER_ROUTE: "2" }, /ATTEMPTS/],
  ["ambiguous opt-in", { COSMORA_ALLOW_PAID_CONNECTION_TEST: "true" }, /opt-in/]
]) {
  test(`live check rejects ${name} before any network request`, async () => {
    const api = fixture({ balance: 100 });
    await assert.rejects(checkProviderConnection({ ...liveEnv, ...overrides }, api.fetch), message);
    assert.equal(api.calls.length, 0);
  });
}

test("zero and malformed balances block generation", async () => {
  for (const balance of [0, "100", -1, null]) {
    const api = fixture({ balance });
    await assert.rejects(checkProviderConnection(liveEnv, api.fetch), /balance/);
    assert.equal(api.calls.filter((call) => call.method === "POST").length, 0);
  }
});

test("explicit live check sends exactly one bounded streaming request", async () => {
  const api = fixture({ balance: 100 });
  const result = await checkProviderConnection(liveEnv, api.fetch);
  const posts = api.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(posts[0].headers.Authorization, `Bearer ${env.MODEL_API_KEY}`);
  assert.deepEqual(JSON.parse(posts[0].body), {
    model: env.MODEL_NAME,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 8,
    stream: true
  });
  assert.equal(result.generation_requests, 1);
  assert.equal(result.streaming_verified, true);
});

test("HTTP and transport failures do not leak response bodies or credentials or retry", async () => {
  for (const generation of [
    () => new Response(`provider detail: ${env.MODEL_API_KEY}`, { status: 401 }),
    () => {
      throw new Error(`network detail: ${env.MODEL_API_KEY}`);
    }
  ]) {
    const api = fixture({ balance: 100, generation });
    await assert.rejects(checkProviderConnection(liveEnv, api.fetch), (error) => {
      assert.ok(!error.message.includes(env.MODEL_API_KEY));
      assert.match(error.message, /no retry/);
      return true;
    });
    assert.equal(api.calls.filter((call) => call.method === "POST").length, 1);
  }
});

test("invalid endpoint URLs are rejected before sending credentials", async () => {
  for (const url of [
    "http://provider.example/v1",
    "https://user:password@provider.example/v1",
    "https://provider.example/v1?token=private",
    "https://provider.example/v1#private"
  ]) {
    const api = fixture();
    await assert.rejects(
      checkProviderConnection({ ...env, MODEL_BASE_URL: url }, api.fetch),
      /HTTPS/
    );
    assert.equal(api.calls.length, 0);
  }
});

test("failed, empty, oversized or incomplete streams cannot pass", async () => {
  for (const body of [
    `data: {"error":{"message":"${env.MODEL_API_KEY}"}}\n\n`,
    `data: invalid ${env.MODEL_API_KEY}\n\n`,
    'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
    "data: [DONE]\n\n",
    "x".repeat(65 * 1024)
  ]) {
    const api = fixture({ balance: 100, generation: () => stream(body) });
    await assert.rejects(
      checkProviderConnection(liveEnv, api.fetch),
      (error) => !error.message.includes(env.MODEL_API_KEY)
    );
    assert.equal(api.calls.filter((call) => call.method === "POST").length, 1);
  }
});

test("model absence prevents generation", async () => {
  let requests = 0;
  await assert.rejects(
    checkProviderConnection(liveEnv, async () => {
      requests += 1;
      return json({ data: [{ id: "different-model" }] });
    }),
    /not found/
  );
  assert.equal(requests, 1);
});

test("Anthropic protocol preserves catalog headers and verifies text completion", async () => {
  const body =
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  const api = fixture({ generation: () => stream(body) });
  const result = await checkProviderConnection(
    { ...liveEnv, MODEL_PROVIDER: "anthropic-compatible", MODEL_PROVIDER_ID: "anthropic" },
    api.fetch
  );
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0].url, "https://provider.example/v1/models?limit=1000");
  assert.equal(api.calls[0].headers["x-api-key"], env.MODEL_API_KEY);
  assert.equal(api.calls[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(api.calls[1].url, "https://provider.example/v1/messages");
  assert.equal(result.streaming_verified, true);
});
