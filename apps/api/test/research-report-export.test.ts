import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations, ProjectStore, PolicyStore } from "@cosmora/db";
import { researchMarkdown, type ResearchRun } from "@cosmora/core";
import { ResearchStore } from "../src/research/research-store.js";
import { registerResearchRoutes } from "../src/research/research-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { WebSearch } from "../src/web-search.js";
import { ResearchPageReader } from "../src/research/page-reader.js";

it("resumes a temporarily unavailable source after restart without repeating earlier reads", async () => {
  const path = join(tmpdir(), `kosmora-research-${randomUUID()}.sqlite`);
  let db = openDatabase(path);
  let owner = "owner-a";
  const projectId = "research-project";
  const reads: string[] = [];
  let searches = 0;
  const urls = ["one", "two", "three"];
  const search = new WebSearch("http://search:8080", () => {
    searches++;
    return Promise.resolve(
      Response.json({
        results: urls.map((name) => ({
          title: name,
          url: `https://example.org/${name}`,
          content: ""
        }))
      })
    );
  });
  let release: () => void = () => {};
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader = new ResearchPageReader({
    resolver: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    transport: async (url) => {
      if (url.pathname === "/robots.txt") return { status: 404, contentType: "", body: "" };
      reads.push(url.pathname);
      if (url.pathname === "/three") {
        if (reads.filter((value) => value === "/three").length === 1)
          return { status: 503, contentType: "", body: "" };
        await resumed;
      }
      return {
        status: 200,
        contentType: "text/plain",
        body: `История промышленности описана в архивных источниках ${url.pathname}.`
      };
    }
  });
  let app = Fastify();
  let coordinator: ReturnType<typeof registerResearchRoutes> | undefined;
  const register = (adapter: WebSearch) => {
    coordinator = registerResearchRoutes({
      app,
      store: new ResearchStore(db.sqlite),
      projects: new ProjectStore(db.sqlite),
      policy: new PolicyStore(db.sqlite),
      search: adapter,
      reader,
      identityFor: () => ({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: owner, actor_id: owner })
    });
  };
  try {
    await runMigrations(db);
    new ProjectStore(db.sqlite).createEmptyProject(projectId, "Research", owner, "ACTIVE");
    const policy = new PolicyStore(db.sqlite);
    const profile = policy.ensureProfile(projectId)!;
    policy.updateProfile({
      projectId,
      baseLevel: "A1",
      expectedVersion: profile.version,
      overrides: []
    });
    register(search);
    const body = {
      project_id: projectId,
      question: "История промышленности",
      synthesize: false,
      client_request_id: randomUUID()
    };
    const start = (payload = body) =>
      app.inject({ method: "POST", url: "/api/v1/research", payload });
    const [initial, duplicate] = await Promise.all([start(), start()]);
    expect(initial.statusCode, initial.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json<ResearchRun>().id).toBe(initial.json<ResearchRun>().id);
    const runUrl = `/api/v1/research/${initial.json<ResearchRun>().id}`;
    const getRun = async () => (await app.inject({ url: runUrl })).json<ResearchRun>();
    await expect.poll(async () => (await getRun()).status).toBe("paused");
    expect(await getRun()).toMatchObject({ next_index: 2, error_code: "SOURCE_TEMPORARY" });
    const checkpoint = (await getRun()).sources;
    expect(checkpoint).toHaveLength(2);

    await coordinator?.stop();
    await app.close();
    db.close();
    db = openDatabase(path);
    app = Fastify();
    register(new WebSearch());
    const recovered = await start();
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json<ResearchRun>()).toMatchObject({
      id: initial.json<ResearchRun>().id,
      status: "paused"
    });
    expect((await start({ ...body, synthesize: true })).statusCode).toBe(409);
    expect((await start({ ...body, question: "Другой исследовательский запрос" })).statusCode).toBe(
      409
    );
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM research_v1_runs").get()).toEqual({ n: 1 });
    owner = "another-owner";
    expect((await start()).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: runUrl + "/resume" })).statusCode).toBe(404);
    owner = "owner-a";
    expect((await app.inject({ method: "POST", url: runUrl + "/resume" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: runUrl + "/resume" })).statusCode).toBe(409);
    release();
    await expect.poll(async () => (await getRun()).status).toBe("completed");
    const complete = await getRun();
    expect(complete.sources.slice(0, 2)).toEqual(checkpoint);
    expect(complete.sources.map((source) => source.status)).toEqual(["read", "read", "read"]);
    expect(complete.error_code).toBeNull();
    expect(reads).toEqual(["/one", "/two", "/three", "/three"]);
    expect(searches).toBe(1);
    const report = await app.inject({ url: runUrl + "/export/md" });
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("https://example.org/three");
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 0 });
  } finally {
    release();
    await coordinator?.stop();
    await app.close();
    db.close();
    rmSync(path, { force: true });
  }
}, 20000);

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
          passages: ["Первая выдержка", "Точная цитата\nВторая строка"],
          checked_at: "2026-10-22T00:00:00.000Z"
        }
      ];
      value.candidates = [
        { title: "Архив", url: "https://example.org/archive", snippet: "Источник" }
      ];
      value.next_index = 1;
      value.answer = {
        summary: [{ text: "Вывод", citations: [{ source_id: "S1", excerpt_id: "E2" }] }],
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
      expect(result.body).toContain("Вывод [S1:E2](https://example.org/archive)");
      expect(result.body).toContain("**S1:E2**\n\n> Точная цитата\n> Вторая строка");
      const html = await app.inject({ method: "GET", url: path.replace(/md$/, "html") });
      expect(html.statusCode).toBe(200);
      expect(html.body).toContain(
        "<strong>S1:E2</strong></p><blockquote>Точная цитата\nВторая строка"
      );
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
