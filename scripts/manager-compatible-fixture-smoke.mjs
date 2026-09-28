import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityStore, openDatabase, runMigrations } from "../packages/db/dist/index.js";

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "cosmora-compatible-smoke-"));
const databaseUrl = `file:${join(temporary, "cosmora.db")}`;
const owner = "fixture-owner";
const credential = "local-fixture-only";
let calls = 0;
const stages = [];
let api;

const fixtures = {
  plan: {
    summary: "Создать один документ",
    instructions: "Подготовить результат и проверить содержание",
    complexity: "simple",
    needs_critic: true,
    requires_external_actions: false
  },
  draft: {
    files: [{ name: "result.md", content: "# Проверенный результат\nЛокальный потоковый ответ." }]
  },
  review: { verdict: "PASS", reason: "Документ соответствует поставленной задаче" }
};

const provider = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${credential}`) {
    response.writeHead(401).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const system = body.messages?.find((message) => message.role === "system")?.content ?? "";
  const stage = system.includes("short plan in owner language")
    ? "plan"
    : system.includes("complete useful file contents")
      ? "draft"
      : system.includes("specific assessment in owner language")
        ? "review"
        : "chat";
  calls++;
  stages.push(stage);
  const text = stage === "chat" ? "Локальный ответ проекта" : JSON.stringify(fixtures[stage]);
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(
    `data: ${JSON.stringify({ model: "gpt-5.5", choices: [{ delta: { content: text } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 200, completion_tokens: 80 } })}\n\n`
  );
  response.end("data: [DONE]\n\n");
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const close = (server) => new Promise((resolve) => server.close(resolve));
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

try {
  const providerPort = await listen(provider);
  const database = openDatabase(databaseUrl);
  let token;
  try {
    await runMigrations(database);
    const identity = new IdentityStore(database.sqlite);
    identity.registerActor(owner, owner, "owner");
    token = identity.issueSession({
      ownerId: owner,
      actorId: owner,
      assurance: "single_factor",
      ttlMs: 60_000
    }).token;
  } finally {
    database.close();
  }
  const probe = createServer();
  const apiPort = await listen(probe);
  await close(probe);
  api = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      MODEL_PROVIDER: "openai-compatible",
      MODEL_PROVIDER_ID: "vibecode",
      MODEL_NAME: "gpt-5.5",
      MODEL_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      MODEL_API_KEY: credential,
      MODEL_REGISTRY_PATH: "config/model-registry.vibecode.manager-work-preview.v1.json",
      MODEL_FALLBACK_TO_MOCK: "false",
      MODEL_MAX_ATTEMPTS_PER_ROUTE: "1"
    },
    stdio: "ignore"
  });
  const origin = `http://127.0.0.1:${apiPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      ready = (await fetch(origin + "/api/v1/health")).ok;
      if (ready) break;
    } catch {
      // The API process is still starting.
    }
    await wait(100);
  }
  assert(ready, "Production API did not start");
  assert.equal((await fetch(origin + "/api/v1/projects")).status, 401);
  const request = async (path, method = "GET", data) => {
    const response = await fetch(origin + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    assert(response.ok, `${path} returned HTTP ${response.status}`);
    return response;
  };
  const created = await (
    await request("/api/v1/projects", "POST", {
      initial_message: "Создай небольшой документ",
      client_message_id: randomUUID()
    })
  ).json();
  const base = `/api/v1/projects/${encodeURIComponent(created.project.id)}`;
  await request(base + "/autonomy-profile", "PUT", {
    base_level: "A2",
    overrides: [],
    expected_version: 1
  });
  const work = await (
    await request(base + "/work", "POST", {
      client_request_id: randomUUID(),
      goal: "Создай небольшой документ",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    })
  ).json();
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await (await request(base + "/work/" + encodeURIComponent(work.id))).json();
    if (["completed", "failed", "blocked", "awaiting_approval"].includes(result.status)) break;
    await wait(100);
  }
  assert.equal(
    result.status,
    "completed",
    `Manager stopped: ${result.error_code ?? result.status}`
  );
  assert.equal(result.model_requests, 3);
  assert.equal(result.review?.verdict, "PASS");
  for (let attempt = 0; calls < 4 && attempt < 50; attempt++) await wait(100);
  assert.equal(calls, 4);
  assert.deepEqual(stages.sort(), ["chat", "draft", "plan", "review"]);
  const file = await request(base + "/work/" + encodeURIComponent(work.id) + "/files/result.md");
  assert.match(await file.text(), /Локальный потоковый ответ/);
  process.stdout.write(
    "OpenAI-compatible Manager fixture PASS: production auth, project chat plus 3 streamed work stages, Critic and download; no external request.\n"
  );
} finally {
  if (api && api.exitCode === null) {
    api.kill("SIGTERM");
    await new Promise((resolve) => api.once("exit", resolve));
  }
  await close(provider);
  rmSync(temporary, { recursive: true, force: true });
}
