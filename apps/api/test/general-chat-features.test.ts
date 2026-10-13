import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  GeneralChatStore,
  openDatabase,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import type { ModelRequest } from "@cosmora/contracts";

describe("Kosmora Chat Enhancements API (Blocks 1-4)", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let chats: GeneralChatStore;
  let app: ReturnType<typeof buildApp>;
  let modelRequests: ModelRequest[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    modelRequests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      modelRequests.push(request);
      return stream(request, signal);
    });
    chats = new GeneralChatStore(database.sqlite);
    app = buildApp({
      config,
      database,
      generalChatStore: chats,
      projectStore: new ProjectStore(database.sqlite),
      emergencyStopStore: new EmergencyStopStore(database.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      manager: runtime.manager
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  // === Block 1: Branching & Regeneration ===
  it("forks and edits a message, launching an isolated branch without sibling leakage", async () => {
    // 1. Initial chat turn
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Вопрос 1", client_message_id: "fork-test-1" }
    });
    expect(create.statusCode).toBe(201);
    const chat = create.json<{ chat: { id: string }; run_id: string; stream_url: string }>();
    await app.inject({ method: "GET", url: chat.stream_url });

    // 2. Second turn on main branch
    const turn2 = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chat.chat.id}/messages`,
      payload: { content: "Вопрос 2 на главной ветке", client_message_id: "fork-test-2" }
    });
    expect(turn2.statusCode).toBe(202);
    const run2 = turn2.json<{ run_id: string; stream_url: string }>();
    await app.inject({ method: "GET", url: run2.stream_url });

    // 3. Fork from initial user message (parent_message_id: null)
    const fork = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chat.chat.id}/fork`,
      payload: {
        parent_message_id: null,
        content: "Вопрос 1 (новая ветка)",
        client_message_id: "fork-test-branch-1"
      }
    });
    expect(fork.statusCode).toBe(201);
    const forkData = fork.json<{ chat: { id: string; active_branch_id: string }; stream_url: string }>();
    expect(forkData.chat.active_branch_id).not.toBe("main");

    await app.inject({ method: "GET", url: forkData.stream_url });

    // Verify model request on fork contains ONLY the new question, not the old branch messages!
    const lastRequest = modelRequests.at(-1);
    const userPrompts = lastRequest?.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userPrompts).toEqual(["Вопрос 1 (новая ветка)"]);
    expect(userPrompts).not.toContain("Вопрос 2 на главной ветке");
  });

  it("regenerates assistant message excluding older assistant turn from context", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Объясни квантовые вычисления", client_message_id: "regen-test-1" }
    });
    const chat = create.json<{ chat: { id: string }; run_id: string; stream_url: string }>();
    await app.inject({ method: "GET", url: chat.stream_url });

    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${chat.chat.id}` });
    const messages = detail.json<{ messages: Array<{ id: string; role: string; content: string }> }>().messages;
    const assistantMsg = messages.find((m) => m.role === "assistant")!;

    // Regenerate
    const regen = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chat.chat.id}/messages/${assistantMsg.id}/regenerate`,
      payload: { client_message_id: "regen-client-1" }
    });
    expect(regen.statusCode).toBe(201);
    const regenData = regen.json<{ stream_url: string }>();
    await app.inject({ method: "GET", url: regenData.stream_url });

    // Context for regeneration must NOT contain the old assistant message!
    const lastRequest = modelRequests.at(-1);
    const assistantTurns = lastRequest?.messages.filter((m) => m.role === "assistant");
    expect(assistantTurns).toHaveLength(0);
  });

  // === Block 2: Organization (Folders, Pinning, FTS Search) ===
  it("creates, updates, lists and deletes folders, and organizes chats with pinning", async () => {
    // Create folder
    const createFolder = await app.inject({
      method: "POST",
      url: "/api/v1/chat-folders",
      payload: { name: "Проекты" }
    });
    expect(createFolder.statusCode).toBe(201);
    const folder = createFolder.json<{ id: string; name: string }>();

    // Update folder
    const updateFolder = await app.inject({
      method: "PATCH",
      url: `/api/v1/chat-folders/${folder.id}`,
      payload: { name: "Важные проекты" }
    });
    expect(updateFolder.statusCode).toBe(200);
    expect(updateFolder.json<{ name: string }>().name).toBe("Важные проекты");

    // Create a chat and move to folder with pinning
    const chatRes = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Архитектура ядра Kosmora", client_message_id: "org-chat-1" }
    });
    const chatId = chatRes.json<{ chat: { id: string } }>().chat.id;

    const organize = await app.inject({
      method: "PATCH",
      url: `/api/v1/chats/${chatId}/organize`,
      payload: { folder_id: folder.id, pinned: true, pinned_order: 1 }
    });
    expect(organize.statusCode).toBe(200);

    // List folders checks chat_count
    const folderList = await app.inject({ method: "GET", url: "/api/v1/chat-folders" });
    const folderItem = folderList.json<{ items: Array<{ id: string; chat_count: number }> }>().items.find((f) => f.id === folder.id);
    expect(folderItem?.chat_count).toBe(1);

    // Search FTS
    const search = await app.inject({
      method: "GET",
      url: "/api/v1/chats/search?q=Архитектура"
    });
    expect(search.statusCode).toBe(200);
    const searchMatches = search.json<{ matches: Array<{ chat_id: string; title: string }> }>().matches;
    expect(searchMatches.length).toBeGreaterThan(0);
    expect(searchMatches[0]?.title).toContain("Архитектура");

    // Delete folder leaves chat with folder_id NULL
    const deleteFolder = await app.inject({
      method: "DELETE",
      url: `/api/v1/chat-folders/${folder.id}`
    });
    expect(deleteFolder.statusCode).toBe(204);

    const chatDetail = await app.inject({ method: "GET", url: `/api/v1/chats/${chatId}` });
    expect(chatDetail.json<{ chat: { folder_id: string | null } }>().chat.folder_id).toBeNull();
  });

  // === Block 3: Context & Memory ===
  it("toggles message context exclusion and manages persistent chat memory and summary", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Запомни: кодовая база Kosmora строгая", client_message_id: "mem-test-1" }
    });
    const chatId = create.json<{ chat: { id: string } }>().chat.id;
    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${chatId}` });
    const userMsgId = detail.json<{ messages: Array<{ id: string }> }>().messages[0]!.id;

    // Toggle exclusion
    const toggle = await app.inject({
      method: "PATCH",
      url: `/api/v1/chats/${chatId}/messages/${userMsgId}/context`,
      payload: { excluded: true }
    });
    expect(toggle.statusCode).toBe(200);
    expect(toggle.json<{ excluded: boolean }>().excluded).toBe(true);

    // Update memory
    const setMemory = await app.inject({
      method: "PUT",
      url: `/api/v1/chats/${chatId}/memory`,
      payload: { memory_notes: "Пользователь — ведущий разработчик" }
    });
    expect(setMemory.statusCode).toBe(200);
    expect(setMemory.json<{ memory: { memory_notes: string } }>().memory.memory_notes).toBe(
      "Пользователь — ведущий разработчик"
    );

    // Generate summary
    const summaryRes = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/summary`,
      payload: { branch_id: "main" }
    });
    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json<{ summary: string }>().summary).toBeDefined();
  });

  // === Block 4: Artifacts (Canvas / Work) ===
  it("creates, updates with version concurrency conflict check, and exports artifacts", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Сформируй спецификацию", client_message_id: "art-test-1" }
    });
    const chatId = create.json<{ chat: { id: string } }>().chat.id;

    // Create artifact
    const createArt = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/artifacts`,
      payload: {
        title: "Спецификация API",
        kind: "document",
        content: "# Спецификация\n\nМодели данных и маршруты"
      }
    });
    expect(createArt.statusCode).toBe(201);
    const artifact = createArt.json<{ id: string; version: number }>();
    expect(artifact.version).toBe(1);

    // Update artifact with matching version
    const updateArt = await app.inject({
      method: "PUT",
      url: `/api/v1/artifacts/${artifact.id}`,
      payload: {
        expected_version: 1,
        title: "Спецификация API v2",
        content: "# Спецификация v2\n\nДобавлен экспорт"
      }
    });
    expect(updateArt.statusCode).toBe(200);
    expect(updateArt.json<{ version: number }>().version).toBe(2);

    // Conflict update with stale expected_version = 1 -> should return 409!
    const conflictUpdate = await app.inject({
      method: "PUT",
      url: `/api/v1/artifacts/${artifact.id}`,
      payload: {
        expected_version: 1,
        content: "Конфликтный текст"
      }
    });
    expect(conflictUpdate.statusCode).toBe(409);
    expect(conflictUpdate.json<{ error: { code: string } }>().error.code).toBe("CONFLICT");

    // Exports in all formats
    const exportMd = await app.inject({ method: "GET", url: `/api/v1/artifacts/${artifact.id}/export?format=markdown` });
    expect(exportMd.statusCode).toBe(200);
    expect(exportMd.headers["content-type"]).toContain("text/markdown");
    expect(exportMd.body).toContain("# Спецификация v2");

    const exportTxt = await app.inject({ method: "GET", url: `/api/v1/artifacts/${artifact.id}/export?format=txt` });
    expect(exportTxt.statusCode).toBe(200);

    const exportHtml = await app.inject({ method: "GET", url: `/api/v1/artifacts/${artifact.id}/export?format=html` });
    expect(exportHtml.statusCode).toBe(200);
    expect(exportHtml.headers["content-type"]).toContain("text/html");
    expect(exportHtml.body).toContain("<!DOCTYPE html>");
    expect(exportHtml.body).not.toContain("<script>");

    const exportJson = await app.inject({ method: "GET", url: `/api/v1/artifacts/${artifact.id}/export?format=json` });
    expect(exportJson.statusCode).toBe(200);
    expect(exportJson.json<{ id: string }>().id).toBe(artifact.id);
  });

  it("promotes chat artifacts and initial plan into a Project with WorkDAG", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Разработай архитектуру сервиса", client_message_id: "promote-art-1" }
    });
    const chatId = create.json<{ chat: { id: string } }>().chat.id;

    // Create an artifact in chat
    const artRes = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/artifacts`,
      payload: {
        title: "Архитектура БД",
        kind: "document",
        content: "# Архитектурный план"
      }
    });
    expect(artRes.statusCode).toBe(201);

    // Promote to project with WorkDAG
    const promote = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/to-project-dag`,
      payload: {
        title: "Проект Архитектура",
        nodes: [
          {
            id: "step1",
            title: "Анализ",
            goal: "Проанализировать требования",
            depends_on: []
          },
          {
            id: "step2",
            title: "Проверка",
            goal: "Проверить артефакты",
            depends_on: ["step1"],
            requires_critic: true
          }
        ]
      }
    });
    expect(promote.statusCode).toBe(201);
    const promoteData = promote.json<{
      project: { id: string; title: string };
      dag_id?: string;
      artifacts_promoted: number;
    }>();
    expect(promoteData.project.id).toBeDefined();
    expect(promoteData.project.title).toBe("Проект Архитектура");
  });
});
