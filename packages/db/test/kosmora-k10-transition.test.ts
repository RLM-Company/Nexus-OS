import { describe, expect, it } from "vitest";
import { ProjectStore, openDatabase, runMigrations } from "../src/index.js";
import type { ProjectHistoryExcerpt } from "@cosmora/contracts";

describe("Kosmora -> project history excerpt", () => {
  const at = "2026-11-10T10:00:00.000Z";
  const history: ProjectHistoryExcerpt[] = [
    { role: "user", content: "Бюджет 19 700 ₽, кроме доставки.", created_at: at },
    { role: "assistant", content: "Принял, уточним код 00123.", created_at: at }
  ];
  const open = async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    return db;
  };

  it("is absent by default and preserves the original message", async () => {
    const db = await open();
    const store = new ProjectStore(db.sqlite);
    const accepted = store.createProject("Оформи как проект: отчёт", "k10-plain");
    expect(accepted.userMessage.content).toBe("Оформи как проект: отчёт");
    expect(accepted.userMessage.content).not.toContain("kosmora_history_excerpt");
    db.close();
  });

  it("carries the selected history as a bounded, labelled data block", async () => {
    const db = await open();
    const store = new ProjectStore(db.sqlite);
    const accepted = store.createProject(
      "Оформи как проект: отчёт",
      "k10-history",
      "local-owner",
      [],
      history
    );
    const content = accepted.userMessage.content;
    expect(content.startsWith("Оформи как проект: отчёт")).toBe(true);
    expect(content).toContain("[kosmora_history_excerpt]");
    expect(content).toContain("19 700 ₽, кроме доставки");
    expect(content).toContain("00123");
    expect(content).toContain("недоверенные цитируемые данные");
    expect(content).toContain("[/kosmora_history_excerpt]");
    // The project title still uses the owner's original message only.
    expect(accepted.project.title).not.toContain("kosmora_history_excerpt");
    db.close();
  });

  it("keeps idempotency and rejects a replay with different history", async () => {
    const db = await open();
    const store = new ProjectStore(db.sqlite);
    const first = store.createProject("Отчёт", "k10-key", "local-owner", [], history);
    const repeat = store.createProject("Отчёт", "k10-key", "local-owner", [], history);
    expect(repeat.duplicate).toBe(true);
    expect(repeat.project.id).toBe(first.project.id);
    expect(() =>
      store.createProject("Отчёт", "k10-key", "local-owner", [], [history[0]!])
    ).toThrow();
    db.close();
  });

  it("refuses oversized history instead of silently truncating it", async () => {
    const db = await open();
    const store = new ProjectStore(db.sqlite);
    const tooLong = Array.from({ length: 9 }, (_, index) => ({
      role: "user" as const,
      content: "Сообщение " + index,
      created_at: at
    }));
    expect(() => store.createProject("Отчёт", "k10-too-many", "local-owner", [], tooLong)).toThrow(
      "INVALID_PROJECT_HISTORY_EXCERPT"
    );
    db.close();
  });
});
