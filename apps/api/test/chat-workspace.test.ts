import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  GeneralChatStore,
  ProjectStore,
  CanvasArtifactStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import type { ModelRequest } from "@cosmora/contracts";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { AccountCorePrivacyAdapter } from "../src/account-settings/privacy/account-core-adapter.js";

describe("ordinary chat workspace", () => {
  let db: ReturnType<typeof openDatabase>,
    store: GeneralChatStore,
    projects: ProjectStore,
    canvas: CanvasArtifactStore,
    app: ReturnType<typeof buildApp>,
    requests: ModelRequest[];
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new GeneralChatStore(db.sqlite);
    projects = new ProjectStore(db.sqlite);
    canvas = new CanvasArtifactStore(db.sqlite);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" }),
      runtime = await buildModelRuntime(config);
    requests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((r, s) => {
      requests.push(r);
      return stream(r, s);
    });
    app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      projectStore: projects,
      canvasStore: canvas,
      modelGateway: runtime.gateway,
      chat: runtime.chat
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  async function finish(id: string) {
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/chat-runs/${id}/events` })).body
    ).toContain("event: run.completed");
  }
  async function seed() {
    const s = store.createChat("SECRET_EARLY_FACT", randomUUID());
    await finish(s.run.id);
    return s;
  }
  const put = (url: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" }
    });
  it("persists owner folders, moves chats without reordering, renames and removes the folder while keeping chats", async () => {
    const s = await seed(),
      id = randomUUID(),
      before = store.listChats();
    expect(
      (await put(`/api/v1/chat-navigation/folders/${id}`, { title: "Работа" })).statusCode
    ).toBe(200);
    expect((await put(`/api/v1/chats/${s.chat.id}/folder`, { folder_id: id })).statusCode).toBe(
      200
    );
    expect(
      (await put(`/api/v1/chat-navigation/folders/${id}`, { title: "Проект" })).json<
        ReturnType<GeneralChatStore["workspace"]["navigation"]>
      >().folders
    ).toEqual([{ id, title: "Проект" }]);
    expect(store.listChats()).toEqual(before);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/chat-navigation/folders/${id}`
    });
    expect(
      removed.json<ReturnType<GeneralChatStore["workspace"]["navigation"]>>().assignments
    ).toEqual([]);
    expect(store.getChat(s.chat.id)).not.toBeNull();
  });
  it("imports legacy local pins once without restoring a later unpin or accepting another owner's IDs", async () => {
    const s = await seed(),
      foreign = store.createChat("Other", randomUUID(), "foreign");
    store.cancelRun(foreign.run.id, "foreign");
    const payload = { chats: [s.chat.id, foreign.chat.id], projects: [] };
    expect(
      (
        await app.inject({ method: "POST", url: "/api/v1/chat-navigation/import-pins", payload })
      ).json<ReturnType<GeneralChatStore["workspace"]["navigation"]>>().chats
    ).toEqual([s.chat.id]);
    store.workspace.pin("local-owner", "chats", s.chat.id, false);
    expect(
      (
        await app.inject({ method: "POST", url: "/api/v1/chat-navigation/import-pins", payload })
      ).json<ReturnType<GeneralChatStore["workspace"]["navigation"]>>().chats
    ).toEqual([]);
  });
  it("pins chats and projects on the server idempotently without touching activity; rejects foreign targets and malformed input", async () => {
    const s = await seed(),
      p = projects.createProject("Project", randomUUID()).project,
      foreign = store.createChat("FOREIGN", randomUUID(), "other");
    store.cancelRun(foreign.run.id, "other");
    for (const [kind, id] of [
      ["chats", s.chat.id],
      ["projects", p.id]
    ])
      for (let n = 0; n < 2; n++)
        expect(
          (await put(`/api/v1/chat-navigation/pins/${kind}/${id}`, { pinned: true })).statusCode
        ).toBe(200);
    const before = store.getChat(s.chat.id);
    const nav = (await app.inject({ method: "GET", url: "/api/v1/chat-navigation" })).json<
      ReturnType<GeneralChatStore["workspace"]["navigation"]>
    >();
    expect(nav.chats).toEqual([s.chat.id]);
    expect(nav.projects).toEqual([p.id]);
    expect(store.getChat(s.chat.id)).toEqual(before);
    expect(
      (await put(`/api/v1/chat-navigation/pins/chats/${foreign.chat.id}`, { pinned: true }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await put(`/api/v1/chat-navigation/pins/chats/${s.chat.id}`, {
          pinned: true,
          owner_id: "other"
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await put(`/api/v1/chat-navigation/pins/chats/${s.chat.id}`, { pinned: false })).json<
        ReturnType<GeneralChatStore["workspace"]["navigation"]>
      >().chats
    ).toEqual([]);
  });
  it("excludes only selected history from real model input and leaves stored messages intact", async () => {
    const s = await seed(),
      history = store.listMessages(s.chat.id),
      url = `/api/v1/chats/${s.chat.id}/context`;
    const saved = await put(url, {
      expected_version: 0,
      excluded_ids: history.map((m) => m.id),
      summary: "",
      summary_through: null
    });
    expect(saved.statusCode).toBe(200);
    expect(
      (
        await put(url, {
          expected_version: 0,
          excluded_ids: [],
          summary: "",
          summary_through: null
        })
      ).statusCode
    ).toBe(409);
    const next = store.createMessage(s.chat.id, "PUBLIC_NEXT_TURN", randomUUID())!;
    expect(
      (
        await put(url, {
          expected_version: 1,
          excluded_ids: [],
          summary: "",
          summary_through: null
        })
      ).statusCode
    ).toBe(409);
    await finish(next.run.id);
    expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain("SECRET_EARLY_FACT");
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("PUBLIC_NEXT_TURN");
    expect(store.listMessages(s.chat.id).slice(0, 2)).toEqual(history);
  });
  it("prepares a free extractive draft, applies only approved summary and keeps current user input", async () => {
    const s = await seed();
    for (let i = 0; i < 5; i++) {
      const n = store.createMessage(s.chat.id, `turn-${i}`, randomUUID())!;
      await finish(n.run.id);
    }
    const url = `/api/v1/chats/${s.chat.id}/context`,
      count = requests.length;
    const draft = (
      await app.inject({ method: "POST", url: url + "/draft", payload: { excluded_ids: [] } })
    ).json<{ summary: string; summary_through: string }>();
    expect(draft.summary).toContain("SECRET_EARLY_FACT");
    expect(requests).toHaveLength(count);
    expect(store.workspace.context(s.chat.id, "local-owner").version).toBe(0);
    expect(
      (
        await put(url, {
          ...draft,
          summary: "APPROVED_COMPACT_FACT",
          excluded_ids: [],
          expected_version: 0
        })
      ).statusCode
    ).toBe(200);
    const next = store.createMessage(s.chat.id, "LATEST", randomUUID())!;
    await finish(next.run.id);
    const messages = requests.at(-1)!.messages;
    expect(messages[0]!.content).not.toContain("APPROVED_COMPACT_FACT");
    expect(JSON.stringify(messages)).toContain("APPROVED_COMPACT_FACT");
    expect(JSON.stringify(messages)).not.toContain("SECRET_EARLY_FACT");
    expect(JSON.stringify(messages)).toContain("LATEST");
    expect(
      (
        await put(url, {
          ...draft,
          summary: "APPROVED_COMPACT_FACT",
          excluded_ids: [s.userMessage.id],
          expected_version: 1
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await put(url, {
          summary: "",
          summary_through: null,
          excluded_ids: [],
          expected_version: 1
        })
      ).statusCode
    ).toBe(200);
  });
  it("copies exclusions to variants with new message IDs, without importing a future summary", async () => {
    const s = await seed(),
      next = store.createMessage(s.chat.id, "SECOND", randomUUID())!;
    await finish(next.run.id);
    store.workspace.updateContext(s.chat.id, "local-owner", {
      expected_version: 0,
      excluded_ids: store
        .listMessages(s.chat.id)
        .slice(0, 2)
        .map((m) => m.id),
      summary: "",
      summary_through: null
    });
    const child = store.createChatBranch(s.chat.id, "local-owner", {
      client_branch_id: randomUUID(),
      kind: "edit",
      message_id: next.userMessage.id,
      content: "NEW_SECOND"
    })!;
    const settings = store.workspace.context(child.chat.id, "local-owner");
    expect(settings.excluded_ids).toHaveLength(2);
    expect(settings.excluded_ids[0]).not.toBe(s.userMessage.id);
    expect(settings.summary).toBe("");
    await finish(child.run.id);
    expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain("SECRET_EARLY_FACT");
  });
  it("fences owner writes, exports new data, cascades metadata on deletion and isolates foreign owners", async () => {
    const s = await seed(),
      id = randomUUID(),
      other = store.createChat("OTHER", randomUUID(), "other");
    store.cancelRun(other.run.id, "other");
    store.workspace.folder("local-owner", id, "Mine");
    store.workspace.assign("local-owner", s.chat.id, id);
    store.workspace.pin("local-owner", "chats", s.chat.id, true);
    store.workspace.updateContext(s.chat.id, "local-owner", {
      expected_version: 0,
      excluded_ids: [s.userMessage.id],
      summary: "",
      summary_through: null
    });
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/chats/${other.chat.id}/context` }))
        .statusCode
    ).toBe(404);
    expect((await put(`/api/v1/chats/${other.chat.id}/folder`, { folder_id: id })).statusCode).toBe(
      404
    );
    const adapter = new AccountCorePrivacyAdapter(db.sqlite, async () => {});
    const exported = await adapter.export("local-owner");
    expect(JSON.stringify(exported)).toContain("chat_folders");
    expect(JSON.stringify(exported)).toContain("chat_context");
    expect(JSON.stringify(exported)).not.toContain("OTHER");
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES(?,'deleting',1,'workspace-test',?,?)"
      )
      .run("local-owner", new Date().toISOString(), new Date().toISOString());
    expect(
      (await put(`/api/v1/chat-navigation/pins/chats/${s.chat.id}`, { pinned: false })).statusCode
    ).toBe(409);
    expect(() =>
      db.sqlite
        .prepare("UPDATE chat_context_settings SET summary='' WHERE chat_id=?")
        .run(s.chat.id)
    ).toThrow("OWNER_DATA_FENCED");
    await adapter.delete("local-owner", 1);
    expect(store.getChat(other.chat.id, "other")).not.toBeNull();
    expect(db.sqlite.prepare("SELECT count(*) n FROM chat_folders").get()).toMatchObject({ n: 0 });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("imports an ordinary answer to Canvas once, preserving source attribution and owner boundaries", async () => {
    const s = await seed(),
      message = store.listMessages(s.chat.id).find((m) => m.role === "assistant")!,
      project = projects.createProject("Canvas", randomUUID()).project;
    const input = {
      title: "Answer",
      format: "markdown" as const,
      source: { kind: "chat" as const, chat_id: s.chat.id, message_id: message.id }
    };
    const first = canvas.importSource(project.id, "local-owner", input)!,
      second = canvas.importSource(project.id, "local-owner", input)!;
    expect(first.artifact.id).toBe(second.artifact.id);
    expect(first.revision.content).toBe(message.content);
    expect(first.revision.source).toEqual(input.source);
    expect(canvas.list(project.id, "local-owner")).toHaveLength(1);
    expect(canvas.importSource(project.id, "other", input)).toBeNull();
  });
});
