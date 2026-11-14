import { loadServerConfig } from "@cosmora/config";
import {
  GeneralChatStore,
  ProjectStore,
  ManagerWorkStore,
  openDatabase,
  runMigrations,
  LOCAL_OWNER_ID
} from "@cosmora/db";
import type { ModelRequest } from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("project folder scenario (slice E)", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: GeneralChatStore;
  let projects: ProjectStore;
  let app: ReturnType<typeof buildApp>;
  let requests: ModelRequest[];
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    requests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      requests.push(request);
      return stream(request, signal);
    });
    store = new GeneralChatStore(db.sqlite);
    projects = new ProjectStore(db.sqlite);
    app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      projectStore: projects,
      managerWorkStore: new ManagerWorkStore(db.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  const call = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) =>
    app.inject({
      method,
      url: path,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      headers: body === undefined ? {} : { "content-type": "application/json" }
    });
  const projectId = () => projects.createProject("Папка", crypto.randomUUID()).project.id;

  it("create project -> create chat in it -> transfer -> retry -> reload -> isolation", async () => {
    const pA = projectId();
    const pB = projectId();
    // 1. Новый чат сразу в проекте (первый запрос).
    const clientMessageId = crypto.randomUUID();
    const created = await call("POST", "/api/v1/chats", {
      initial_message: "Срок до 20 ноября",
      client_message_id: clientMessageId,
      project_id: pA
    });
    expect(created.statusCode).toBe(201);
    const chatId = created.json<{ chat: { id: string; project_id: string } }>().chat.id;
    expect(created.json<{ chat: { project_id: string } }>().chat.project_id).toBe(pA);

    // 2. Повтор того же запроса идемпотентен и не создаёт второй чат.
    const replay = await call("POST", "/api/v1/chats", {
      initial_message: "Срок до 20 ноября",
      client_message_id: clientMessageId,
      project_id: pA
    });
    expect(replay.statusCode).toBe(200); // duplicate, без второго чата
    expect(replay.json<{ chat: { id: string } }>().chat.id).toBe(chatId);
    const listA = await call("GET", `/api/v1/chats?project_id=${pA}`);
    expect(listA.statusCode).toBe(200);
    expect(
      listA.json<{ items: { id: string }[] }>().items.filter((c) => c.id === chatId)
    ).toHaveLength(1);

    // 3. Перенос во время активного ответа запрещён (409); после завершения — разрешён.
    const busyMove = await call("PATCH", `/api/v1/chats/${chatId}`, { project_id: pB });
    expect(busyMove.statusCode).toBe(409);
    const activeRun = db.sqlite
      .prepare(
        "SELECT id FROM general_chat_runs WHERE chat_id=? AND status IN ('queued','running')"
      )
      .get(chatId) as { id: string } | undefined;
    if (activeRun) store.cancelRun(activeRun.id, LOCAL_OWNER_ID);
    const moved = await call("PATCH", `/api/v1/chats/${chatId}`, { project_id: pB });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<{ chat: { project_id: string } }>().chat.project_id).toBe(pB);
    const back = await call("PATCH", `/api/v1/chats/${chatId}`, { project_id: null });
    expect(back.statusCode).toBe(200);
    expect(back.json<{ chat: { project_id: string | null } }>().chat.project_id).toBeNull();

    // 4. История и вложения сохраняются, ссылка на чат прежняя.
    const detail = await call("GET", `/api/v1/chats/${chatId}`);
    expect(detail.statusCode).toBe(200);
    expect(
      detail.json<{ chat: { id: string }; messages: { content: string }[] }>().messages[0]?.content
    ).toContain("20 ноября");
    expect(detail.json<{ chat: { id: string } }>().chat.id).toBe(chatId);

    // 5. Перезагрузка: новый store видит проектную привязку.
    const fresh = new GeneralChatStore(db.sqlite);
    fresh.updateChat(chatId, LOCAL_OWNER_ID, { project_id: pA });
    expect(new GeneralChatStore(db.sqlite).getChat(chatId, LOCAL_OWNER_ID)?.project_id).toBe(pA);

    // 6. Новый чат проекта получает договорённости с источником.
    const second = await call("POST", "/api/v1/chats", {
      initial_message: "Сделай отчёт",
      client_message_id: crypto.randomUUID(),
      project_id: pA
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json<{ chat: { id: string } }>().chat.id;
    // Запуск ответа, чтобы buildRequest собрал проектный контекст.
    const run = second.json<{ run?: { id?: string }; stream_url?: string }>();
    if (run.stream_url) await call("GET", run.stream_url);
    const userText = requests
      .flatMap((r) => r.messages)
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    expect(userText).toContain("Важное из других чатов этого проекта");
    expect(userText).toContain("20 ноября");
    expect(userText).toContain("[чат проекта");

    // 7. Изоляция: чат другого проекта не видит договорённость.
    const isolated = await call("POST", "/api/v1/chats", {
      initial_message: "Другой проект",
      client_message_id: crypto.randomUUID(),
      project_id: pB
    });
    expect(isolated.statusCode).toBe(201);
    const isolatedId = isolated.json<{ chat: { id: string } }>().chat.id;
    const isolatedRun = isolated.json<{ stream_url?: string }>();
    const before = requests.length;
    if (isolatedRun.stream_url) await call("GET", isolatedRun.stream_url);
    const isolatedText = requests
      .slice(before)
      .flatMap((r) => r.messages)
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    expect(isolatedText).not.toContain("20 ноября");
    expect(isolatedId).not.toBe(secondId);

    // 8. Конфиденциальный чат проекта не получает и не отдаёт контекст.
    await call("PATCH", `/api/v1/chats/${secondId}`, { confidential: true });
    const confidentialRun = await call("POST", `/api/v1/chats/${secondId}/messages`, {
      content: "Приватный вопрос",
      client_message_id: crypto.randomUUID()
    });
    expect([200, 201, 202]).toContain(confidentialRun.statusCode);
    const confidentialText = requests
      .slice(before)
      .flatMap((r) => r.messages)
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    expect(confidentialText).not.toContain("Важное из других чатов этого проекта");
  });

  it("rejects moving into a foreign project", async () => {
    const created = await call("POST", "/api/v1/chats", {
      initial_message: "Вопрос",
      client_message_id: crypto.randomUUID()
    });
    const chatId = created.json<{ chat: { id: string } }>().chat.id;
    const response = await call("PATCH", `/api/v1/chats/${chatId}`, { project_id: "unknown" });
    expect(response.statusCode).toBe(404);
    expect(store.getChat(chatId, LOCAL_OWNER_ID)?.project_id).toBeNull();
  });
});
