import { describe, expect, it } from "vitest";
import {
  openDatabase,
  ProjectCorrectionRuleStore,
  ProjectStore,
  runMigrations
} from "../src/index.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const project = new ProjectStore(db.sqlite).createProject(
    "Сравнение поставщиков",
    "rules",
    "owner"
  ).project.id;
  return { db, project, store: new ProjectCorrectionRuleStore(db.sqlite) };
};

describe("project correction rules", () => {
  it("persists an accepted draft, disables it and restores a previous version", async () => {
    const { db, project, store } = await setup();
    try {
      const first = store.create({
        projectId: project,
        ownerId: "owner",
        clientRequestId: "req-1",
        name: "Правка владельца",
        summary: "Отдельная доставка",
        instructions: "Всегда показывай доставку отдельной строкой"
      });
      expect(first.version).toBe(1);
      expect(first.enabled).toBe(true);
      expect(store.active(project, "owner")).toHaveLength(1);
      // Acceptance is idempotent by client request id, no second version.
      expect(
        store.create({
          projectId: project,
          ownerId: "owner",
          clientRequestId: "req-1",
          name: "Правка владельца",
          summary: "ignored",
          instructions: "ignored"
        }).version
      ).toBe(1);

      const second = store.create({
        projectId: project,
        ownerId: "owner",
        clientRequestId: "req-2",
        name: "Правка владельца",
        summary: "Уточнение",
        instructions: "Всегда показывай доставку отдельной строкой и срок"
      });
      expect(second.version).toBe(2);
      expect(store.active(project, "owner").map((rule) => rule.version)).toEqual([1, 2]);
      const disabled = store.setEnabled(project, "owner", second.id, false, 2);
      expect(disabled.enabled).toBe(false);
      expect(store.active(project, "owner").map((rule) => rule.version)).toEqual([1]);
      const rolledBack = store.rollback(project, "owner", second.id);
      expect(rolledBack.version).toBe(1);
      expect(store.active(project, "owner").map((rule) => rule.version)).toEqual([1]);
      // History is immutable: both versions remain readable.
      expect(store.list(project, "owner")).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});
