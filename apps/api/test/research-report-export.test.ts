import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations, ProjectStore, PolicyStore } from "@cosmora/db";
import { researchMarkdown } from "@cosmora/core";
import { ResearchStore } from "../src/research/research-store.js";
import { registerResearchRoutes } from "../src/research/research-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { WebSearch } from "../src/web-search.js";

describe("saved research report snapshots", () => {
  it("exports exact owner content with a strong format-specific hash, stale protection and no model runs", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const projects = new ProjectStore(db.sqlite);
    projects.createEmptyProject("report-project", "Отчёт", "owner-a");
    const store = new ResearchStore(db.sqlite);
    const run = store.create("owner-a", "owner-a", "report-project", "Как менялись технологии?");
    const saved = store.update(run.id, "owner-a", ["queued"], (value) => {
      value.status = "completed";
      value.sources = [
        {
          title: "Архив",
          url: "https://example.org/archive",
          snippet: "Источник",
          status: "read",
          passages: ["Точная цитата\nВторая строка"],
          checked_at: "2026-10-22T00:00:00.000Z"
        }
      ];
      value.candidates = [
        { title: "Архив", url: "https://example.org/archive", snippet: "Источник" }
      ];
      value.next_index = 1;
      value.answer = {
        summary: [{ text: "Вывод", citations: [{ source_id: "S1", excerpt_id: "E1" }] }],
        disagreements: [],
        gaps: ["Не хватает данных"]
      };
    })!;
    const app = Fastify();
    let owner = "owner-a";
    registerResearchRoutes({
      app,
      store,
      projects,
      policy: new PolicyStore(db.sqlite),
      search: new WebSearch(),
      identityFor: () => ({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: owner, actor_id: owner })
    });
    try {
      const path = `/api/v1/research/${run.id}/export/md`;
      const result = await app.inject({
        method: "GET",
        url: path,
        headers: { "x-research-updated-at": saved.updated_at }
      });
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(researchMarkdown(saved));
      expect(result.body).toContain(run.id);
      expect(result.body).toContain("[S1:E1](https://example.org/archive)");
      expect(result.body).toContain("Точная цитата");
      const etag = `"${createHash("sha256").update(result.body).digest("hex")}"`;
      expect(result.headers.etag).toBe(etag);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(
        (await app.inject({ method: "GET", url: path, headers: { "if-match": etag } })).statusCode
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: path,
            headers: { "x-research-updated-at": "old" }
          })
        ).statusCode
      ).toBe(412);
      expect(
        (
          await app.inject({
            method: "GET",
            url: path.replace(/md$/, "html"),
            headers: { "if-match": etag }
          })
        ).statusCode
      ).toBe(412);
      // Even a same-millisecond update must change the content hash.
      const changed = {
        ...saved,
        stage: "Changed",
        answer: { summary: [], disagreements: [], gaps: ["Новая версия"] }
      };
      db.sqlite
        .prepare("UPDATE research_v1_runs SET payload_json=? WHERE id=?")
        .run(JSON.stringify(changed), run.id);
      expect(
        (await app.inject({ method: "GET", url: path, headers: { "if-match": etag } })).statusCode
      ).toBe(412);
      owner = "owner-b";
      const denied = await app.inject({ method: "GET", url: path });
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain("Точная цитата");
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 0 });
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM canvas_artifacts").get()).toEqual({
        n: 0
      });
    } finally {
      await app.close();
      db.sqlite.close();
    }
  }, 20000);
});
