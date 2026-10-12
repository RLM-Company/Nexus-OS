import { loadServerConfig } from "@cosmora/config";
import { ChatHistorySearchStore, IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

describe("owner chat history search", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;
  let tokens: { one: string; two: string; agent: string };

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const identity = new IdentityStore(database.sqlite, {
      now: () => Date.parse("2026-10-10T12:00:00.000Z")
    });
    identity.registerActor("owner-one", "actor-one", "owner");
    identity.registerActor("owner-two", "actor-two", "owner");
    identity.registerActor("owner-one", "actor-agent", "agent");
    const issue = (ownerId: string, actorId: string) =>
      identity.issueSession({ ownerId, actorId, assurance: "single_factor", ttlMs: 60_000 }).token;
    tokens = {
      one: issue("owner-one", "actor-one"),
      two: issue("owner-two", "actor-two"),
      agent: issue("owner-one", "actor-agent")
    };
    const sqlite = database.sqlite;
    const chat = sqlite.prepare(
      "INSERT INTO general_chats (id,owner_id,title,created_at,updated_at,archived) VALUES (?,?,?,'2026-10-09T10:00:00.000Z','2026-10-09T10:00:00.000Z',?)"
    );
    chat.run("g1", "owner-one", "Моя История", 0);
    chat.run("g2", "owner-one", "Архивная беседа", 1);
    chat.run("g3", "owner-two", "Чужой секрет", 0);
    const message = sqlite.prepare(
      "INSERT INTO general_chat_messages (id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES (?,?,?,'user','text',?,'completed','2026-10-09T12:00:00.000Z','2026-10-09T12:00:00.000Z')"
    );
    message.run("gm1", "g1", "owner-one", "Секретный запуск <script>alert(1)</script>");
    message.run("gm2", "g2", "owner-one", "Секретный архив");
    message.run("gm3", "g3", "owner-two", "Секретный чужой текст");
    sqlite
      .prepare(
        "INSERT INTO projects (id,owner_id,title,status,created_at,updated_at) VALUES (? ,?,?,'ACTIVE','2026-10-09T10:00:00.000Z','2026-10-09T10:00:00.000Z')"
      )
      .run("p1", "owner-one", "Лунный проект");
    sqlite
      .prepare(
        "INSERT INTO chats (id,project_id,kind,created_at) VALUES ('pc1','p1','main','2026-10-09T10:00:00.000Z')"
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO messages (id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES ('pm1','p1','pc1','user','text','Секретный проект','completed','2026-10-09T12:00:00.000Z','2026-10-09T12:00:00.000Z')"
      )
      .run();
    app = buildApp({
      config,
      database,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      chatHistorySearchStore: new ChatHistorySearchStore(sqlite)
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const find = (q: string, token: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/chat-history/search?q=${encodeURIComponent(q)}`,
      headers: auth(token)
    });

  it("searches titles and messages in both stores without crossing owners", async () => {
    const found = await find("СЕКРЕТНЫЙ", tokens.one);
    expect(found.statusCode, found.body).toBe(200);
    const hits = found.json<{
      items: Array<{ chat_id: string; message_id: string; snippet: string }>;
    }>().items;
    expect(hits.map((hit) => hit.message_id).sort()).toEqual(["gm1", "pm1"]);
    expect(hits[0]?.snippet).toContain("Секретный");
    expect(found.body).not.toContain("Секретный чужой текст");
    expect(
      (await find("лунный", tokens.one)).json<{ items: Array<{ project_id: string }> }>().items[0]
        ?.project_id
    ).toBe("p1");
    expect(
      (await find("секретный", tokens.two))
        .json<{ items: Array<{ chat_id: string }> }>()
        .items.map((hit) => hit.chat_id)
    ).toEqual(["g3"]);
  });

  it("filters archive, project and date; pages results and reflects edits", async () => {
    const request = async (suffix: string) =>
      app.inject({
        method: "GET",
        url: `/api/v1/chat-history/search?q=секретный${suffix}`,
        headers: auth(tokens.one)
      });
    expect(
      (await request("&archive=archived"))
        .json<{ items: Array<{ message_id: string }> }>()
        .items.map((hit) => hit.message_id)
    ).toEqual(["gm2"]);
    expect(
      (await request("&scope=project&project=p1"))
        .json<{ items: Array<{ message_id: string }> }>()
        .items.map((hit) => hit.message_id)
    ).toEqual(["pm1"]);
    expect((await request("&after=2026-10-10")).json<{ items: unknown[] }>().items).toEqual([]);
    const first = (await request("&archive=all&limit=1")).json<{
      items: unknown[];
      next_offset: number | null;
    }>();
    expect(first.items).toHaveLength(1);
    expect(first.next_offset).toBe(1);
    expect(
      (await request("&archive=all&limit=1&offset=1")).json<{ items: unknown[] }>().items
    ).toHaveLength(1);
    database.sqlite
      .prepare("UPDATE general_chat_messages SET content='Новое слово' WHERE id='gm1'")
      .run();
    expect(
      (await find("секретный", tokens.one))
        .json<{ items: Array<{ message_id: string }> }>()
        .items.map((hit) => hit.message_id)
    ).toEqual(["pm1"]);
    expect((await find("новое", tokens.one)).json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("requires an owner session and rejects malformed requests", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/chat-history/search?q=секретный" }))
        .statusCode
    ).toBe(401);
    expect((await find("секретный", tokens.agent)).statusCode).toBe(403);
    expect((await find("   ", tokens.one)).statusCode).toBe(400);
    expect((await requestInvalidOffset()).statusCode).toBe(400);
    expect((await find('" ) OR *', tokens.one)).json<{ items: unknown[] }>().items).toEqual([]);
  });

  const requestInvalidOffset = () =>
    app.inject({
      method: "GET",
      url: "/api/v1/chat-history/search?q=секретный&offset=1001",
      headers: auth(tokens.one)
    });
});
