import { loadServerConfig } from "@cosmora/config";
import {
  GeneralChatStore,
  ManagerWorkStore,
  ProjectStore,
  openDatabase,
  runMigrations,
  LOCAL_OWNER_ID
} from "@cosmora/db";
import { AccountStore } from "../src/account-settings/account-store.js";
import type { ModelRequest } from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { ownerIdentityPrompt } from "../src/account-settings/owner-identity.js";
import { ManagerService, ChatService } from "@cosmora/core";
import { largeTaskBrief, sharedTaskCondition } from "./fixtures/chat-task-decomposition.js";

describe("profile path: registration -> first dialog", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: GeneralChatStore;
  let account: AccountStore;
  let app: ReturnType<typeof buildApp>;
  let requests: ModelRequest[];
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    const config = loadServerConfig({
      NODE_ENV: "test",
      MOCK_PROVIDER_MODE: "success",
      CHAT_TASK_SPLIT_FAST_ROUTE: "unknown:inactive",
      CHAT_TASK_SPLIT_LARGE_ROUTE: "mock:manager-b0.1"
    });
    const runtime = await buildModelRuntime(config);
    requests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      requests.push(request);
      return stream(request, signal);
    });
    store = new GeneralChatStore(db.sqlite);
    account = new AccountStore(db.sqlite);
    account.migrate();
    app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      accountStore: account,
      accountModel: {
        provider: "verified-provider",
        model: "verified-model",
        capabilities: { streaming: true }
      },
      managerWorkStore: new ManagerWorkStore(db.sqlite),
      projectStore: new ProjectStore(db.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      manager: runtime.manager
    });
  });
  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });
  const put = (body: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url: "/api/v1/personal-settings",
      payload: JSON.stringify(body),
      headers: { "content-type": "application/json" }
    });
  const base = {
    relay_enabled: false,
    response_language: "ru",
    optimize_for: "balanced",
    preferred_provider: null,
    preferred_model: null,
    chat_style: "standard",
    max_total_tokens: null
  };

  it("existing account defaults to masculine address and neutral assistant", () => {
    const settings = account.get(LOCAL_OWNER_ID);
    expect(settings.display_name).toBe("");
    expect(settings.user_gender).toBe("masculine");
    expect(settings.assistant_gender).toBe("neutral");
    expect(ownerIdentityPrompt(settings)).toContain("в мужском роде");
  });

  it("saves name and both genders, survives reload and a second save", async () => {
    const first = await put({
      ...base,
      expected_version: 0,
      display_name: "Анна",
      user_gender: "feminine",
      assistant_gender: "feminine"
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ settings: { display_name: string } }>().settings.display_name).toBe("Анна");
    // Перезагрузка: новый store на той же БД.
    const fresh = new AccountStore(db.sqlite);
    fresh.migrate();
    expect(fresh.get(LOCAL_OWNER_ID)).toMatchObject({
      display_name: "Анна",
      user_gender: "feminine",
      assistant_gender: "feminine"
    });
    // Повторное сохранение с ожидаемой версией.
    const second = await put({
      ...base,
      expected_version: 1,
      display_name: "Анна",
      user_gender: "neutral",
      assistant_gender: "neutral"
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ settings: { user_gender: string } }>().settings.user_gender).toBe(
      "neutral"
    );
  });

  it("rejects invalid gender and a stale version", async () => {
    const bad = await put({
      ...base,
      expected_version: 0,
      display_name: "Тест",
      user_gender: "unknown",
      assistant_gender: "neutral"
    });
    expect(bad.statusCode).toBe(400);
    await put({ ...base, expected_version: 0, display_name: "Ок" });
    const stale = await put({ ...base, expected_version: 0, display_name: "Ещё" });
    expect(stale.statusCode).toBe(409);
  });

  it("affects the ordinary chat model request", async () => {
    await put({
      ...base,
      expected_version: 0,
      display_name: "Мария",
      user_gender: "feminine",
      assistant_gender: "feminine"
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: JSON.stringify({
        initial_message: "Кто ты?",
        client_message_id: crypto.randomUUID()
      }),
      headers: { "content-type": "application/json" }
    });
    expect(created.statusCode).toBe(201);
    const streamUrl = created.json<{ stream_url?: string }>().stream_url;
    if (streamUrl) await app.inject({ method: "GET", url: streamUrl });
    const systemText = requests
      .flatMap((r) => r.messages)
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(systemText).toContain("Ты — Kosmora");
    expect(systemText).toContain("в женском роде");
    expect(systemText).toContain("Имя пользователя: Мария");
    expect(systemText).not.toContain("OpenAI");
  });

  it("splits eligible requests in one metered call and stops when the setting is disabled", async () => {
    const run = async (brief: string) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/chats",
        payload: { initial_message: brief, client_message_id: crypto.randomUUID() }
      });
      expect(created.statusCode, created.body).toBe(201);
      const { stream_url, chat } = created.json<{ stream_url: string; chat: { id: string } }>();
      const response = await app.inject({ method: "GET", url: stream_url });
      expect(response.body).toContain("run.completed");
      expect(store.listMessages(chat.id, LOCAL_OWNER_ID)[0]?.content).toBe(brief);
      return requests.at(-1)!;
    };
    const userText = (request: ModelRequest) =>
      request.messages.findLast((message) => message.role === "user")!.content;
    const disabled = await run(largeTaskBrief);
    expect(userText(disabled)).toBe(largeTaskBrief);
    expect((await put({ ...base, expected_version: 0, task_decomposition: true })).statusCode).toBe(
      200
    );
    const enabled = await run(largeTaskBrief);
    expect(enabled.routing.preferred_model_alias).toBe("manager-b0.1");
    expect(enabled.routing.estimated_input_tokens).toBeLessThan(
      disabled.routing.estimated_input_tokens
    );
    expect(userText(enabled)).toContain(`[[shared:1]]=${sharedTaskCondition}`);
    expect(userText(enabled)).toContain("[[step:3]] 3. Напиши сопроводительное письмо.");
    expect(userText(enabled).split(sharedTaskCondition)).toHaveLength(2);
    const shortBrief = "1. Найди тезис.\n2. Приведи пример.";
    expect(userText(await run(shortBrief))).toBe(shortBrief);
    account.setExecution(LOCAL_OWNER_ID, {
      expected_version: 0,
      model_profile: "mars",
      autonomy: 2,
      turbo: true
    });
    const fast = await run(shortBrief);
    expect(fast.routing.preferred_provider).toBe("mock");
    expect(userText(fast)).toContain("[[step:2]] 2. Приведи пример.");
    const simple = "Как будет спасибо на английском?";
    expect(userText(await run(simple))).toBe(simple);
    expect(
      (await put({ ...base, expected_version: 1, task_decomposition: false })).statusCode
    ).toBe(200);
    expect(userText(await run(shortBrief))).toBe(shortBrief);
    expect(requests).toHaveLength(6);
  });

  it("affects Koswork (ManagerService) requests", () => {
    const manager = new ManagerService({
      preferredProvider: "mock",
      preferredModelAlias: "chat",
      fallbackAllowed: false
    });
    const settings = account.get(LOCAL_OWNER_ID);
    settings.display_name = "Иван";
    settings.user_gender = "masculine";
    settings.assistant_gender = "masculine";
    const request = manager.buildRequest({
      projectId: "p1",
      runId: "r1",
      messages: [],
      identityPrompt: ownerIdentityPrompt(settings)
    });
    const system = request.messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("в мужском роде");
    expect(system).toContain("Имя пользователя: Иван");
    expect(system).toContain("Ты — Kosmora");
  });

  it("ChatService without identityPrompt keeps the default system prompt", () => {
    const chat = new ChatService({
      preferredProvider: "mock",
      preferredModelAlias: "chat",
      fallbackAllowed: false
    });
    const context = {
      chatId: "c1",
      runId: "r1",
      messages: [
        {
          id: "m1",
          chat_id: "c1",
          role: "user" as const,
          content: "Привет",
          content_type: "text" as const,
          status: "completed" as const,
          run_id: null,
          error_code: null,
          created_at: "2026-11-15T10:00:00Z",
          updated_at: "2026-11-15T10:00:00Z"
        }
      ]
    };
    const withIdentity = chat.buildRequest({
      ...context,
      identityPrompt: ownerIdentityPrompt(account.get(LOCAL_OWNER_ID))
    }).messages[0]!.content;
    const without = chat.buildRequest(context).messages[0]!.content;
    expect(withIdentity.length).toBeGreaterThan(without.length);
    expect(withIdentity).toContain("в мужском роде");
    expect(without).not.toContain("в мужском роде");
  });
});
