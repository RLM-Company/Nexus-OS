import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  CanvasArtifactStore,
  ManagerWorkStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import type {
  ArtifactContextCandidate,
  ArtifactContextPreview,
  ArtifactContextSelection
} from "@cosmora/contracts/artifact-context";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import { buildApp } from "../src/app.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";

describe("saved artifact context snapshots", () => {
  let db: ReturnType<typeof openDatabase>,
    projects: ProjectStore,
    canvas: CanvasArtifactStore,
    works: ManagerWorkStore,
    app: ReturnType<typeof buildApp>,
    foreign: ReturnType<typeof buildApp>;
  let project: string;
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const base = () => `/api/v1/projects/${project}/materials`;
  const sourceRef = ({ kind, id, version, sha256 }: ArtifactContextCandidate) => ({
    kind,
    id,
    version,
    sha256
  });
  const createText = (content: string, title = "Text") =>
    canvas.create(project, "local-owner", { title, content, format: "text" })!;
  const table = () =>
    JSON.stringify({
      schema: "kosmora.studio.data",
      version: 1,
      name: "raw.csv",
      table: {
        delimiter: ",",
        headers: ["ID", "Value", "Value"],
        rows: [
          ["001", "=1+1", 'a,"b"'],
          ["002", "20", "x\r\ny"]
        ]
      },
      settings: {
        types: ["text", "number", "text"],
        columns: [0, 1, 2],
        filters: [],
        sort: null,
        group: null,
        measure: 1,
        chart: { kind: "bar", x: 0, y: 1 }
      }
    });
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    projects = new ProjectStore(db.sqlite);
    canvas = new CanvasArtifactStore(db.sqlite);
    works = new ManagerWorkStore(db.sqlite);
    project = projects.createProject("Context", "context-project").project.id;
    const dependencies = {
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      projectStore: projects,
      canvasStore: canvas,
      managerWorkStore: works
    };
    app = buildApp(dependencies);
    foreign = buildApp({
      ...dependencies,
      identityResolver: new StaticIdentityResolver({
        ...LOCAL_DEVELOPMENT_IDENTITY,
        owner_id: "foreign"
      })
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await foreign.close();
    db.close();
  });
  async function candidates() {
    const response = await app.inject({ method: "GET", url: base() + "/artifacts" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    return response.json<{ items: ArtifactContextCandidate[] }>().items;
  }
  async function preview(
    source: ArtifactContextCandidate,
    selection: ArtifactContextSelection = { kind: "full" }
  ) {
    return app.inject({
      method: "POST",
      url: base() + "/artifacts/preview",
      payload: { source: sourceRef(source), selection }
    });
  }
  it("lists scoped metadata and returns exact text bytes plus explicit provenance without a write", async () => {
    const original = "\ufeffПервая строка\r\n<script>bad()</script>\nПоследняя";
    const created = createText(original, "Literal <title>");
    const beforeRuns = db.sqlite.prepare("SELECT count(*) n FROM runs").get()!.n;
    const listing = await candidates();
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({
      kind: "canvas",
      id: created.artifact.id,
      version: 1,
      sha256: hash(original),
      bytes: Buffer.byteLength(original)
    });
    expect(listing[0]).not.toHaveProperty("content");
    const response = await preview(listing[0]!);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<ArtifactContextPreview>();
    expect(result.attachment.content.endsWith(original)).toBe(true);
    expect(result.attachment.content).toContain("Coverage: complete; 3/3 text lines");
    expect(result.attachment.content).toContain(hash(original));
    expect(result.attachment_sha256).toBe(hash(result.attachment.content));
    expect(result.complete).toBe(true);
    expect(projects.getMaterials(project)?.version).toBe(0);
    expect(canvas.history(project, "local-owner", created.artifact.id)).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT count(*) n FROM runs").get()!.n).toBe(beforeRuns);
  });
  it("requires explicit excerpts for oversized text, preserves original line endings and rejects bad ranges", async () => {
    createText("A\r\nB\rC\n" + "large".repeat(2000));
    const source = (await candidates())[0]!;
    expect((await preview(source)).statusCode).toBe(413);
    const response = await preview(source, { kind: "lines", from: 2, to: 3 });
    expect(response.statusCode, response.body).toBe(200);
    const value = response.json<ArtifactContextPreview>();
    expect(value.complete).toBe(false);
    expect(value.attachment.content).toContain("Coverage: excerpt; 2/4 text lines");
    expect(value.attachment.content.endsWith("B\rC\n")).toBe(true);
    expect((await preview(source, { kind: "lines", from: 4, to: 9 })).statusCode).toBe(400);
    expect((await preview(source, { kind: "rows", from: 1, to: 1, columns: [1] })).statusCode).toBe(
      400
    );
    expect((await preview(source, { kind: "lines", from: 3, to: 2 })).statusCode).toBe(400);
    expect(projects.getMaterials(project)?.attachments).toEqual([]);
  });
  it("projects saved table rows/column positions as quoted CSV with duplicate headers and literal cell values", async () => {
    canvas.create(project, "local-owner", {
      title: "Table",
      format: "code",
      content: table(),
      source: { kind: "data_workspace" }
    });
    const source = (await candidates())[0]!;
    expect(source.kind).toBe("table");
    const response = await preview(source, { kind: "rows", from: 1, to: 1, columns: [3, 2] });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<ArtifactContextPreview>();
    expect(result.attachment.content.endsWith('"Value","Value"\n"a,""b""","=1+1"\n')).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.total_units).toBe(2);
    expect((await preview(source)).json<ArtifactContextPreview>().complete).toBe(true);
    for (const selection of [
      { kind: "rows", from: 1, to: 3, columns: [1] },
      { kind: "rows", from: 1, to: 1, columns: [4] },
      { kind: "rows", from: 1, to: 1, columns: [1, 1] },
      { kind: "lines", from: 1, to: 1 }
    ])
      expect((await preview(source, selection as ArtifactContextSelection)).statusCode).toBe(400);
  });
  it("rejects output overflow even when an individual table cell or Unicode line is oversized", async () => {
    createText("🍋".repeat(7000));
    const source = (await candidates())[0]!;
    expect((await preview(source)).statusCode).toBe(413);
    expect((await preview(source, { kind: "lines", from: 1, to: 1 })).statusCode).toBe(413);
    const raw = parseDataWorkspace(table());
    raw.table.rows[0]![1] = "x".repeat(9000);
    canvas.create(project, "local-owner", {
      title: "big",
      format: "code",
      content: JSON.stringify(raw),
      source: { kind: "data_workspace" }
    });
    const large = (await candidates()).find((s) => s.kind === "table")!;
    expect((await preview(large)).statusCode).toBe(413);
    expect((await preview(large, { kind: "rows", from: 2, to: 2, columns: [1] })).statusCode).toBe(
      200
    );
  });
  it("keeps immutable chosen versions, rejects forged hashes and foreign owner/project/type reads", async () => {
    const first = createText("old");
    const source = (await candidates())[0]!;
    canvas.update(project, "local-owner", first.artifact.id, {
      title: "changed",
      content: "new",
      format: "text",
      baseVersion: 1
    });
    expect(
      (await preview(source)).json<ArtifactContextPreview>().attachment.content.endsWith("old")
    ).toBe(true);
    expect((await preview({ ...source, sha256: "0".repeat(64) })).statusCode).toBe(409);
    expect((await preview({ ...source, kind: "table" })).statusCode).toBe(404);
    expect((await preview({ ...source, version: 999 })).statusCode).toBe(404);
    const payload = { source: sourceRef(source), selection: { kind: "full" } };
    expect(
      (await foreign.inject({ method: "POST", url: base() + "/artifacts/preview", payload }))
        .statusCode
    ).toBe(404);
    expect((await foreign.inject({ method: "GET", url: base() + "/artifacts" })).statusCode).toBe(
      404
    );
    const other = projects.createProject("Other", "other-context").project.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${other}/materials/artifacts/preview`,
          payload
        })
      ).statusCode
    ).toBe(404);
  });
  it("refuses corrupted saved content before returning any source bytes", async () => {
    createText("private");
    const source = (await candidates())[0]!;
    const get = canvas.getRevision.bind(canvas);
    vi.spyOn(canvas, "getRevision").mockImplementation((...args) => {
      const revision = get(...args);
      return revision ? { ...revision, content: "corrupt-private" } : null;
    });
    const response = await preview(source);
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain("corrupt-private");
  });
  it("offers only published completed Work files and checks their canonical hashes", async () => {
    const insert = (id: string, status: string, published: number) => {
      db.sqlite
        .prepare(
          "INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json) VALUES (?,?, 'local-owner',?,1,?)"
        )
        .run(id, project, id, JSON.stringify({ status }));
      db.sqlite
        .prepare(
          "INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at) VALUES (?,?,?,?,1,'exact work',?,10,?,'now')"
        )
        .run(id + "-file", project, id, id + ".md", hash("exact work"), published);
    };
    insert("done", "completed", 1);
    insert("draft", "completed", 0);
    insert("running", "running", 1);
    const listing = await candidates();
    expect(listing).toHaveLength(1);
    expect(listing[0]!.kind).toBe("work");
    expect(
      (await preview(listing[0]!))
        .json<ArtifactContextPreview>()
        .attachment.content.endsWith("exact work")
    ).toBe(true);
    expect((await preview({ ...listing[0]!, id: "draft-file" })).statusCode).toBe(404);
    expect((await preview({ ...listing[0]!, id: "running-file" })).statusCode).toBe(404);
  });
  it("snapshots chosen evidence into new chat/Work accepts and retains it after source edits/deletion", async () => {
    const first = createText("immutable evidence");
    const value = (await preview((await candidates())[0]!)).json<ArtifactContextPreview>();
    const saved = await app.inject({
      method: "PUT",
      url: base(),
      payload: { version: 0, instructions: "Use saved evidence", attachments: [value.attachment] }
    });
    expect(saved.statusCode).toBe(200);
    const run = projects.createMessage(project, "question", "accept-context")!;
    const work = works.create(project, "local-owner", "local-owner", {
      client_request_id: "accept-work",
      goal: "Use evidence",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    })!;
    canvas.update(project, "local-owner", first.artifact.id, {
      title: "new",
      content: "replacement",
      format: "text",
      baseVersion: 1
    });
    canvas.delete(project, "local-owner", first.artifact.id);
    projects.setMaterials(project, "local-owner", {
      version: 1,
      instructions: "",
      attachments: []
    });
    expect(projects.getMaterialsForRun(run.run.id)?.attachments).toEqual([value.attachment]);
    expect(works.get(work.id, "local-owner")?.materials?.attachments).toEqual([value.attachment]);
    expect(projects.getMaterials(project)?.attachments).toEqual([]);
  });
  it("does not change saved materials on stale versions, invalid previews or owner privacy fence", async () => {
    createText("source");
    const source = (await candidates())[0]!;
    expect((await preview(source)).statusCode).toBe(200);
    expect(projects.getMaterials(project)?.version).toBe(0);
    projects.setMaterials(project, "local-owner", {
      version: 0,
      instructions: "saved",
      attachments: []
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: base(),
          payload: { version: 0, instructions: "stale", attachments: [] }
        })
      ).statusCode
    ).toBe(409);
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES ('local-owner','quiescing',1,'context-test','now','now')"
      )
      .run();
    const response = await app.inject({
      method: "PUT",
      url: base(),
      payload: { version: 1, instructions: "late", attachments: [] }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "PROJECT_MATERIALS_OWNER_FENCED" } });
    expect(projects.getMaterials(project)?.instructions).toBe("saved");
    expect(projects.getMaterials(project)?.version).toBe(1);
  });
  it("rejects extra request fields, empty text and wrong source range types", async () => {
    createText("");
    const source = (await candidates())[0]!;
    expect((await preview(source)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base() + "/artifacts/preview",
          payload: {
            source: { ...sourceRef(source), content: "forged" },
            selection: { kind: "full" }
          }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base() + "/artifacts/preview",
          payload: { source: sourceRef(source), selection: { kind: "lines", from: 1.5, to: 2 } }
        })
      ).statusCode
    ).toBe(400);
  });
});
