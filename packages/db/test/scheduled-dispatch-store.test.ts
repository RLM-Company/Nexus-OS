import { describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ScheduledDispatchStore,
  GeneralChatStore,
  ProjectStore
} from "../src/index.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const projectA = projects.createProject("Проект A", "project-a", "a").project.id;
  const projectB = projects.createProject("Проект B", "project-b", "b").project.id;
  return { db, store: new ScheduledDispatchStore(db.sqlite), projectA, projectB };
};
const input = (projectId: string, over: Record<string, unknown> = {}) => ({
  ownerId: "a",
  clientRequestId: "req-1",
  chatId: null,
  projectId,
  kind: "work_task" as const,
  mode: "daily" as const,
  dueAt: "2026-11-16T09:00:00.000Z",
  payload: { text: "Подготовить отчёт", title: "Отчёт" },
  ...over
});

describe("ScheduledDispatchStore", () => {
  it("creates, survives reload, isolates owners and is idempotent", async () => {
    const { db, store, projectA, projectB } = await setup();
    try {
      const created = store.create(input(projectA));
      expect(created.status).toBe("scheduled");
      expect(created.mode).toBe("daily");
      const same = store.create(input(projectA));
      expect(same.id).toBe(created.id);
      expect(
        store.create(input(projectB, { clientRequestId: "req-2", ownerId: "b" })).owner_id
      ).toBe("b");
      expect(store.list("a")).toHaveLength(1);
      expect(store.list("b")).toHaveLength(1);
      expect(store.get(created.id, "b")).toBeNull();

      const reloaded = new ScheduledDispatchStore(db.sqlite);
      expect(reloaded.get(created.id, "a")?.payload.text).toBe("Подготовить отчёт");
    } finally {
      db.close();
    }
  });

  it("tick marks due ready, repeat reschedules, dispatch and cancel are exclusive", async () => {
    const { db, store, projectA } = await setup();
    try {
      const item = store.create(input(projectA, { mode: "once" }));
      expect(store.due("a", "2026-11-16T08:00:00.000Z")).toHaveLength(0);
      expect(store.due("a", "2026-11-16T09:00:01.000Z")).toHaveLength(1);
      expect(store.due("b", "2026-11-16T09:00:01.000Z")).toHaveLength(0);
      store.markReady([item.id], "a");
      expect(store.get(item.id, "a")?.status).toBe("ready");
      expect(store.markDispatched(item.id, "a")).toBe(true);
      expect(store.markDispatched(item.id, "a")).toBe(false);
      expect(store.cancel(item.id, "a")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("rejects invalid input and conflicting idempotency keys", async () => {
    const { db, store, projectA } = await setup();
    try {
      store.create(input(projectA));
      expect(() => store.create(input(projectA, { dueAt: "2026-11-17T09:00:00.000Z" }))).toThrow();
      expect(() => store.create(input(projectA, { dueAt: "не дата" }))).toThrow();
      expect(() => store.create(input(projectA, { kind: "bad" }))).toThrow();
      expect(() => store.create(input(projectA, { kind: "message", chatId: null }))).toThrow();
    } finally {
      db.close();
    }
  });

  it("delayed message is bound to an owned chat", async () => {
    const { db, store, projectA } = await setup();
    try {
      const chats = new GeneralChatStore(db.sqlite);
      const chat = chats.createChat("Обычный чат", "c1", "a");
      chats.cancelRun(chat.run.id, "a");
      const item = store.create(
        input(projectA, {
          kind: "message",
          chatId: chat.chat.id,
          projectId: null,
          mode: "once"
        })
      );
      expect(item.chat_id).toBe(chat.chat.id);
      expect(store.list("a")[0]?.kind).toBe("message");
    } finally {
      db.close();
    }
  });
});
