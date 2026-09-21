import { describe, expect, it } from "vitest";
import {
  AssistantProfileConflictError,
  AssistantProfileStore,
  AssistantProfileValidationError,
  openDatabase,
  runMigrations
} from "../src/index.js";

describe("AssistantProfileStore", () => {
  it("persists versioned owner-scoped profiles with idempotent creation", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const store = new AssistantProfileStore(database.sqlite);
      const input = {
        name: "Редактор",
        instructions: "Пиши лаконично.",
        avatar: "✍️",
        starter_prompts: ["Проверь письмо", "Сократи текст"]
      };
      const created = store.create("profile-1", input, "owner-a", "2026-09-21T10:00:00.000Z");

      expect(created).toMatchObject({ duplicate: false, profile: { ...input, version: 1 } });
      expect(store.create("profile-1", input, "owner-a").duplicate).toBe(true);
      expect(() =>
        store.create("profile-1", { ...input, instructions: "Другие правила" }, "owner-a")
      ).toThrow(AssistantProfileConflictError);
      expect(store.get("profile-1", "owner-b")).toBeNull();
      expect(store.create("profile-1", input, "owner-b").duplicate).toBe(false);
      expect(() =>
        store.create("profile-empty", { name: "   ", instructions: "Правила" }, "owner-a")
      ).toThrow(AssistantProfileValidationError);

      const updated = store.update(
        "profile-1",
        {
          name: "Редактор писем",
          instructions: "Пиши деловые письма.",
          avatar: "📝",
          starter_prompts: ["Улучши письмо"],
          expected_version: 1
        },
        "owner-a",
        "2026-09-21T11:00:00.000Z"
      );
      expect(updated).toMatchObject({
        name: "Редактор писем",
        avatar: "📝",
        starter_prompts: ["Улучши письмо"],
        version: 2
      });
      expect(
        store.update(
          "profile-1",
          { name: "Редактор писем", instructions: "Отвечай яснее.", expected_version: 2 },
          "owner-a"
        )
      ).toMatchObject({
        avatar: "📝",
        starter_prompts: ["Улучши письмо"],
        version: 3
      });
      expect(() => store.update("profile-1", { ...input, expected_version: 1 }, "owner-a")).toThrow(
        AssistantProfileConflictError
      );
      expect(() => store.delete("profile-1", 1, "owner-a")).toThrow(AssistantProfileConflictError);
      expect(() =>
        store.create(
          "profile-invalid-starter",
          { name: "Помощник", instructions: "Помогай.", starter_prompts: ["   "] },
          "owner-a"
        )
      ).toThrow(AssistantProfileValidationError);
    } finally {
      database.close();
    }
  });

  it("deletes only the exact owner version", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const store = new AssistantProfileStore(database.sqlite);
      store.create("profile-delete", { name: "Аналитик", instructions: "Сравнивай." });
      expect(() => store.delete("profile-delete", 2)).toThrow(AssistantProfileConflictError);
      expect(store.delete("profile-delete", 1)).toBe(true);
      expect(store.get("profile-delete")).toBeNull();
      expect(store.delete("profile-delete", 1)).toBeNull();
    } finally {
      database.close();
    }
  });
});
