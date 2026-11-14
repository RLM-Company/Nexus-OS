import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations, GeneralChatStore, ProjectStore } from "../src/index.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const chats = new GeneralChatStore(db.sqlite);
  const projects = new ProjectStore(db.sqlite);
  const projectA = projects.createProject("Проект A", "project-a", "a").project.id;
  const projectB = projects.createProject("Проект B", "project-b", "a").project.id;
  return { db, chats, projects, projectA, projectB };
};

describe("chat project transfer (slice A)", () => {
  it("moves into a project, between projects and back, keeping history and attachments", async () => {
    const { db, chats, projectA, projectB } = await setup();
    try {
      const attachments = [{ name: "договор.txt", content: "Срок до 20 ноября." }];
      const created = chats.createChat("Обсуждение", "move-1", "a", attachments);
      const chatId = created.chat.id;
      chats.cancelRun(created.run.id, "a"); // дождались ответа: перенос разрешён
      expect(chats.getChat(chatId, "a")!.project_id).toBeNull();

      const intoA = chats.updateChat(chatId, "a", { project_id: projectA });
      expect(intoA!.project_id).toBe(projectA);
      expect(chats.listChats("a", false, projectA).map((c) => c.id)).toContain(chatId);
      // История и вложения на месте после переноса.
      expect(chats.listMessages(chatId, "a")[0]?.attachments).toEqual(attachments);
      expect(chats.getChat(chatId, "a")!.title).toBe("Обсуждение");
      // Ссылка на чат остаётся прежней.
      expect(chats.getChat(chatId, "a")!.id).toBe(chatId);

      const intoB = chats.updateChat(chatId, "a", { project_id: projectB });
      expect(intoB!.project_id).toBe(projectB);
      expect(chats.listChats("a", false, projectA).map((c) => c.id)).not.toContain(chatId);
      expect(chats.listChats("a", false, projectB).map((c) => c.id)).toContain(chatId);

      const back = chats.updateChat(chatId, "a", { project_id: null });
      expect(back!.project_id).toBeNull();
      // Все чаты владельца по-прежнему видны навигации/поиску.
      expect(chats.listChats("a").map((c) => c.id)).toContain(chatId);
      expect(chats.listMessages(chatId, "a")[0]?.attachments).toEqual(attachments);
    } finally {
      db.close();
    }
  });

  it("survives a store reload", async () => {
    const { db, chats, projectA } = await setup();
    try {
      const created = chats.createChat("После перезагрузки", "move-2", "a", []);
      chats.cancelRun(created.run.id, "a");
      chats.updateChat(created.chat.id, "a", { project_id: projectA });
      const reloaded = new GeneralChatStore(db.sqlite);
      expect(reloaded.getChat(created.chat.id, "a")!.project_id).toBe(projectA);
      expect(reloaded.listChats("a", false, projectA).map((c) => c.id)).toContain(created.chat.id);
    } finally {
      db.close();
    }
  });

  it("rejects a foreign or unknown project and keeps the chat untouched", async () => {
    const { db, chats, projectA } = await setup();
    try {
      const created = chats.createChat("Чужой", "move-3", "a", []);
      expect(() => chats.updateChat(created.chat.id, "a", { project_id: "missing" })).toThrow(
        "PROJECT_NOT_FOUND"
      );
      expect(chats.getChat(created.chat.id, "a")!.project_id).toBeNull();
      // Другой владелец не может перенести чат.
      expect(chats.updateChat(created.chat.id, "b", { project_id: projectA })).toBeNull();
      // Проект другого владельца недоступен.
      expect(() =>
        chats.updateChat(created.chat.id, "a", { project_id: projectA + "-foreign" })
      ).toThrow("PROJECT_NOT_FOUND");
    } finally {
      db.close();
    }
  });

  it("refuses to move a chat while its response is still running", async () => {
    const { db, chats, projectA } = await setup();
    try {
      const created = chats.createChat("В процессе", "move-5", "a", []);
      expect(() => chats.updateChat(created.chat.id, "a", { project_id: projectA })).toThrow();
      expect(chats.getChat(created.chat.id, "a")!.project_id).toBeNull();
      chats.cancelRun(created.run.id, "a");
      expect(chats.updateChat(created.chat.id, "a", { project_id: projectA })!.project_id).toBe(
        projectA
      );
    } finally {
      db.close();
    }
  });

  it("isolates project folders between owners", async () => {
    const { db, chats, projectA } = await setup();
    try {
      const created = chats.createChat("Приватный", "move-4", "a", []);
      chats.cancelRun(created.run.id, "a");
      chats.updateChat(created.chat.id, "a", { project_id: projectA });
      expect(chats.listChats("b", false, projectA).map((c) => c.id)).not.toContain(created.chat.id);
      expect(chats.getChat(created.chat.id, "b")).toBeNull();
    } finally {
      db.close();
    }
  });
});
