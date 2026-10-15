import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const paidOptIn = "SEND_ONE_BOUNDED_REQUEST";
class ConnectionCheckError extends Error {}
function fail(message) {
  throw new ConnectionCheckError(message);
}

async function readBody(response, limit) {
  if (!response.body) fail("Provider returned an empty response.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail("Provider response exceeded the check's size limit.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readJson(response) {
  const body = await readBody(response, 1024 * 1024);
  try {
    return JSON.parse(body);
  } catch {
    fail("Provider returned invalid JSON.");
  }
}

function verifyStream(body, protocol) {
  let hasText = false;
  let completed = false;
  for (const event of body.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    if (data === "[DONE]" && protocol === "openai-compatible") {
      completed = true;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      fail("Provider returned invalid streaming data.");
    }
    if (!parsed || parsed.error || parsed.type === "error")
      fail("Provider stream reported an error.");
    if (protocol === "anthropic-compatible") {
      if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "text_delta" &&
        typeof parsed.delta.text === "string" &&
        parsed.delta.text.length > 0
      )
        hasText = true;
      if (parsed.type === "message_stop") completed = true;
    } else if (Array.isArray(parsed.choices)) {
      for (const choice of parsed.choices) {
        if (typeof choice.delta?.content === "string" && choice.delta.content.length > 0)
          hasText = true;
        if (choice.finish_reason != null) completed = true;
      }
    }
  }
  if (!hasText || !completed) fail("Provider stream did not complete a text response.");
}

// Discovery is read-only. Generation requires explicit opt-in and execution guards.
// Errors never include a provider body, URL or credential.
export async function checkProviderConnection(env, fetchImpl = fetch) {
  const protocol = env.MODEL_PROVIDER;
  if (!["openai-compatible", "anthropic-compatible"].includes(protocol))
    fail("MODEL_PROVIDER must select a supported external protocol.");
  for (const name of ["MODEL_BASE_URL", "MODEL_NAME", "MODEL_API_KEY"]) {
    if (!env[name]?.trim()) fail(`${name} is not configured.`);
  }
  let base;
  try {
    base = new URL(env.MODEL_BASE_URL);
  } catch {
    fail("MODEL_BASE_URL must be an HTTPS URL.");
  }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    fail("MODEL_BASE_URL must use HTTPS without credentials, query or fragment.");
  const optIn = env.COSMORA_ALLOW_PAID_CONNECTION_TEST;
  if (optIn && optIn !== paidOptIn) fail("Paid connection-test opt-in is invalid.");
  const live = optIn === paidOptIn;
  if (live) {
    if (env.RUNTIME_EMERGENCY_STOP !== "false")
      fail("Live check blocked: RUNTIME_EMERGENCY_STOP must be explicitly false.");
    if (env.MODEL_FALLBACK_TO_MOCK !== "false")
      fail("Live check requires MODEL_FALLBACK_TO_MOCK=false.");
    if (env.MODEL_MAX_ATTEMPTS_PER_ROUTE !== "1")
      fail("Live check requires MODEL_MAX_ATTEMPTS_PER_ROUTE=1.");
  }
  const endpoint = (suffix) => `${base.href.replace(/\/+$/, "")}/${suffix}`;
  const headers =
    protocol === "anthropic-compatible"
      ? { "x-api-key": env.MODEL_API_KEY, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${env.MODEL_API_KEY}` };
  const request = async (suffix, options = {}) => {
    let response;
    try {
      response = await fetchImpl(endpoint(suffix), {
        ...options,
        headers: options.headers ?? headers,
        redirect: "error",
        signal: AbortSignal.timeout(45_000)
      });
    } catch {
      fail("Provider request failed or timed out; no retry was attempted.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      fail(`Provider returned HTTP ${response.status}; no retry was attempted.`);
    }
    return response;
  };
  try {
    const catalog = await readJson(
      await request(protocol === "anthropic-compatible" ? "models?limit=1000" : "models")
    );
    if (!Array.isArray(catalog.data)) fail("Provider model catalog is invalid.");
    if (!catalog.data.some((model) => model?.id === env.MODEL_NAME)) {
      if (catalog.has_more === true) fail("Provider model catalog is incomplete.");
      fail("Configured model was not found in the provider catalog.");
    }
    let tokenBalance = null;
    if (env.MODEL_PROVIDER_ID === "cheapvibecode") {
      const balance = await readJson(
        await request("balance", { headers: { Authorization: `Bearer ${env.MODEL_API_KEY}` } })
      );
      tokenBalance = balance.token_balance;
      if (typeof tokenBalance !== "number" || !Number.isFinite(tokenBalance) || tokenBalance < 0)
        fail("Provider balance response is invalid.");
      if (live && tokenBalance === 0) fail("Live check blocked: provider balance is zero.");
    }
    if (live) {
      const response = await request(
        protocol === "anthropic-compatible" ? "messages" : "chat/completions",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env.MODEL_NAME,
            messages: [{ role: "user", content: "Reply with exactly OK." }],
            max_tokens: 8,
            stream: true
          })
        }
      );
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel().catch(() => {});
        fail("Provider response is not an SSE stream.");
      }
      verifyStream(await readBody(response, 64 * 1024), protocol);
    }
    return {
      mode: live ? "live" : "discovery",
      model_available: true,
      catalog_count: catalog.data.length,
      token_balance: tokenBalance,
      generation_requests: live ? 1 : 0,
      streaming_verified: live
    };
  } catch (error) {
    if (error instanceof ConnectionCheckError) throw error;
    fail("Provider response could not be checked; no retry was attempted.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await checkProviderConnection(process.env)));
  } catch (error) {
    console.error(
      error instanceof ConnectionCheckError ? error.message : "Connection check failed."
    );
    process.exitCode = 1;
  }
}
