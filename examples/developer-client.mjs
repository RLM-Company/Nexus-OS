#!/usr/bin/env node
// External client example for Kosmora Developer API v1.
// Usage: node examples/developer-client.mjs [origin]
// Requires an owner session cookie in KOSMORA_OWNER_COOKIE to issue a key.
// Against a local mock API this is a fixture run; against a real origin it is live.
import { createHash, createHmac } from "node:crypto";

const origin = (process.argv[2] ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const base = origin + "/api/v1/developer/v1";
const cookie = process.env.KOSMORA_OWNER_COOKIE ?? "";
const json = (value) => JSON.stringify(value);

async function call(path, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? json(body) : undefined
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, payload, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const main = async () => {
  const issued = await call("/keys", {
    method: "POST",
    body: {
      scopes: ["chat.read", "chat.write", "tasks.read", "tasks.write", "webhooks.write"],
      ttl_ms: 3_600_000
    }
  });
  assert(issued.status === 200, `issue failed: ${issued.status} ${issued.text}`);
  const token = issued.payload.token;
  const keyId = issued.payload.key_id;
  console.log("key issued:", keyId, "(secret shown once)");

  const chat = await call("/chat/completions", {
    method: "POST",
    token,
    body: { messages: [{ role: "user", content: "Сколько будет 40+2?" }] }
  });
  assert(chat.status === 200, `chat failed: ${chat.status} ${chat.text}`);
  console.log("chat answer:", chat.payload.choices?.[0]?.message?.content);

  const stream = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: json({ messages: [{ role: "user", content: "Посчитай 2+2" }], stream: true })
  });
  assert(stream.status === 200, `stream failed: ${stream.status}`);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let sse = "";
  while (sse.length < 64) {
    const { value, done } = await reader.read();
    if (done) break;
    sse += decoder.decode(value, { stream: true });
  }
  await reader.cancel(); // explicit client-side cancellation
  console.log("stream events:", sse.includes("message.delta") ? "delta received" : "no delta");

  const taskBody = { goal: "Подготовить отчёт", client_request_id: "external-" + Date.now() };
  const task = await call("/tasks", { method: "POST", token, body: taskBody });
  assert(task.status === 201, `task failed: ${task.status} ${task.text}`);
  const replay = await call("/tasks", { method: "POST", token, body: taskBody });
  assert(replay.payload.task_id === task.payload.task_id, "replay created a second task");
  console.log("task replay ok:", task.payload.task_id);

  const hook = await call("/webhooks", {
    method: "POST",
    token,
    body: { url: "https://client.example/hooks", events: ["task.completed"] }
  });
  assert(hook.status === 201, `webhook failed: ${hook.status} ${hook.text}`);
  const { subscription, secret } = hook.payload;
  const payload = { event: "task.completed", attempt: 1 };
  const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
  const signature = createHmac("sha256", key).update(json(payload)).digest("hex");
  const delivered = await call(`/webhooks/receive/${subscription.webhook_id}`, {
    method: "POST",
    body: payload,
    headers: { "x-kosmora-signature": signature }
  });
  assert(delivered.status === 200, `webhook delivery failed: ${delivered.status}`);
  console.log("webhook accepted");

  const revoked = await call(`/keys/${keyId}`, { method: "DELETE" });
  assert(revoked.status === 200, `revoke failed: ${revoked.status}`);
  const denied = await call("/chat/completions", {
    method: "POST",
    token,
    body: { messages: [{ role: "user", content: "ещё" }] }
  });
  assert(denied.status === 401, `revoked key not denied: ${denied.status}`);
  console.log("revoked key rejected: ok");
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
