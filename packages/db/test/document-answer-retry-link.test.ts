import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DocumentAnswerStore, openDatabase, ProjectStore, runMigrations } from "../src/index.js";

const insertRun = (
  db: ReturnType<typeof openDatabase>,
  owner: string,
  project: string,
  question: string,
  retry?: { of: string; requestId: string }
) => {
  const id = randomUUID();
  const at = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO document_answer_runs
       (id,project_id,owner_id,question,selected_files_json,sources_json,coverage_json,status,retry_of,retry_request_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,'queued',?,?,?,?)`
    )
    .run(
      id,
      project,
      owner,
      question,
      JSON.stringify(["f"]),
      "[]",
      null,
      retry?.of ?? null,
      retry?.requestId ?? null,
      at,
      at
    );
  return id;
};

describe("document answer retry link (backward-compatible contract)", () => {
  it("distinguishes runs with the same question by the stable retry request id", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const projects = new ProjectStore(db.sqlite);
      const projectA = projects.createProject("Проект", "link-a", "owner").project.id;
      const projectB = projects.createProject("Другой", "link-b", "owner").project.id;
      const store = new DocumentAnswerStore(db.sqlite);
      const source = insertRun(db, "owner", projectA, "Одинаковый вопрос");
      const firstRetry = insertRun(db, "owner", projectA, "Одинаковый вопрос", {
        of: source,
        requestId: "attempt-1"
      });
      const secondRetry = insertRun(db, "owner", projectA, "Одинаковый вопрос", {
        of: source,
        requestId: "attempt-2"
      });
      const sameIdOtherProject = insertRun(db, "owner", projectB, "Одинаковый вопрос", {
        of: source,
        requestId: "attempt-1"
      });

      expect(store.get(projectA, "owner", source)).toMatchObject({
        retry_of: null,
        retry_request_id: null
      });
      expect(store.findByRetryRequest(projectA, "owner", "attempt-1")?.id).toBe(firstRetry);
      expect(store.findByRetryRequest(projectA, "owner", "attempt-2")?.id).toBe(secondRetry);
      expect(store.findByRetryRequest(projectA, "owner", "attempt-1")?.retry_of).toBe(source);
      // Scope is enforced even when the attempt id is reused in another project.
      expect(store.findByRetryRequest(projectB, "owner", "attempt-1")?.id).toBe(sameIdOtherProject);
    } finally {
      db.close();
    }
  });
});
