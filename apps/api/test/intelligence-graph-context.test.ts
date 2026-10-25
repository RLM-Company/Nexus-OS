import { randomUUID, createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { IntelligenceGraphWorkspaceService, ManagerService } from "@cosmora/core";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  SqliteIntelligenceGraphWorkspaceRepository
} from "@cosmora/db";
import type {
  IntelligenceGraphContextPreview,
  IntelligenceGraphContextState,
  IntelligenceGraphSavedContextStatus,
  IntelligenceGraphModelContext
} from "@cosmora/contracts";
import { registerIntelligenceGraphWorkspaceRoutes } from "../src/intelligence-graph-workspace-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";
import { AccountCorePrivacyAdapter } from "../src/account-settings/privacy/account-core-adapter.js";
import { OwnerPrivacyCoordinator } from "../src/account-settings/privacy/coordinator.js";
import { intelligenceGraphPrivacyAdapter } from "../src/intelligence-graph-privacy.js";

type Preview = IntelligenceGraphContextPreview & { state: IntelligenceGraphContextState };
const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  projects.createEmptyProject("project-a", "Проект A", "owner-a");
  projects.createEmptyProject("project-b", "Проект B", "owner-b");
  db.sqlite.exec("UPDATE projects SET status='ACTIVE'");
  const repository = new SqliteIntelligenceGraphWorkspaceRepository(db.sqlite),
    service = new IntelligenceGraphWorkspaceService(repository);
  const input = {
    format: "kosmora.intelligence-graph.v1",
    title: "Источники",
    nodes: [
      { key: "s", kind: "Source", label: "Протокол", detail: "Цитата\r\nТочный источник" },
      { key: "a", kind: "Claim", label: "Тезис A", detail: "Позиция A" },
      { key: "b", kind: "Claim", label: "Тезис B", detail: "Позиция B" }
    ],
    edges: [
      {
        relation: "SUPPORTS",
        from: "a",
        to: "b",
        evidence: { source: "s", location: "строка 1", excerpt: "Цитата" }
      }
    ],
    conflicts: [{ subject: "s", positions: ["a", "b"], resolution: null }]
  };
  const content = service.previewImport(input),
    graph = service.importPackage("owner-a", "project-a", input, content.sha256);
  const makeApp = (owner = "owner-a", enabled = true) => {
    const app = Fastify();
    registerIntelligenceGraphWorkspaceRoutes(app, {
      enabled,
      service,
      projects,
      materials: projects,
      identity: new StaticIdentityResolver({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: owner })
    });
    return app;
  };
  const app = makeApp(),
    url = `/api/v1/projects/project-a/intelligence-graphs/${graph.graph_id}/context`;
  const preview = async () => {
    const r = await app.inject({ method: "GET", url: url + "?q=Тезис&revision=1" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    return r.json<Preview>();
  };
  const apply = (p: Preview, extra: object = {}) =>
    app.inject({
      method: "PUT",
      url,
      payload: {
        q: "Тезис",
        revision: 1,
        expected_sha256: p.sha256,
        expected_materials_version: p.state.materials_version,
        reviewed: true,
        ...extra
      }
    });
  const close = async () => {
    await app.close();
    db.sqlite.close();
  };
  return { db, projects, repository, service, graph, makeApp, app, url, preview, apply, close };
};

describe("reviewed project graph context integration", () => {
  it("discovers saved context without a query, detects revisions and refreshes only after review", async () => {
    const f = await setup();
    const status = async () => {
      const response = await f.app.inject({ method: "GET", url: f.url + "/status" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      return response.json<IntelligenceGraphSavedContextStatus>();
    };
    try {
      expect(await status()).toEqual({
        status: "missing",
        graph_revision: 1,
        materials_version: 0,
        current_sha256: null,
        saved: null
      });
      const p = await f.preview();
      expect((await f.apply(p)).statusCode).toBe(200);
      expect(await status()).toEqual({
        status: "current",
        graph_revision: 1,
        materials_version: 1,
        current_sha256: p.sha256,
        saved: { revision: 1, query: "Тезис" }
      });
      const run = f.projects.createMessage("project-a", "Со снимком", randomUUID(), "owner-a")!;
      f.service.edit("owner-a", "project-a", f.graph.graph_id, 1, {
        kind: "rename",
        title: "Новое имя"
      });
      expect(await status()).toMatchObject({
        status: "stale",
        graph_revision: 2,
        saved: { revision: 1 }
      });
      // Viewing/preparing the new revision never changes stored materials or queued runs.
      const response = await f.app.inject({ method: "GET", url: f.url + "?q=Тезис&revision=2" });
      const next = response.json<Preview>();
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(1);
      expect((await f.apply(next, { revision: 2 })).statusCode).toBe(200);
      expect(await status()).toMatchObject({
        status: "current",
        graph_revision: 2,
        saved: { revision: 2 }
      });
      expect(f.projects.getMaterialsForRun(run.run.id, "owner-a")!.attachments).toEqual([
        p.attachment
      ]);
      // A restore creates a new revision; matching text alone does not make an old snapshot current.
      f.service.restore("owner-a", "project-a", f.graph.graph_id, 2, 1);
      expect(await status()).toMatchObject({ status: "stale", graph_revision: 3 });
      const current = f.projects.getMaterials("project-a", "owner-a")!;
      expect(
        (
          await f.app.inject({
            method: "DELETE",
            url: f.url,
            payload: {
              expected_sha256: next.sha256,
              expected_materials_version: current.version
            }
          })
        ).statusCode
      ).toBe(200);
      expect(await status()).toMatchObject({
        status: "missing",
        graph_revision: 3,
        materials_version: 3
      });
    } finally {
      await f.close();
    }
  });
  it.each(["broken-json", "fake-header", "changed-text", "wrong-graph", "future-revision"])(
    "does not certify a filename collision or altered snapshot: %s",
    async (kind) => {
      const f = await setup();
      try {
        const p = await f.preview();
        const content = JSON.parse(p.attachment.content) as IntelligenceGraphModelContext;
        if (kind === "changed-text") content.nodes[0]!.detail = "Подменённый текст";
        if (kind === "wrong-graph") content.graph.id = "another-graph";
        if (kind === "future-revision") content.graph.revision = 999;
        const attachment = {
          ...p.attachment,
          content:
            kind === "broken-json"
              ? "{"
              : kind === "fake-header"
                ? JSON.stringify({
                    format: content.format,
                    graph: content.graph,
                    query: content.query
                  })
                : JSON.stringify(content)
        };
        f.projects.setMaterials("project-a", "owner-a", {
          version: 0,
          instructions: "Keep",
          attachments: [attachment]
        });
        const before = f.projects.getMaterials("project-a", "owner-a");
        const response = await f.app.inject({ method: "GET", url: f.url + "/status" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          status: "unrecognized",
          saved: null,
          materials_version: 1
        });
        expect(f.projects.getMaterials("project-a", "owner-a")).toEqual(before);
        expect(f.db.sqlite.prepare("SELECT * FROM runs").all()).toHaveLength(0);
      } finally {
        await f.close();
      }
    }
  );
  it("does not disguise repository failures as an unrecognized snapshot", async () => {
    const f = await setup();
    try {
      await f.apply(await f.preview());
      const spy = vi.spyOn(f.service, "context").mockImplementation(() => {
        throw new Error("storage unavailable");
      });
      const response = await f.app.inject({ method: "GET", url: f.url + "/status" });
      expect(response.statusCode).toBe(500);
      spy.mockRestore();
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("returns an explicit empty-evidence result without persisting an empty context", async () => {
    const f = await setup();
    try {
      const result = await f.app.inject({ method: "GET", url: f.url + "?q=Крокозябра&revision=1" });
      expect(result.statusCode).toBe(422);
      expect(result.json<{ error: string }>().error).toBe("GRAPH_CONTEXT_EMPTY");
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(0);
    } finally {
      await f.close();
    }
  });
  it("previews without writes, requires exact hash/review and retains other project materials", async () => {
    const f = await setup();
    try {
      f.projects.setMaterials("project-a", "owner-a", {
        version: 0,
        instructions: "Существующие требования",
        attachments: [{ name: "existing.txt", content: "Keep exact" }]
      });
      const p = await f.preview();
      expect(p.state).toMatchObject({
        materials_version: 1,
        already_applied: false,
        can_apply: true,
        retained_files: ["existing.txt"]
      });
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(1);
      expect((await f.apply(p, { reviewed: false })).statusCode).toBe(400);
      expect((await f.apply(p, { owner_id: "owner-b" })).statusCode).toBe(400);
      expect((await f.apply(p, { expected_sha256: "0".repeat(64) })).statusCode).toBe(400);
      const applied = await f.apply(p);
      expect(applied.statusCode).toBe(200);
      const saved = f.projects.getMaterials("project-a", "owner-a")!;
      expect(saved.version).toBe(2);
      expect(saved.instructions).toBe("Существующие требования");
      expect(saved.attachments).toEqual([
        { name: "existing.txt", content: "Keep exact" },
        p.attachment
      ]);
      expect(f.db.sqlite.prepare("SELECT * FROM runs").all()).toHaveLength(0);
      expect(f.service.get("owner-a", "project-a", f.graph.graph_id)).toEqual(f.graph);
    } finally {
      await f.close();
    }
  });
  it("pins future run materials through graph changes and removal, without changing earlier queued runs", async () => {
    const f = await setup();
    try {
      const before = f.projects.createMessage(
        "project-a",
        "До контекста",
        randomUUID(),
        "owner-a"
      )!;
      const p = await f.preview();
      expect((await f.apply(p)).statusCode).toBe(200);
      const after = f.projects.createMessage(
        "project-a",
        "Разбери позиции",
        randomUUID(),
        "owner-a"
      )!;
      expect(f.projects.getMaterialsForRun(before.run.id, "owner-a")!.attachments).toEqual([]);
      expect(f.projects.getMaterialsForRun(after.run.id, "owner-a")!.attachments).toEqual([
        p.attachment
      ]);
      f.service.edit("owner-a", "project-a", f.graph.graph_id, 1, {
        kind: "revise_node",
        node: { id: f.graph.nodes[0]!.node_id, version: 1 },
        label: "Новый протокол",
        detail: "Новый текст"
      });
      expect((await f.preview()).sha256).toBe(p.sha256);
      const latest = await f.app.inject({ method: "GET", url: f.url + "?q=Тезис&revision=2" });
      expect(latest.statusCode).toBe(200);
      const latestBody = JSON.parse(
        latest.json<Preview>().attachment.content
      ) as IntelligenceGraphModelContext;
      expect(latestBody.graph.revision).toBe(2);
      expect(latestBody.stale_conflict_ids).toHaveLength(1);
      expect(latestBody.edges[0]!.source).toMatchObject({ quote: "Цитата", status: "superseded" });

      const manager = new ManagerService({
        preferredProvider: "mock",
        preferredModelAlias: "mock-fast",
        fallbackAllowed: false
      });
      const request = manager.buildRequest({
        projectId: "project-a",
        runId: after.run.id,
        messages: f.projects.listMessages("project-a", "owner-a"),
        materials: f.projects.getMaterialsForRun(after.run.id, "owner-a")
      });
      expect(
        request.messages
          .filter((m) => m.role === "system")
          .some((m) => m.content.includes("graph-context"))
      ).toBe(false);
      expect(
        request.messages.some(
          (m) =>
            m.role === "user" &&
            m.content.includes(p.attachment.name) &&
            m.content.includes("Цитата")
        )
      ).toBe(true);
      const state = (await f.preview()).state;
      const removed = await f.app.inject({
        method: "DELETE",
        url: f.url,
        payload: { expected_sha256: p.sha256, expected_materials_version: state.materials_version }
      });
      expect(removed.statusCode).toBe(200);
      const later = f.projects.createMessage(
        "project-a",
        "После удаления",
        randomUUID(),
        "owner-a"
      )!;
      expect(f.projects.getMaterialsForRun(later.run.id, "owner-a")!.attachments).toEqual([]);
      expect(f.projects.getMaterialsForRun(after.run.id, "owner-a")!.attachments).toEqual([
        p.attachment
      ]);
    } finally {
      await f.close();
    }
  });
  it("recovers a lost write response by GET without a duplicate attachment or repeated version change", async () => {
    const f = await setup();
    try {
      const p = await f.preview();
      await f.apply(p);
      const recovered = await f.preview();
      expect(recovered.state.already_applied).toBe(true);
      expect(recovered.state.materials_version).toBe(1);
      expect((await f.apply(p)).statusCode).toBe(409);
      expect((await f.apply(recovered)).statusCode).toBe(200);
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(1);
      expect(f.projects.getMaterials("project-a", "owner-a")!.attachments).toEqual([p.attachment]);
    } finally {
      await f.close();
    }
  });
  it("rejects concurrent materials updates and stale removal without overwriting the newer file", async () => {
    const f = await setup();
    try {
      const p = await f.preview();
      f.projects.setMaterials("project-a", "owner-a", {
        version: 0,
        instructions: "Changed concurrently",
        attachments: []
      });
      expect((await f.apply(p)).statusCode).toBe(409);
      const latest = await f.preview();
      expect((await f.apply(latest)).statusCode).toBe(200);
      const current = f.projects.getMaterials("project-a", "owner-a")!;
      f.projects.setMaterials("project-a", "owner-a", {
        version: current.version,
        instructions: current.instructions,
        attachments: [{ ...p.attachment, content: "Other reviewed text" }]
      });
      const remove = await f.app.inject({
        method: "DELETE",
        url: f.url,
        payload: { expected_sha256: p.sha256, expected_materials_version: current.version }
      });
      expect(remove.statusCode).toBe(409);
      expect(f.projects.getMaterials("project-a", "owner-a")!.attachments[0]!.content).toBe(
        "Other reviewed text"
      );
    } finally {
      await f.close();
    }
  });
  it("preserves all files and instructions when the file count or total UTF-8 budget cannot fit", async () => {
    const f = await setup();
    try {
      f.projects.setMaterials("project-a", "owner-a", {
        version: 0,
        instructions: "Keep",
        attachments: Array.from({ length: 4 }, (_, i) => ({ name: `keep${i}.txt`, content: "A" }))
      });
      let p = await f.preview();
      expect(p.state.can_apply).toBe(false);
      expect((await f.apply(p)).statusCode).toBe(413);
      f.projects.setMaterials("project-a", "owner-a", {
        version: 1,
        instructions: "я".repeat(4000),
        attachments: [
          { name: "one.txt", content: "я".repeat(4000) },
          { name: "two.txt", content: "я".repeat(4000) }
        ]
      });
      p = await f.preview();
      expect(p.state.can_apply).toBe(false);
      expect((await f.apply(p)).statusCode).toBe(413);
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(2);
    } finally {
      await f.close();
    }
  });
  it("enforces owner/project/feature boundaries on every context route", async () => {
    const f = await setup(),
      foreign = f.makeApp("owner-b"),
      disabled = f.makeApp("owner-a", false);
    try {
      const p = await f.preview();
      for (const app of [foreign, disabled]) {
        expect((await app.inject({ method: "GET", url: f.url + "/status" })).statusCode).toBe(404);
        expect(
          (await app.inject({ method: "GET", url: f.url + "?q=Тезис&revision=1" })).statusCode
        ).toBe(404);
        expect(
          (
            await app.inject({
              method: "PUT",
              url: f.url,
              payload: {
                q: "Тезис",
                revision: 1,
                expected_sha256: p.sha256,
                expected_materials_version: 0,
                reviewed: true
              }
            })
          ).statusCode
        ).toBe(404);
        expect(
          (
            await app.inject({
              method: "DELETE",
              url: f.url,
              payload: { expected_sha256: p.sha256, expected_materials_version: 0 }
            })
          ).statusCode
        ).toBe(404);
      }
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: f.url.replace("project-a", "project-b") + "?q=Тезис&revision=1"
          })
        ).statusCode
      ).toBe(404);
      expect((await f.app.inject({ method: "GET", url: f.url + "?q=Тезис" })).statusCode).toBe(400);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: f.url.replace("project-a", "project-b") + "/status"
          })
        ).statusCode
      ).toBe(404);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: f.url.replace(f.graph.graph_id, "missing") + "/status"
          })
        ).statusCode
      ).toBe(404);
    } finally {
      await foreign.close();
      await disabled.close();
      await f.close();
    }
  });
  it("honors the durable account privacy fence for apply and remove", async () => {
    const f = await setup();
    try {
      const p = await f.preview();
      expect((await f.apply(p)).statusCode).toBe(200);
      const now = new Date().toISOString();
      f.db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'quiescing','test',?,?)"
        )
        .run("owner-a", now, now);
      const alternate = await f.app.inject({
        method: "GET",
        url: f.url + "?q=Тезис%20A&revision=1"
      });
      const alternatePreview = alternate.json<Preview>();
      const apply = await f.apply(alternatePreview, { q: "Тезис A" });
      expect(apply.statusCode).toBe(423);
      const remove = await f.app.inject({
        method: "DELETE",
        url: f.url,
        payload: { expected_sha256: p.sha256, expected_materials_version: 1 }
      });
      expect(remove.statusCode).toBe(423);
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("includes saved context and queued snapshots in owner export/delete through existing adapters", async () => {
    const f = await setup();
    try {
      const p = await f.preview();
      await f.apply(p);
      f.projects.createMessage("project-a", "Снимок", randomUUID(), "owner-a");
      const privacy = new OwnerPrivacyCoordinator(f.db.sqlite, {
        required: ["account-core", "intelligence-graphs"]
      });
      privacy.register(new AccountCorePrivacyAdapter(f.db.sqlite, () => Promise.resolve()));
      privacy.register(intelligenceGraphPrivacyAdapter(f.repository));
      const exported = await privacy.export("owner-a");
      expect(JSON.stringify(exported)).toContain(p.attachment.name);
      expect(JSON.stringify(exported)).toContain("project_materials_json");
      const token = "test-confirmation-token-graph-context";
      f.db.sqlite
        .prepare(
          "INSERT INTO kosmora_data_delete_challenges(owner_id,digest,expires_at) VALUES(?,?,?)"
        )
        .run(
          "owner-a",
          createHash("sha256").update(token).digest("hex"),
          new Date(Date.now() + 60000).toISOString()
        );
      const deleted = await privacy.delete("owner-a", token, "УДАЛИТЬ МОИ ДАННЫЕ");
      expect(deleted.deleted).toBe(true);
      expect(f.projects.getMaterials("project-a", "owner-a")).toBeNull();
      expect(f.db.sqlite.prepare("SELECT * FROM project_materials").all()).toEqual([]);
      expect(f.db.sqlite.prepare("SELECT * FROM runs").all()).toEqual([]);
      expect(f.projects.getProject("project-b", "owner-b")).not.toBeNull();
    } finally {
      await f.close();
    }
  });
});
