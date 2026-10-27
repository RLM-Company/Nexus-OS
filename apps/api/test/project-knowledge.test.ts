import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  CanvasArtifactStore,
  DocumentLibraryStore,
  IdentityStore,
  ManagerWorkStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { chunkLibraryPages, knowledgeHash, type KnowledgeHit } from "@cosmora/core";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { ProjectKnowledge } from "../src/project-knowledge.js";
type Found = {
  hits: KnowledgeHit[];
  coverage: Record<string, { available: boolean; omitted_corrupt: number; omitted_budget: number }>;
  candidate_scan_complete: boolean;
};
let db: ReturnType<typeof openDatabase>,
  app: ReturnType<typeof buildApp>,
  projects: ProjectStore,
  canvas: CanvasArtifactStore,
  work: ManagerWorkStore,
  documents: DocumentLibraryStore;
let headers: { authorization: string }, foreign: { authorization: string };
const base = "/api/v1/projects/p/knowledge";
beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  projects = new ProjectStore(db.sqlite);
  canvas = new CanvasArtifactStore(db.sqlite);
  work = new ManagerWorkStore(db.sqlite);
  documents = new DocumentLibraryStore(db.sqlite);
  for (const [id, owner] of [
    ["p", "owner-a"],
    ["other", "owner-a"],
    ["foreign", "owner-b"]
  ] as const)
    projects.createEmptyProject(id, "Fixture", owner, "ACTIVE");
  const identities = new IdentityStore(db.sqlite);
  const session = (owner: string) => {
    identities.registerActor(owner, owner, "owner");
    return {
      authorization:
        "Bearer " +
        identities.issueSession({
          ownerId: owner,
          actorId: owner,
          assurance: "single_factor",
          ttlMs: 60000
        }).token
    };
  };
  headers = session("owner-a");
  foreign = session("owner-b");
  app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    projectStore: projects,
    canvasStore: canvas,
    managerWorkStore: work,
    documentLibrary: documents,
    identityResolver: new BearerSessionIdentityResolver(identities)
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  db.close();
});
const search = (query = "договор", kinds?: string[]) =>
  app.inject({
    method: "POST",
    url: base + "/search",
    headers,
    payload: { query, ...(kinds ? { kinds } : {}) }
  });
const context = (references: KnowledgeHit["reference"][]) =>
  app.inject({ method: "POST", url: base + "/context", headers, payload: { references } });
