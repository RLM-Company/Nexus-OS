const TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function originFrom(name, fallback) {
  let origin;
  try {
    origin = new URL(process.env[name] ?? fallback);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  assert(
    origin.protocol === "http:" && LOOPBACK_HOSTS.has(origin.hostname),
    `${name} must be local HTTP`
  );
  assert(
    !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash,
    `${name} must be an origin without credentials or path`
  );
  return origin;
}

const api = originFrom("COSMORA_API_ORIGIN", "http://127.0.0.1:3100");
const web = originFrom("COSMORA_WEB_ORIGIN", "http://127.0.0.1:3000");

async function request(origin, path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(path, origin), {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new Error(`Local service is unavailable: ${origin.origin}`);
  }
  return response;
}

async function json(origin, path, init = {}) {
  const response = await request(origin, path, init);
  assert(response.ok, `${path} returned HTTP ${response.status}`);
  return response.json();
}

async function post(path, body) {
  return json(web, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function main() {
  const [health, runtime, proxiedHealth, proxiedRuntime] = await Promise.all([
    json(api, "/api/v1/health"),
    json(api, "/api/v1/model-runtime"),
    json(web, "/api/v1/health"),
    json(web, "/api/v1/model-runtime")
  ]);
  assert(health.status === "ok" && health.database === "ok", "API or SQLite is unhealthy");
  assert(
    proxiedHealth.status === "ok" && proxiedHealth.database === "ok",
    "Web proxy is unhealthy"
  );
  assert(runtime.mode === "mock" && runtime.provider === "mock", "Only mock mode is allowed");
  assert(runtime.credential_configured === false, "A model credential is configured");
  assert(
    proxiedRuntime.mode === "mock" &&
      proxiedRuntime.provider === "mock" &&
      proxiedRuntime.credential_configured === false,
    "Web is connected to a different or paid model route"
  );

  const nonce = crypto.randomUUID();
  const created = await post("/api/v1/projects", {
    initial_message: "Демонстрация Manager: подготовь локальный документ без внешних действий.",
    client_message_id: `manager-demo-${nonce}`
  });
  const projectId = created.project?.id;
  assert(typeof projectId === "string", "Project was not created");
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  const profile = await json(web, base + "/autonomy-profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_level: "A2", overrides: [], expected_version: 1 })
  });
  assert(profile.profile?.base_level === "A2", "A2 project profile was not applied");

  const payload = {
    client_request_id: `manager-work-${nonce}`,
    goal: "Создай краткий документ с планом запуска проекта",
    worker_role: "analyst",
    max_model_requests: 3,
    max_input_tokens: 32000,
    max_output_tokens: 6000
  };
  const workBase = base + "/work";
  const accepted = await post(workBase, payload);
  assert(typeof accepted.id === "string", "Manager did not accept the task");
  const workPath = workBase + "/" + encodeURIComponent(accepted.id);
  let work;
  const deadline = Date.now() + 10_000;
  do {
    work = await json(web, workPath);
    if (["completed", "failed", "cancelled", "blocked", "awaiting_approval"].includes(work.status))
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert(
    work.status === "completed",
    `Manager stopped at ${work.status} (${work.error_code ?? "no error"})`
  );
  assert(
    work.stage === "done" && work.model_requests === 3,
    "Manager did not finish the three mock stages"
  );
  assert(work.review?.verdict === "PASS", "Critic did not accept the draft");
  assert(
    [
      "План подготовлен",
      "Черновики файлов подготовлены; структура проверена",
      "Критик: PASS",
      "Файлы созданы и доступны для скачивания"
    ].every((message) => work.events.some((event) => event.message === message)),
    "Visible Manager steps are incomplete"
  );

  const file = await request(web, workPath + "/files/result.md");
  assert(
    file.ok && file.headers.get("content-disposition")?.includes("attachment"),
    "File download failed"
  );
  assert(
    (await file.text()).includes("Живая модель не вызывалась"),
    "The artifact is not marked mock"
  );
  const [restored, replay, list] = await Promise.all([
    json(web, workPath),
    post(workBase, payload),
    json(web, workBase)
  ]);
  assert(
    restored.status === "completed" && restored.version === work.version,
    "Saved state changed on reload"
  );
  assert(
    replay.id === work.id && replay.model_requests === 3,
    "Idempotency replay created another run"
  );
  assert(
    list.items?.some((item) => item.id === work.id && item.status === "completed"),
    "Work is absent from project history"
  );

  process.stdout.write(
    `Manager demo smoke PASS\n- Web → API → SQLite: connected\n- A2 task: plan, draft, Critic and download completed\n- Saved state and idempotency: verified\n- Project: ${projectId}\n- Model calls: mock only; no paid request sent\n`
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Manager demo smoke FAILED: ${error instanceof Error ? error.message : "Unknown error"}\n`
  );
  process.exitCode = 1;
}
