import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, ProjectStore, runMigrations } from "../src/index.js";

describe("SQLite foundation", () => {
  it("applies migrations to a clean database", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const row = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("nexus_system_metadata") as { name?: string } | undefined;

      expect(row?.name).toBe("nexus_system_metadata");
    } finally {
      database.close();
    }
  });

  it("can run the migration runner repeatedly", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      await runMigrations(database);
      expect(() => database.ping()).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("persists projects, messages, runs and idempotency records", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const store = new ProjectStore(database.sqlite);
      const accepted = store.createProject("Запусти тестовый проект", "client-project-1");
      const duplicate = store.createProject("Не должно дублироваться", "client-project-1");

      expect(accepted.duplicate).toBe(false);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.project.id).toBe(accepted.project.id);
      expect(store.listProjects()).toHaveLength(1);
      expect(store.listMessages(accepted.project.id)).toHaveLength(1);

      const assistant = store.startAssistantMessage(accepted.run.id);
      expect(assistant?.status).toBe("streaming");
      store.appendAssistantDelta(assistant?.id ?? "", "Готово");
      store.completeRun(accepted.run.id, "mock", "manager-test", {
        inputTokens: 12,
        outputTokens: 4
      });

      expect(store.getRun(accepted.run.id)).toMatchObject({
        status: "succeeded",
        input_tokens: 12,
        output_tokens: 4
      });
      expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
        content: "Готово",
        status: "completed"
      });
    } finally {
      database.close();
    }
  });

  it("restores project history after reopening the SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nexus-db-test-"));
    const file = join(directory, "nexus.db");
    const first = openDatabase(file);

    try {
      await runMigrations(first);
      new ProjectStore(first.sqlite).createProject("Переживи перезапуск", "restart-1");
    } finally {
      first.close();
    }

    const reopened = openDatabase(file);
    try {
      await runMigrations(reopened);
      const store = new ProjectStore(reopened.sqlite);
      expect(store.listProjects()).toHaveLength(1);
      expect(store.listMessages(store.listProjects()[0]?.id ?? "")).toHaveLength(1);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
