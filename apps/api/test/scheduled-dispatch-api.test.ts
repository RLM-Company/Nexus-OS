import {
  openDatabase,
  runMigrations,
  GeneralChatStore,
  ProjectStore,
  ScheduledDispatchStore
} from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerScheduledDispatchRoutes } from "../src/scheduled-dispatch-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import type { IdentityContext } from "@cosmora/contracts";

const dbs: ReturnType<typeof openDatabase>[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const fixture = async (owner = "a") => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const chats = new GeneralChatStore(db.sqlite);
  const projects = new ProjectStore(db.sqlite);
  const store = new ScheduledDispatchStore(db.sqlite);
  const app = Fastify();
  apps.push(app);
  const identity: IdentityContext = {
    ...LOCAL_DEVELOPMENT_IDENTITY,
    owner_id: owner,
    actor_id: owner
  };
  registerScheduledDispatchRoutes({
    app,
    store,
    chats,
    projects,
    identityFor: () => identity
  });
  return { db, chats, projects, store, app };
};
const call = (
  app: FastifyInstance,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
) =>
  app.inject({
    method,
    url: path,
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    headers: body === undefined ? {} : { "content-type": "application/json" }
  });

describe("scheduled dispatch HTTP scenario", () => {
  it("delayed message: create -> tick -> dispatch into an ordinary chat -> replay is idempotent", async () => {
    const { app, chats } = await fixture();
    const chat = chats.createChat("Обычный чат", "c1", "a");
    chats.cancelRun(chat.run.id, "a");
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    const created = await call(app, "POST", "/api/v1/scheduled-dispatches", {
      client_request_id: "msg-1",
      kind: "message",
      mode: "once",
      due_at: dueAt,
      text: "Напомни про отчёт",
      chat_id: chat.chat.id
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;

    // Повтор того же запроса возвращает ту же запись.
    const replay = await call(app, "POST", "/api/v1/scheduled-dispatches", {
      client_request_id: "msg-1",
      kind: "message",
      mode: "once",
      due_at: dueAt,
      text: "Напомни про отчёт",
      chat_id: chat.chat.id
    });
    expect(replay.json<{ id: string }>().id).toBe(id);
    // Конфликтующий ключ отклоняется.
    expect(
      (
        await call(app, "POST", "/api/v1/scheduled-dispatches", {
          client_request_id: "msg-1",
          kind: "message",
          mode: "once",
          due_at: new Date(Date.now()).toISOString(),
          text: "Другое",
          chat_id: chat.chat.id
        })
      ).statusCode
    ).toBe(409);

    const tick = await call(app, "POST", "/api/v1/scheduled-dispatches/tick", {});
    expect(tick.json<{ ready: number }>().ready).toBe(1);
    const beforeDispatch = await call(
      app,
      "POST",
      `/api/v1/scheduled-dispatches/${id}/dispatch`,
      {}
    );
    expect(beforeDispatch.statusCode).toBe(200);
    expect(
      chats.listMessages(chat.chat.id, "a").some((m) => m.content === "Напомни про отчёт")
    ).toBe(true);
    // Повтор dispatch не создаёт второе сообщение (client_message_id = scheduled:id).
    expect(
      (await call(app, "POST", `/api/v1/scheduled-dispatches/${id}/dispatch`, {})).statusCode
    ).toBe(409);
    expect(
      chats.listMessages(chat.chat.id, "a").filter((m) => m.content === "Напомни про отчёт")
    ).toHaveLength(1);
  });

  it("daily task: tick is ready and reschedules to the next day", async () => {
    const { app, projects } = await fixture();
    const project = projects.createProject("Проект", "p1", "a").project.id;
    const dueAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const created = await call(app, "POST", "/api/v1/scheduled-dispatches", {
      client_request_id: "task-1",
      kind: "work_task",
      mode: "daily",
      due_at: dueAt,
      text: "Проверить план",
      title: "Ежедневная проверка",
      project_id: project
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;
    const tick = await call(app, "POST", "/api/v1/scheduled-dispatches/tick", {});
    expect(tick.json<{ rescheduled: number }>().rescheduled).toBe(1);
    // Повторяющаяся запись после тика переставляется на следующий день и
    // остаётся в расписании, а не создаёт пачку просроченных duplicate'ов.
    const list = await call(app, "GET", "/api/v1/scheduled-dispatches");
    const item = list
      .json<{ items: Array<{ id: string; status: string; due_at: string }> }>()
      .items.find((x) => x.id === id);
    expect(item?.status).toBe("scheduled");
    expect(Date.parse(item!.due_at)).toBeGreaterThan(Date.now());
  });

  it("cancel, owner isolation and foreign chat/project are rejected", async () => {
    const { app, projects } = await fixture("a");
    const foreign = await fixture("b");
    const project = projects.createProject("Проект", "p1", "a").project.id;
    const created = await call(app, "POST", "/api/v1/scheduled-dispatches", {
      client_request_id: "task-2",
      kind: "koscode_task",
      mode: "weekdays",
      due_at: new Date(Date.now() + 3_600_000).toISOString(),
      text: "Ревью кода",
      project_id: project
    });
    const id = created.json<{ id: string }>().id;
    expect(
      (await call(foreign.app, "GET", "/api/v1/scheduled-dispatches")).json<{ items: unknown[] }>()
        .items
    ).toHaveLength(0);
    expect(
      (await call(foreign.app, "DELETE", `/api/v1/scheduled-dispatches/${id}`)).statusCode
    ).toBe(404);
    expect(
      (
        await call(app, "POST", "/api/v1/scheduled-dispatches", {
          client_request_id: "bad-chat",
          kind: "message",
          mode: "once",
          due_at: new Date(Date.now() + 3_600_000).toISOString(),
          text: "Привет",
          chat_id: "missing"
        })
      ).statusCode
    ).toBe(404);
    expect((await call(app, "DELETE", `/api/v1/scheduled-dispatches/${id}`)).statusCode).toBe(204);
    expect((await call(app, "DELETE", `/api/v1/scheduled-dispatches/${id}`)).statusCode).toBe(404);
  });
});
