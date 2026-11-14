import { describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  GeneralChatStore,
  ProjectStore,
  ManagerWorkStore
} from "@cosmora/db";
import { projectChatContext } from "../src/project-chat-context.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const chats = new GeneralChatStore(db.sqlite);
  const projects = new ProjectStore(db.sqlite);
  const works = new ManagerWorkStore(db.sqlite);
  const projectA = projects.createProject("Проект A", "project-a", "a").project.id;
  const projectB = projects.createProject("Проект B", "project-b", "a").project.id;
  return { db, chats, projects, memory: works.memory, projectA, projectB };
};

const chat = (chats: GeneralChatStore, id: string, text: string, title = "Чат") => {
  // initialMessage становится первым пользовательским сообщением чата.
  const created = chats.createChat(text, id, "a");
  chats.cancelRun(created.run.id, "a");
  chats.updateChat(created.chat.id, "a", { title });
  return created.chat.id;
};

describe("projectChatContext", () => {
  it("returns [] for a chat outside any project", async () => {
    const { db, chats, projects, memory } = await setup();
    try {
      const id = chat(chats, "c1", "Договорённость");
      expect(projectChatContext(id, "a", { chats, projects, memory })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("uses agreements from other chats of the same project with an explicit source", async () => {
    const { db, chats, projects, memory, projectA } = await setup();
    try {
      const sourceId = chat(chats, "c1", "Срок до 20 ноября", "Поставка");
      const targetId = chat(chats, "c2", "Новый вопрос", "Отчёт");
      chats.updateChat(sourceId, "a", { project_id: projectA });
      chats.updateChat(targetId, "a", { project_id: projectA });
      const items = projectChatContext(targetId, "a", { chats, projects, memory });
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.text.includes("Срок до 20 ноября"))).toBe(true);
      expect(items.every((i) => i.source.length > 0)).toBe(true);
      expect(items.some((i) => i.source.includes("Поставка"))).toBe(true);
      // Свой же чат не является источником.
      expect(items.some((i) => i.source.includes(targetId))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("isolates memory between projects", async () => {
    const { db, chats, projects, memory, projectA, projectB } = await setup();
    try {
      const sourceId = chat(chats, "c1", "Секрет проекта A");
      const targetId = chat(chats, "c2", "Вопрос B");
      chats.updateChat(sourceId, "a", { project_id: projectA });
      chats.updateChat(targetId, "a", { project_id: projectB });
      const items = projectChatContext(targetId, "a", { chats, projects, memory });
      expect(items.some((i) => i.text.includes("Секрет проекта A"))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("isolates confidential chats in both directions", async () => {
    const { db, chats, projects, memory, projectA } = await setup();
    try {
      const secretId = chat(chats, "c1", "Приватная договорённость");
      const plainId = chat(chats, "c2", "Обычный вопрос");
      chats.updateChat(secretId, "a", { project_id: projectA, confidential: true });
      chats.updateChat(plainId, "a", { project_id: projectA });
      // Конфиденциальный чат не отдаёт свои данные обычному.
      expect(
        projectChatContext(plainId, "a", { chats, projects, memory }).some((i) =>
          i.text.includes("Приватная договорённость")
        )
      ).toBe(false);
      // И сам не получает проектный контекст.
      expect(projectChatContext(secretId, "a", { chats, projects, memory })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("includes project materials with their source", async () => {
    const { db, chats, projects, memory, projectA } = await setup();
    try {
      const id = chat(chats, "c1", "Вопрос");
      chats.updateChat(id, "a", { project_id: projectA });
      projects.setMaterials(projectA, "a", {
        version: 0,
        instructions: "Всегда отвечай тезисами",
        attachments: [{ name: "spec.txt", content: "Формат CSV" }]
      });
      const items = projectChatContext(id, "a", { chats, projects, memory });
      expect(items.some((i) => i.text.includes("Всегда отвечай тезисами"))).toBe(true);
      expect(items.some((i) => i.text.includes("spec.txt"))).toBe(true);
      expect(items.some((i) => i.source.includes("материалы проекта"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
