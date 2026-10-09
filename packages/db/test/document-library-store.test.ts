import { describe, expect, it } from "vitest";
import { DocumentLibraryStore, ProjectStore, openDatabase, runMigrations } from "../src/index.js";

describe("document library persistence and isolation", () => {
  it("keeps original bytes and indexed evidence across store instances, then removes the FTS rows", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const first = projects.createProject("Исследование", "doc-project-one", "owner-a").project.id;
      const other = projects.createProject("Другое", "doc-project-two", "owner-b").project.id;
      const library = new DocumentLibraryStore(database.sqlite);
      const bytes = Buffer.from("Ключевые факты\nБюджет 2027", "utf8");
      const staged = library.stage(first, "owner-a", "исследование.txt", bytes);
      expect(staged.status).toBe("processing");
      const complete = library.complete(
        first,
        "owner-a",
        staged.id,
        [{ page: null, text: bytes.toString("utf8") }],
        [{ ordinal: 0, page: null, line_start: 1, line_end: 2, content: bytes.toString("utf8") }]
      );
      expect(complete.status).toBe("ready");
      const afterRestart = new DocumentLibraryStore(database.sqlite);
      expect(afterRestart.original(first, "owner-a", staged.id)?.bytes).toEqual(bytes);
      expect(afterRestart.search(first, "owner-a", ["бюджет"])).toHaveLength(1);
      expect(afterRestart.get(first, "owner-b", staged.id)).toBeNull();
      expect(() => afterRestart.search(first, "owner-b", ["бюджет"])).toThrow("NOT_FOUND");
      expect(afterRestart.search(other, "owner-b", ["бюджет"])).toEqual([]);
      expect(afterRestart.remove(first, "owner-b", staged.id)).toBe(false);
      expect(afterRestart.remove(first, "owner-a", staged.id)).toBe(true);
      expect(
        database.sqlite.prepare("SELECT count(*) AS total FROM document_library_fts").get()?.total
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("fails closed on invalid binaries, excessive text and reindex attempts", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const id = new ProjectStore(database.sqlite).createProject("Проект", "doc-project-validation")
        .project.id;
      const library = new DocumentLibraryStore(database.sqlite);
      for (const name of [
        "bad\u0000.txt",
        "bad\u001f.txt",
        "bad\u007f.txt",
        "../bad.txt",
        "dir\\bad.txt"
      ]) {
        expect(() => library.stage(id, "local-owner", name, Buffer.from("alpha"))).toThrow(
          "INVALID_FILE"
        );
      }
      expect(() => library.stage(id, "local-owner", "fake.pdf", Buffer.from("not a pdf"))).toThrow(
        "INVALID_FILE"
      );
      const file = library.stage(id, "local-owner", "test.txt", Buffer.from("alpha"));
      expect(() =>
        library.complete(
          id,
          "local-owner",
          file.id,
          [{ page: null, text: "a".repeat(2_000_001) }],
          [{ ordinal: 0, page: null, line_start: 1, line_end: 1, content: "a" }]
        )
      ).toThrow("INVALID_INDEX");
      expect(library.get(id, "local-owner", file.id)?.status).toBe("processing");
      library.complete(
        id,
        "local-owner",
        file.id,
        [{ page: null, text: "alpha" }],
        [{ ordinal: 0, page: null, line_start: 1, line_end: 1, content: "alpha" }]
      );
      expect(() =>
        library.complete(
          id,
          "local-owner",
          file.id,
          [{ page: null, text: "alpha" }],
          [{ ordinal: 0, page: null, line_start: 1, line_end: 1, content: "alpha" }]
        )
      ).toThrow("CONFLICT");
    } finally {
      database.close();
    }
  });
});
