import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelGateway } from "@cosmora/model-gateway";
import {
  openDatabase,
  runMigrations,
  DeveloperApiStore,
  EmergencyStopStore,
  ProjectStore
} from "@cosmora/db";
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
  let gateway: ModelGateway;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new DeveloperApiStore(db.sqlite);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    gateway = runtime.gateway;
    app = buildApp({
      config,
      database: db,
      projectStore: new ProjectStore(db.sqlite),
      emergencyStopStore: new EmergencyStopStore(db.sqlite),
      accountStore: new AccountStore(db.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      developerApiStore: store,
      identityResolver: createDeveloperIdentityResolver(
        store,
        new StaticIdentityResolver({
          owner_id: "owner-a",
          actor_id: "owner-actor-a",
          actor_kind: "owner",
          session_id: "owner-session",
          assurance: "local",
          authenticated_at: "2026-11-27T00:00:00.000Z",
          expires_at: "9999-12-31T23:59:59.999Z"
        })
      )
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

  it("never grants client keys access to the owner's internal API or key administration", async () => {
    const key = await issue(["chat.read"]);
    const ownerProjects = await app.inject({ method: "GET", url: "/api/v1/navigation-context" });
    expect(ownerProjects.statusCode).toBe(200);
    for (const url of [
      "/api/v1/navigation-context",
      "/api/v1/projects",
      "/api/v1/projects?path=/api/v1/developer/v1/usage",
      "/api/v1/developer/v1/keys"
    ]) {
      const response = await app.inject({ method: "GET", url, headers: headers(key.token) });
      expect(response.statusCode, url + ": " + response.body).toBe(401);
    }
    const malformed = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: headers(key.token + "!")
    });
    expect(malformed.statusCode).toBe(401);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/developer/v1/usage",
      headers: headers(key.token)
    });
    expect(allowed.statusCode).toBe(200);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { messages: [{ role: "user", content: "No write grant" }] }
    });
    expect(denied.statusCode).toBe(403);
    const ownerKeys = await app.inject({ method: "GET", url: "/api/v1/developer/v1/keys" });
    expect(ownerKeys.statusCode).toBe(200);
  });

  it("isolates simultaneous streams with identical client IDs across keys and owners", async () => {
    const first = await issue(["chat.write"]);
    const sameOwner = await issue(["chat.write"]);
    const otherOwner = store.issue("owner-b", ["chat.write"], 600_000);
    const signals = new Map<string, AbortSignal>();
    const requestIds = new Map<string, string>();
    const started = Promise.withResolvers<void>();
    vi.spyOn(gateway, "stream").mockImplementation(async function* (request, signal) {
      if (!signal) throw new Error("Missing cancellation signal");
      const label = String(request.messages[0]?.content);
      signals.set(label, signal);
      requestIds.set(label, request.request_id);
      if (signals.size === 2) started.resolve();
      yield { type: "text.delta", delta: "started" };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });
    const stream = (token: string, content: string) =>
      app
        .inject({
          method: "POST",
          url: "/api/v1/developer/v1/chat/completions",
          headers: headers(token),
          payload: {
            messages: [{ role: "user", content }],
            stream: true,
            client_request_id: "shared-id"
          }
        })
        .then((response) => response);
    const cancel = (token: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/developer/v1/chat/completions/shared-id/cancel",
        headers: headers(token)
      });
    const pending = [stream(first.token, "first"), stream(otherOwner.token, "other")];
    try {
      await started.promise;
      expect(requestIds.get("first")).not.toBe(requestIds.get("other"));
      expect(requestIds.get("first")).not.toBe("shared-id");
      const duplicate = await stream(first.token, "duplicate");
      expect(duplicate.statusCode).toBe(409);
      expect(signals.has("duplicate")).toBe(false);
      const foreignKey = await cancel(sameOwner.token);
      expect(foreignKey.statusCode).toBe(404);
      expect(signals.get("first")?.aborted).toBe(false);
      const own = await cancel(first.token);
      expect(own.statusCode).toBe(200);
      expect(signals.get("first")?.aborted).toBe(true);
      expect(signals.get("other")?.aborted).toBe(false);
      const other = await cancel(otherOwner.token);
      expect(other.statusCode).toBe(200);
      expect(signals.get("other")?.aborted).toBe(true);
    } finally {
      // Release both generators even when the vulnerable implementation fails an assertion.
      for (const signal of signals.values()) signal.dispatchEvent(new Event("abort"));
      await Promise.all(pending);
    }
  });

  it("finishes failed streams without leaking diagnostics and releases the request ID", async () => {
    const key = await issue(["chat.write"]);
    const generate = vi.spyOn(gateway, "stream").mockImplementationOnce(async function* () {
      await Promise.resolve();
      yield { type: "text.delta", delta: "partial" };
      throw new Error("private provider diagnostic");
    });
    const request = {
      method: "POST" as const,
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: {
        messages: [{ role: "user", content: "Привет" }],
        stream: true,
        client_request_id: "retry-failure"
      }
    };
    const failed = await app.inject(request);
    expect(failed.statusCode).toBe(200);
    expect(failed.body).toContain("event: run.failed");
    expect(failed.body).not.toContain("private provider diagnostic");
    const cancel = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions/retry-failure/cancel",
      headers: headers(key.token)
    });
    expect(cancel.statusCode).toBe(404);
    generate.mockRestore();
    const retried = await app.inject(request);
    expect(retried.statusCode).toBe(200);
    expect(retried.body).toContain("event: run.completed");
  });

  it("reports invalid external requests as client errors", async () => {
    const key = await issue(["chat.write"]);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { messages: [{ role: "invalid", content: "test" }] }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe("INVALID_REQUEST");
  });

  it("issues a key, serves chat and usage, rejects foreign and revoked keys", async () => {
    const key = await issue(["chat.read", "chat.write"]);
    const answer = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { messages: [{ role: "user", content: "Привет" }] }
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{
      id: string;
      choices: Array<{ message: { content: string } }>;
      usage: { input_tokens: number };
    }>();
    expect(body.choices[0]?.message.content).toBeTruthy();
    expect(body.usage.input_tokens).toBeGreaterThanOrEqual(0);
    const usage = await app.inject({
      method: "GET",
      url: "/api/v1/developer/v1/usage",
      headers: headers(key.token)
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json<{ usage: Array<{ request_id: string }> }>().usage[0]?.request_id).toBe(
      body.id
    );

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

  it("keeps parallel fan-out opt-in and small tasks cheap", async () => {
    const key = await issue(["chat.read", "chat.write"]);
    const small = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: { mode: "parallel", messages: [{ role: "user", content: "Один.short question" }] }
    });
    expect(small.statusCode).toBe(200);
    expect(small.json<{ parallel?: unknown }>().parallel).toBeUndefined();
    const large = await app.inject({
      method: "POST",
      url: "/api/v1/developer/v1/chat/completions",
      headers: headers(key.token),
      payload: {
        mode: "parallel",
        messages: [{ role: "user", content: "Часть один\nЧасть два" }]
      }
    });
    expect(large.statusCode).toBe(200);
    const result = large.json<{ parallel?: { parts: unknown[]; review: { verdict: string } } }>();
    expect(result.parallel?.parts).toHaveLength(2);
    expect(["PASS", "RETRY"]).toContain(result.parallel?.review.verdict);
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
    expect(replay.json<{ task_id: string }>().task_id).toBe(
      task.json<{ task_id: string }>().task_id
    );

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
    const signature = createHmac(
      "sha256",
      Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex")
    )
      .update(JSON.stringify(payload))
      .digest("hex");
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
