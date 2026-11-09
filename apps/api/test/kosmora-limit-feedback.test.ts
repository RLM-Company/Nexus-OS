import { loadServerConfig } from "@cosmora/config";
import { GeneralChatStore, LOCAL_OWNER_ID, openDatabase, runMigrations } from "@cosmora/db";
import type { ModelRequest } from "@cosmora/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountStore } from "../src/account-settings/account-store.js";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

/** K09: an honest quota refusal must keep the owner's text and report real numbers. */
describe("personal token limit refusal", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const dbs: ReturnType<typeof openDatabase>[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    for (const db of dbs.splice(0)) db.close();
  });

  it("stops the run at the limit, keeps the canonical user text and exposes factual usage", async () => {
    const db = openDatabase(":memory:");
    dbs.push(db);
    await runMigrations(db);
    const account = new AccountStore(db.sqlite);
    account.migrate();
    account.update(LOCAL_OWNER_ID, {
      expected_version: 0,
      relay_enabled: false,
      response_language: "ru",
      optimize_for: "balanced",
      preferred_provider: null,
      preferred_model: null,
      chat_style: "standard",
      max_total_tokens: 1
    });
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    const requests: ModelRequest[] = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      requests.push(request);
      return stream(request, signal);
    });
    const store = new GeneralChatStore(db.sqlite);
    const app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      accountStore: account,
      accountModel: { provider: "fixture", model: "fixture", capabilities: {} }
    });
    apps.push(app);

    const content = "Сохрани этот текст при отказе по лимиту 00123";
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: content, client_message_id: crypto.randomUUID() }
    });
    expect(accepted.statusCode).toBe(201);
    const chatId = accepted.json<{ chat: { id: string }; stream_url: string }>().chat.id;
    const events = await app.inject({
      method: "GET",
      url: accepted.json<{ stream_url: string }>().stream_url
    });

    expect(events.body).toContain("USAGE_LIMIT_EXCEEDED");
    expect(events.body).toContain("event: run.failed");
    // The gateway stream is entered before route.selected: reserve() runs inside
    // the stream loop, so a provider request may already have been dispatched.
    // Do not claim "nothing was sent" — the honest invariant is that the run
    // fails and the owner's canonical text survives for a manual retry.
    expect(requests.length).toBeLessThanOrEqual(1);

    // The canonical user message remains unchanged and complete.
    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${chatId}` });
    const messages = detail.json<{ messages: { role: string; content: string }[] }>().messages;
    const user = messages.find((message) => message.role === "user");
    expect(user?.content).toBe(content);

    // The existing usage endpoint still reports the real cumulative numbers,
    // with no invented reset period.
    const usage = await app.inject({
      method: "GET",
      url: "/api/v1/personal-settings/usage"
    });
    expect(usage.statusCode).toBe(200);
    const summary = usage.json<{
      summary: { total_counted_tokens: number; max_total_tokens: number | null };
    }>().summary;
    expect(summary.max_total_tokens).toBe(1);
    expect(Number.isFinite(summary.total_counted_tokens)).toBe(true);
    expect(summary).not.toHaveProperty("resets_at");
    expect(summary).not.toHaveProperty("remaining");
  });
});