function note(project = "p", owner = "owner-a", content = "Уникальный договор memory") {
  return work.memory.create(project, owner, {
    title: "Note",
    content,
    pinned: false,
    source: { kind: "owner", reference: "Owner" }
  })!;
}
function document(project = "p", owner = "owner-a", content = "Уникальный договор document") {
  const file = documents.stage(project, owner, "source.txt", Buffer.from(content));
  const pages = [{ page: null, text: content }];
  documents.complete(project, owner, file.id, pages, chunkLibraryPages(pages));
  return file;
}
function artifact(
  id: string,
  project = "p",
  owner = "owner-a",
  status = "completed",
  published = 1
) {
  const content = "Уникальный договор work";
  db.sqlite
    .prepare(
      "INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json) VALUES (?,?,?,?,1,?)"
    )
    .run(id, project, owner, id, JSON.stringify({ status }));
  db.sqlite
    .prepare(
      "INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at) VALUES (?,?,?,?,1,?,?,?,?, 'now')"
    )
    .run(
      id + "-file",
      project,
      id,
      id + ".md",
      content,
      knowledgeHash(content),
      Buffer.byteLength(content),
      published
    );
}
it("finds all four eligible source kinds with literal evidence and no writes or model dispatch", async () => {
  canvas.create("p", "owner-a", {
    title: "Plan",
    format: "text",
    content: "Уникальный договор canvas"
  });
  note();
  document();
  artifact("done");
  const before = db.sqlite.prepare("SELECT count(*) n FROM runs").get()!.n;
  const response = await search();
  expect(response.statusCode, response.body).toBe(200);
  const found = response.json<Found>();
  expect(found.hits.map((h) => h.reference.kind).sort()).toEqual([
    "canvas",
    "document",
    "memory",
    "work"
  ]);
  expect(found.candidate_scan_complete).toBe(true);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  for (const hit of found.hits) {
    expect(hit.excerpt).toContain("договор");
    expect(hit.reference.excerpt_sha256).toBe(knowledgeHash(hit.excerpt));
  }
  expect(projects.getMaterials("p", "owner-a")?.version).toBe(0);
  expect(db.sqlite.prepare("SELECT count(*) n FROM runs").get()!.n).toBe(before);
});
it("isolates projects and owners; excludes unpublished/running Work and forgotten memory", async () => {
  note("other");
  note("foreign", "owner-b");
  document("other");
  document("foreign", "owner-b");
  canvas.create("other", "owner-a", {
    title: "Private",
    format: "text",
    content: "Уникальный договор"
  });
  const forgotten = note();
  work.memory.control("p", "owner-a", forgotten.id, 1, "forget");
  artifact("draft", "p", "owner-a", "completed", 0);
  artifact("running", "p", "owner-a", "running", 1);
  artifact("other-work", "other");
  expect((await search()).json<Found>().hits).toEqual([]);
  expect(
    (
      await app.inject({
        method: "POST",
        url: base + "/search",
        headers: foreign,
        payload: { query: "договор" }
      })
    ).statusCode
  ).toBe(404);
  expect(
    (await app.inject({ method: "POST", url: base + "/search", payload: { query: "договор" } }))
      .statusCode
  ).toBe(401);
  expect(work.runtime.publishedArtifacts("p", "owner-b")).toEqual([]);
});
it("builds a bounded verified attachment that ordinary chat and Work accepts can snapshot", async () => {
  const first = canvas.create("p", "owner-a", {
    title: "Literal <script>",
    format: "text",
    content: "Уникальный договор\r\nSecond line"
  })!;
  const hit = (await search()).json<Found>().hits[0]!;
  const preview = await context([hit.reference]);
  expect(preview.statusCode, preview.body).toBe(200);
  const value = preview.json<{
    attachment: { name: string; content: string };
    attachment_sha256: string;
  }>();
  expect(value.attachment_sha256).toBe(knowledgeHash(value.attachment.content));
  expect(value.attachment.content).toContain('whole_sources_included":false');
  const saved = await app.inject({
    method: "PUT",
    url: "/api/v1/projects/p/materials",
    headers,
    payload: { version: 0, instructions: "", attachments: [value.attachment] }
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const run = projects.createMessage("p", "Explain evidence", "knowledge-message", "owner-a")!;
  const accepted = work.create("p", "owner-a", "owner-a", {
    client_request_id: "knowledge-work",
    goal: "Use evidence",
    worker_role: "analyst",
    max_model_requests: 3,
    max_input_tokens: 32000,
    max_output_tokens: 6000
  })!;
  canvas.update("p", "owner-a", first.artifact.id, {
    baseVersion: 1,
    title: "New",
    format: "text",
    content: "Replacement"
  });
  expect((await context([hit.reference])).json()).toEqual(value);
  canvas.delete("p", "owner-a", first.artifact.id);
  expect((await context([hit.reference])).statusCode).toBe(404);
  expect(projects.getMaterialsForRun(run.run.id, "owner-a")?.attachments).toEqual([
    value.attachment
  ]);
  expect(work.get(accepted.id, "owner-a")?.materials?.attachments).toEqual([value.attachment]);
});
it("refuses stale memory, removed document chunks and forged excerpt/source hashes", async () => {
  const entry = note();
  const file = document();
  const hits = (await search()).json<Found>().hits;
  const memory = hits.find((h) => h.reference.kind === "memory")!,
    doc = hits.find((h) => h.reference.kind === "document")!;
  expect((await context([{ ...doc.reference, excerpt_sha256: "0".repeat(64) }])).statusCode).toBe(
    409
  );
  expect((await context([{ ...doc.reference, sha256: "0".repeat(64) }])).statusCode).toBe(409);
  work.memory.update("p", "owner-a", entry.id, 1, {
    title: entry.title,
    content: "Updated",
    source: entry.source,
    pinned: false
  });
  expect((await context([memory.reference])).statusCode).toBe(409);
  const other = document("other");
  expect(documents.chunk("other", "owner-a", other.id, doc.reference.chunk_id!)).toBeNull();
  expect(documents.chunk("p", "owner-b", file.id, doc.reference.chunk_id!)).toBeNull();
  documents.remove("p", "owner-a", file.id);
  expect((await context([doc.reference])).statusCode).toBe(404);
});
it("omits corrupt canonical artifacts and states incomplete coverage without leaking their body", async () => {
  canvas.create("p", "owner-a", {
    title: "Plan",
    format: "text",
    content: "Уникальный договор canvas"
  });
  const hit = (await search()).json<Found>().hits[0]!;
  const original = canvas.getRevision.bind(canvas);
  vi.spyOn(canvas, "getRevision").mockImplementation((...args) => {
    const value = original(...args);
    return value ? { ...value, content: "corrupt-private" } : null;
  });
  const result = (await search()).json<Found>();
  expect(result.hits).toEqual([]);
  expect(result.coverage.canvas).toMatchObject({ omitted_corrupt: 1 });
  expect(result.candidate_scan_complete).toBe(false);
  const response = await context([hit.reference]);
  expect(response.statusCode).toBe(409);
  expect(response.body).not.toContain("corrupt-private");
});
it("reports scan-budget omissions and refuses silently truncated context", async () => {
  for (let i = 0; i < 5; i++)
    canvas.create("p", "owner-a", {
      title: "Budget " + i,
      format: "text",
      content: "budget ".padEnd(500000, "x")
    });
  const found = (await search("budget", ["canvas"])).json<Found>();
  expect(found.coverage.canvas!.omitted_budget).toBeGreaterThan(0);
  expect(found.candidate_scan_complete).toBe(false);
  const references = found.hits.slice(0, 6).map((h) => h.reference);
  expect(references.length).toBe(4);
  const response = await context(references);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ selected_excerpts: references.length });
  note("p", "owner-a", "budget ".padEnd(1200, "y"));
  note("p", "owner-a", "budget ".padEnd(1200, "z"));
  const large = (await search("budget"))
    .json<Found>()
    .hits.slice(0, 6)
    .map((h) => h.reference);
  expect(large).toHaveLength(6);
  expect((await context(large)).statusCode).toBe(413);
  const unique = references[0]!;
  expect((await context([unique, unique])).statusCode).toBe(400);
});
it("reports missing adapters instead of returning a fake exhaustive empty search", () => {
  const found = new ProjectKnowledge({}).search("p", "owner-a", "договор");
  expect(found.hits).toEqual([]);
  expect(found.candidate_scan_complete).toBe(false);
  expect(Object.values(found.coverage).every((item) => !item.available)).toBe(true);
});
it("preserves a PDF page and source lines when a verified chunk becomes context", async () => {
  const file = documents.stage("p", "owner-a", "report.pdf", Buffer.from("%PDF-1.4\nfixture"));
  const pages = [
    { page: 1, text: "Header" },
    { page: 2, text: "Начало\nДоговор на разработку" }
  ];
  documents.complete("p", "owner-a", file.id, pages, chunkLibraryPages(pages));
  const hit = (await search()).json<Found>().hits[0]!;
  expect(hit).toMatchObject({ page: 2, line_start: 1, line_end: 2 });
  const response = await context([hit.reference]);
  expect(response.statusCode).toBe(200);
  const value = response.json<{ attachment: { content: string } }>();
  const body = JSON.parse(value.attachment.content) as {
    items: Array<{ page: number; line_start: number; line_end: number; excerpt: string }>;
  };
  expect(body.items[0]).toMatchObject({
    page: 2,
    line_start: 1,
    line_end: 2,
    excerpt: pages[1]!.text
  });
});
it("rejects a forged range splitting an emoji even with its recomputed excerpt hash", async () => {
  const text = "🚀 договор";
  canvas.create("p", "owner-a", { title: "Note", format: "text", content: text });
  const reference = (await search()).json<Found>().hits[0]!.reference;
  const forged = {
    ...reference,
    start: 1,
    excerpt_sha256: knowledgeHash(text.slice(1, reference.end))
  };
  expect((await context([forged])).statusCode).toBe(400);
});
it("keeps literal SQL/FTS syntax inert and rejects forged request fields and excessive ranges", async () => {
  note();
  expect((await search("' OR DROP TABLE projects; --")).statusCode).toBe(200);
  expect(projects.getProject("p", "owner-a")).not.toBeNull();
  for (const payload of [
    { query: "договор", owner_id: "owner-b" },
    { query: "a" },
    { query: "договор", kinds: ["table"] },
    { query: "договор", limit: 31 }
  ])
    expect(
      (await app.inject({ method: "POST", url: base + "/search", headers, payload })).statusCode
    ).toBe(400);
  const reference = (await search()).json<Found>().hits[0]!.reference;
  expect((await context([{ ...reference, end: reference.start + 1201 }])).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: base + "/context",
        headers: foreign,
        payload: { references: [reference] }
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: base + "/context",
        payload: { references: [reference] }
      })
    ).statusCode
  ).toBe(401);
});
