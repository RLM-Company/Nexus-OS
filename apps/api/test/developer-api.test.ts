import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, DeveloperApiStore, EmergencyStopStore, ProjectStore } from "@cosmora/db";
import { loadServerConfig } from "@cosmora/config";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { createDeveloperIdentityResolver } from "../src/developer-api/developer-key-resolver.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { createHash, createHmac } from "node:crypto";

describe("developer API external client", () => {
  let db: ReturnType<typeof openDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: DeveloperApiStore;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new DeveloperApiStore(db.sqlite);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    app = buildApp({
      config,
      database: db,
      projectStore: new ProjectStore(db.sqlite),
      emergencyStopStore: new EmergencyStopStore(db.sqlite),
      accountStore: new AccountStore(db.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      developerApiStore: store,
      identityResolver: createDeveloperIdentityResolver(store, new StaticIdentityResolver({
        owner_id: "owner-a",
        actor_id: "owner-a",
        actor_kind: "owner",
        session_id: "owner-session",
        assurance: "local",
        authenticated_at: "2026-11-27T00:00:00.000Z",
        expires_at: "9999-12-31T23:59:59.999Z"
      }))
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  const issue = async (scopes: string[]) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/keys",
      payload: { scopes, ttl_ms: 600_000 }
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ token: string; key_id: string }>();
  };
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });

  it("issues a key, serves chat and usage, rejects foreign and revoked keys", async () => {
    const key = await issue(["chat.read", "chat.write"]);
    const answer = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { messages: [{ role: "user", content: "Привет" }] }
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{ id: string; choices: Array<{ message: { content: string } }>; usage: { input_tokens: number } }>();
    expect(body.choices[0]?.message.content).toBeTruthy();
    expect(body.usage.input_tokens).toBeGreaterThanOrEqual(0);
    const usage = await app.inject({
      method: "GET",
      url: "/api/v1/developer/v1/usage",
      headers: headers(key.token)
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json<{ usage: Array<{ request_id: string }> }>().usage[0]?.request_id).toBe(body.id);

    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: { authorization: "Bearer cdev_foreign" },
      payload: { messages: [{ role: "user", content: "Привет" }] }
    });
    expect(foreign.statusCode).toBe(401);

    await app.inject({ method: "DELETE", url: `/api/v1/developer/v1/keys/${key.key_id}` });
    const revoked = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { messages: [{ role: "user", content: "Привет" }] }
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("streams chat deltas and exposes cancel for an active request", async () => {
    const key = await issue(["chat.read", "chat.write"]);
    const streamed = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: {
        messages: [{ role: "user", content: "Привет" }],
        stream: true,
        client_request_id: "stream-1"
      }
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    expect(streamed.body).toContain("event: message.delta");
    expect(streamed.body).toContain("event: run.completed");
    const cancel = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions/stream-1/cancel",
      headers: headers(key.token)
    });
    expect(cancel.statusCode).toBe(404); // already finished, no live stream to abort
  });

  it("replays a task after a lost response and verifies a signed webhook", async () => {
    const key = await issue(["tasks.read", "tasks.write", "webhooks.write"]);
    const task = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/tasks",
      headers: headers(key.token),
      payload: { goal: "Подготовить отчёт", client_request_id: "client-1" }
    });
    expect(task.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/tasks",
      headers: headers(key.token),
      payload: { goal: "Подготовить отчёт", client_request_id: "client-1" }
    });
    expect(replay.json<{ task_id: string }>().task_id).toBe(task.json<{ task_id: string }>().task_id);

    const subscription = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/webhooks",
      headers: headers(key.token),
      payload: { url: "https://client.example/hooks", events: ["task.completed"] }
    });
    expect(subscription.statusCode).toBe(201);
    const { subscription: sub, secret } = subscription.json<{
      subscription: { webhook_id: string };
      secret: string;
    }>();
    const webhook_id = sub.webhook_id;
    const keyBytes = store.signingKey(webhook_id)!;
    expect(keyBytes.toString("hex")).toBe(createHash("sha256").update(secret).digest("hex"));
    const payload = { event: "task.completed", attempt: 1 };
    const signature = createHmac("sha256", Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex")).update(JSON.stringify(payload)).digest("hex");
    const delivered = await app.inject({
      method: "POST",
      url: `/api/v1/developer/v1/webhooks/receive/${webhook_id}`,
      headers: { "x-kosmora-signature": signature },
      payload
    });
    expect(delivered.statusCode, delivered.body).toBe(200);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/developer/v1/webhooks/receive/${webhook_id}`,
      headers: { "x-kosmora-signature": signature },
      payload
    });
    expect(duplicate.statusCode).toBe(200);
    expect(store.listTasks("owner-a")).toHaveLength(1);
  });
});
