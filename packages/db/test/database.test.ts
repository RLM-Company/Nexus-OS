import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/index.js";

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
});
