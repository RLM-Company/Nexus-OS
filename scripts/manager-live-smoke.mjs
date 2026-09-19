const REQUEST_TIMEOUT_MS = 120_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PAID_SMOKE_CONFIRMATION = "SEND_TWO_PAID_REQUESTS";

let apiOrigin = null;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parseOrigin = (envName, fallback, label) => {
  const configured = process.env[envName] ?? fallback;
  try {
    return new URL(configured);
  } catch {
    throw new Error(`${label} is invalid`);
  }
};

const assertLocalOrigin = (origin) => {
  assert(origin.protocol === "http:", "API origin must use local HTTP");
  assert(LOOPBACK_HOSTS.has(origin.hostname), "API origin must stay on loopback");
  assert(
    origin.username === "" && origin.password === "",
    "API origin must not contain credentials"
  );
  assert(
    origin.pathname === "/" && origin.search === "" && origin.hash === "",
    "API origin must be an origin without path, query or fragment"
  );
};

const fetchResponse = async (path, label, init = {}) => {
  assert(apiOrigin instanceof URL, "API origin is unavailable");
  const url = new URL(path, apiOrigin);
  assert(url.origin === apiOrigin.origin, `${label} must stay on the configured loopback API`);

  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new Error(`${label} is unavailable`);
  }

  assert(response.ok, `${label} returned HTTP ${response.status}`);
  return response;
};

const fetchJson = async (path, label, init) => {
  const response = await fetchResponse(path, label, init);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
};

const postJson = (path, label, body) =>
  fetchJson(path, label, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

const assertAcceptedRun = (accepted, expectedStreamPrefix, label) => {
  assert(apiOrigin instanceof URL, "API origin is unavailable");
  assert(typeof accepted?.run_id === "string", `${label} did not return a run id`);
  assert(typeof accepted?.stream_url === "string", `${label} did not return a stream URL`);
  const streamUrl = new URL(accepted.stream_url, apiOrigin);
  assert(streamUrl.origin === apiOrigin.origin, `${label} stream left the loopback API`);
  assert(
    streamUrl.pathname.startsWith(expectedStreamPrefix),
    `${label} returned an unexpected stream`
  );
};

const waitForCompletedRun = async (streamUrl, label) => {
  const response = await fetchResponse(streamUrl, `${label} stream`);
  const events = await response.text();
  if (events.includes("event: run.failed")) {
    const errorCode = events.match(/"error_code":"([A-Z0-9_]+)"/)?.[1] ?? "UNKNOWN";
    throw new Error(`${label} failed with ${errorCode}`);
  }
  assert(!events.includes("event: run.cancelled"), `${label} was cancelled`);
  assert(events.includes("event: run.completed"), `${label} ended without completion`);
};

const assertCompletedAssistant = (detail, label) => {
  assert(Array.isArray(detail?.messages), `${label} detail is missing messages`);
  const assistant = [...detail.messages]
    .reverse()
    .find((message) => message?.role === "assistant" && message?.status === "completed");
  assert(assistant, `${label} has no completed assistant message`);
  assert(
    typeof assistant.content === "string" && assistant.content.trim(),
    `${label} answer is empty`
  );
};

const main = async () => {
  apiOrigin = parseOrigin("COSMORA_API_ORIGIN", "http://127.0.0.1:3100", "API origin");
  assert(
    process.env.COSMORA_ALLOW_PAID_SMOKE === PAID_SMOKE_CONFIRMATION,
    `Set COSMORA_ALLOW_PAID_SMOKE=${PAID_SMOKE_CONFIRMATION} to authorize exactly two model requests`
  );
  assertLocalOrigin(apiOrigin);

  const runtime = await fetchJson("/api/v1/model-runtime", "Model runtime status");
  assert(runtime.mode !== "mock", "Live smoke requires an external model mode");
  assert(runtime.provider !== "mock", "Live smoke requires an external provider");
  assert(runtime.credential_configured === true, "Live model credential is not configured");
  assert(runtime.fallback_to_mock === false, "Disable mock fallback before live smoke");

  const operations = await fetchJson("/api/v1/operations/status", "Operations status");
  assert(operations.process_stop === null, "A process emergency stop is active");
  assert(operations.active_project_stops === 0, "A project emergency stop is active");

  const runToken = crypto.randomUUID();
  const ordinary = await postJson("/api/v1/chats", "Ordinary chat create", {
    initial_message:
      "Ответь одним коротким предложением: соединение с обычным чатом Cosmora работает.",
    client_message_id: `live-smoke-chat-${runToken}`
  });
  assertAcceptedRun(ordinary, "/api/v1/chat-runs/", "Ordinary chat");
  assert(typeof ordinary?.chat?.id === "string", "Ordinary chat did not return a chat id");
  await waitForCompletedRun(ordinary.stream_url, "Ordinary chat");
  const ordinaryDetail = await fetchJson(
    `/api/v1/chats/${encodeURIComponent(ordinary.chat.id)}`,
    "Ordinary chat detail"
  );
  assertCompletedAssistant(ordinaryDetail, "Ordinary chat");

  const project = await postJson("/api/v1/projects", "Manager project create", {
    initial_message:
      "Подтверди коротко, что Менеджер получил тестовую задачу. Не выполняй внешних действий.",
    client_message_id: `live-smoke-project-${runToken}`
  });
  assertAcceptedRun(project, "/api/v1/runs/", "Manager project");
  assert(typeof project?.project?.id === "string", "Manager project did not return a project id");
  await waitForCompletedRun(project.stream_url, "Manager project");
  const projectDetail = await fetchJson(
    `/api/v1/projects/${encodeURIComponent(project.project.id)}`,
    "Manager project detail"
  );
  assertCompletedAssistant(projectDetail, "Manager project");

  process.stdout.write(
    [
      "Manager live smoke PASS",
      `- Model route: ${runtime.provider}:${runtime.model} (${runtime.mode})`,
      "- Ordinary chat: completed with a non-empty answer",
      "- Manager project: completed with a non-empty answer",
      "- Paid model requests sent: 2",
      "- Response content and credentials were not printed"
    ].join("\n") + "\n"
  );
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown live smoke failure";
  process.stderr.write(`Manager live smoke FAILED: ${message}\n`);
  process.exitCode = 1;
}
