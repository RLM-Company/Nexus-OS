import { createHash } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { researchMarkdown, type ResearchRun } from "@cosmora/core";
import { CanvasArtifactStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { ResearchStore } from "../src/research/research-store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("research report as a project material source", () => {
  let db: ReturnType<typeof openDatabase>,
    projects: ProjectStore,
    canvas: CanvasArtifactStore,
    research: ResearchStore,
    app: ReturnType<typeof buildApp>,
    foreign: ReturnType<typeof buildApp>;
  let project: string;
  let run: ResearchRun;

  const base = () => `/api/v1/projects/${project}/materials/artifacts`;
  const post = (url: string, body: unknown, instance = app) =>
    instance.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body)
    });
  const get = (url: string, instance = app) => instance.inject({ method: "GET", url });

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    projects = new ProjectStore(db.sqlite);
    canvas = new CanvasArtifactStore(db.sqlite);
    research = new ResearchStore(db.sqlite);
    project = projects.createProject("Context", "context-project").project.id;
    const created = research.create(
      "local-owner",
      "local-owner",
      project,
      "Сравнить цены",
      "11111111-1111-4111-8111-111111111111",
      false
    );
    run = {
      ...created,
      status: "completed",
      updated_at: "2026-11-13T10:00:00Z"
    };
    db.sqlite
      .prepare("UPDATE research_v1_runs SET status=?, payload_json=? WHERE id=?")
      .run("completed", JSON.stringify(run), run.id);
    const dependencies = {
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      projectStore: projects,
      canvasStore: canvas,
      researchStore: research
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
    if (app) await app.close();
    if (foreign) await foreign.close();
    if (db) db.close();
  });

  const source = () => ({
    kind: "research" as const,
    id: run.id,
    version: 1,
    sha256: hash(researchMarkdown(run))
  });

  it("lists the completed report as a candidate of this project", async () => {
    const response = await get(base());
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: { kind: string; id: string; sha256: string }[] }>().items;
    const found = items.find((item) => item.kind === "research" && item.id === run.id);
    expect(found).toBeDefined();
    expect(found!.sha256).toBe(hash(researchMarkdown(run)));
  });

  it("produces a bounded text snapshot via the existing preview hook", async () => {
    const full = await post(`${base()}/preview`, {
      source: source(),
      selection: { kind: "full" }
    });
    expect(full.statusCode).toBe(200);
    const preview = full.json<{
      complete: boolean;
      total_units: number;
      selected_units: number;
      attachment: { name: string; content: string };
      attachment_sha256: string;
    }>();
    expect(preview.complete).toBe(true);
    expect(preview.selected_units).toBe(preview.total_units);
    expect(preview.attachment.name).toMatch(/^research-/);
    expect(preview.attachment.content).toContain("Kosmora source snapshot");
    expect(preview.attachment.content).toContain("Сравнить цены");
    expect(preview.attachment_sha256).toBe(hash(preview.attachment.content));

    const lines = await post(`${base()}/preview`, {
      source: source(),
      selection: { kind: "lines", from: 1, to: 2 }
    });
    expect(lines.statusCode).toBe(200);
    expect(lines.json<{ complete: boolean; selected_units: number }>()).toMatchObject({
      complete: false,
      selected_units: 2
    });
  });

  it("rejects a stale sha256 / version and an unfinished run", async () => {
    expect(
      (
        await post(`${base()}/preview`, {
          source: { ...source(), sha256: hash("stale") },
          selection: { kind: "full" }
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await post(`${base()}/preview`, {
          source: { ...source(), version: 2 },
          selection: { kind: "full" }
        })
      ).statusCode
    ).toBe(409);
    db.sqlite
      .prepare("UPDATE research_v1_runs SET status='reading', payload_json=? WHERE id=?")
      .run(JSON.stringify({ ...run, status: "reading" }), run.id);
    expect(
      (
        await post(`${base()}/preview`, {
          source: source(),
          selection: { kind: "full" }
        })
      ).statusCode
    ).toBe(404);
  });

  it("enforces owner and project isolation", async () => {
    const foreignList = await get(base(), foreign);
    expect(foreignList.statusCode).toBe(404);
    const foreignPreview = await post(
      base() + "/preview",
      { source: source(), selection: { kind: "full" } },
      foreign
    );
    expect(foreignPreview.statusCode).toBe(404);
    const otherProject = projects.createProject("Other", "other-project").project.id;
    const otherList = await get(`/api/v1/projects/${otherProject}/materials/artifacts`);
    expect(otherList.statusCode).toBe(200);
    expect(
      otherList.json<{ items: { kind: string }[] }>().items.some((i) => i.kind === "research")
    ).toBe(false);
  });

  it("does not break the existing hook when no research store is configured", async () => {
    const plain = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      projectStore: projects,
      canvasStore: canvas
    });
    try {
      const response = await plain.inject({ method: "GET", url: base() });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ items: unknown[] }>().items).toEqual([]);
    } finally {
      await plain.close();
    }
  });
});
