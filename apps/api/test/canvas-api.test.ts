import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { CanvasArtifactStore, openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver, LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";

describe("Canvas HTTP owner/auth/conflict/download", () => {
  let db: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;
  let foreign: ReturnType<typeof buildApp>;
  let store: CanvasArtifactStore;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES ('p','local-owner','T','ACTIVE','now','now')"
      )
      .run();
    store = new CanvasArtifactStore(db.sqlite);
    const config = loadServerConfig({ NODE_ENV: "test" });
    app = buildApp({ config, database: db, canvasStore: store });
    foreign = buildApp({
      config,
      database: db,
      canvasStore: store,
      identityResolver: new StaticIdentityResolver({
        ...LOCAL_DEVELOPMENT_IDENTITY,
        owner_id: "other-owner"
      })
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await foreign.close();
    db.close();
  });
  it("handles create/list/restore, 409 conflict and foreign owner 404", async () => {
    const base = "/api/v1/projects/p/canvas";
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: { title: "Note", format: "markdown", content: "hello" }
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ artifact: { id: string } }>().artifact.id;
    expect((await app.inject({ method: "GET", url: `${base}/${id}` })).statusCode).toBe(200);
    expect((await foreign.inject({ method: "GET", url: `${base}/${id}` })).statusCode).toBe(404);
    expect(
      (await foreign.inject({ method: "GET", url: `${base}/${id}/revisions/1` })).statusCode
    ).toBe(404);
    expect((await foreign.inject({ method: "GET", url: `${base}/sources` })).statusCode).toBe(404);
    expect((await foreign.inject({ method: "DELETE", url: `${base}/${id}` })).statusCode).toBe(404);
    const saved = await app.inject({
      method: "PUT",
      url: `${base}/${id}`,
      payload: { baseVersion: 1, title: "Note", format: "markdown", content: "second" }
    });
    expect(saved.statusCode).toBe(200);
    const stale = await app.inject({
      method: "PUT",
      url: `${base}/${id}`,
      payload: { baseVersion: 1, title: "Note", format: "markdown", content: "unsaved draft" }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { currentVersion: number } }>().error.currentVersion).toBe(2);
    const restored = await app.inject({
      method: "POST",
      url: `${base}/${id}/restore`,
      payload: { baseVersion: 2, sourceVersion: 1 }
    });
    expect(restored.json<{ artifact: { version: number } }>().artifact.version).toBe(3);
    const versions = await app.inject({ method: "GET", url: `${base}/${id}/revisions` });
    expect(versions.json<{ items: unknown[] }>().items).toHaveLength(3);
  });
  it("forces HTML to download as plain text and rejects oversized UTF-8", async () => {
    const base = "/api/v1/projects/p/canvas";
    const html = "<script>fetch('https://host.invalid')</script>";
    const result = await app.inject({
      method: "POST",
      url: base,
      payload: { title: "evil", format: "html", content: html }
    });
    expect(result.statusCode).toBe(201);
    const id = result.json<{ artifact: { id: string } }>().artifact.id;
    const response = await app.inject({ method: "GET", url: `${base}/${id}/download` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.body).toBe(html);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base,
          payload: { title: "t", format: "text", content: "🚀".repeat(150000) }
        })
      ).statusCode
    ).toBeGreaterThanOrEqual(400);
  });
  it("resolves authenticated owner scope and rejects foreign project scopes", async () => {
    const base = "/api/v1/projects/p/canvas";
    const response = await app.inject({ method: "GET", url: `${base}/scope` });
    expect(response.statusCode).toBe(200);
    const ownerScope = response.json<{ owner_scope: string }>().owner_scope;
    expect(ownerScope).toMatch(/^[a-f0-9]{64}$/);
    expect(ownerScope).not.toContain("local-owner");
    expect((await app.inject({ method: "GET", url: `${base}/scope` })).json()).toEqual(
      response.json()
    );
    expect((await foreign.inject({ method: "GET", url: `${base}/scope` })).statusCode).toBe(404);
  });
  it("downloads the exact historical version with its own title, format and checksum", async () => {
    const base = "/api/v1/projects/p/canvas";
    const content = "<script>unsafe()</script>\r\nТочная версия 🍋\n\n";
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: { title: "История/первая", format: "html", content }
    });
    const id = created.json<{ artifact: { id: string } }>().artifact.id;
    await app.inject({
      method: "PUT",
      url: `${base}/${id}`,
      payload: { title: "Current", format: "text", content: "new", baseVersion: 1 }
    });
    const response = await app.inject({ method: "GET", url: `${base}/${id}/revisions/1/download` });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from(content));
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-canvas-version"]).toBe("1");
    expect(response.headers["x-canvas-sha256"]).toBe(
      createHash("sha256").update(content).digest("hex")
    );
    expect(response.headers["content-disposition"]).toContain(
      encodeURIComponent("История_первая-v1.html")
    );
    const current = (await app.inject({ method: "GET", url: `${base}/${id}` })).json<{
      artifact: { version: number };
      revision: { content: string };
    }>();
    expect(current.artifact.version).toBe(2);
    expect(current.revision.content).toBe("new");
    for (const url of [
      `${base}/${id}/revisions/3/download`,
      `/api/v1/projects/other/canvas/${id}/revisions/1/download`
    ])
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    expect(
      (await foreign.inject({ method: "GET", url: `${base}/${id}/revisions/1/download` }))
        .statusCode
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `${base}/${id}/revisions/0/download` })).statusCode
    ).toBe(400);
  });
  it("rejects a corrupted historical download without returning its content", async () => {
    const base = "/api/v1/projects/p/canvas";
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: { title: "t", format: "text", content: "original" }
    });
    const id = created.json<{ artifact: { id: string } }>().artifact.id;
    const revision = store.getRevision("p", "local-owner", id, 1)!;
    vi.spyOn(store, "getRevision").mockReturnValue({
      ...revision,
      content: "corrupted-private-text"
    });
    const response = await app.inject({ method: "GET", url: `${base}/${id}/revisions/1/download` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "CANVAS_REVISION_CORRUPT" } });
    expect(response.body).not.toContain("corrupted-private-text");
  });
  it("returns a durable fence conflict for every editor mutation, including delete", async () => {
    const base = "/api/v1/projects/p/canvas";
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: { title: "Keep", format: "text", content: "original" }
    });
    const id = created.json<{ artifact: { id: string } }>().artifact.id;
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES ('local-owner','quiescing',1,'canvas-api-test','now','now')"
      )
      .run();
    for (const input of [
      {
        method: "POST" as const,
        url: base,
        payload: { title: "Late", format: "text", content: "late" }
      },
      {
        method: "PUT" as const,
        url: `${base}/${id}`,
        payload: { title: "Late", format: "text", content: "late", baseVersion: 1 }
      },
      {
        method: "POST" as const,
        url: `${base}/${id}/restore`,
        payload: { sourceVersion: 1, baseVersion: 1 }
      },
      { method: "DELETE" as const, url: `${base}/${id}` }
    ]) {
      const response = await app.inject(input);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: { code: "CANVAS_OWNER_FENCED" } });
    }
    const result = await app.inject({ method: "GET", url: `${base}/${id}` });
    expect(result.json<{ revision: { content: string } }>().revision.content).toBe("original");
  });
  it("creates once with a durable request ID and rejects reused IDs with changed payloads or scope", async () => {
    const base = "/api/v1/projects/p/canvas";
    const id = randomUUID();
    const payload = { client_request_id: id, title: "Canonical", format: "text", content: "exact" };
    const create = () => app.inject({ method: "POST", url: base, payload });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).json<{ artifact: { id: string } }>().artifact.id).toBe(id);
    expect(store.history("p", "local-owner", id)).toHaveLength(1);
    for (const change of [{ title: "Other" }, { format: "html" }, { content: "changed" }]) {
      const result = await app.inject({
        method: "POST",
        url: base,
        payload: { ...payload, ...change }
      });
      expect(result.statusCode).toBe(409);
      expect(result.json()).toEqual({ error: { code: "CANVAS_REQUEST_CONFLICT" } });
    }
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES ('q','local-owner','Q','ACTIVE','now','now')"
      )
      .run();
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/projects/q/canvas", payload })).statusCode
    ).toBe(409);
    expect(store.get("p", "local-owner", id)?.revision.content).toBe("exact");
    store.update("p", "local-owner", id, {
      title: "Canonical",
      format: "text",
      content: "newer",
      baseVersion: 1
    });
    expect((await create()).statusCode).toBe(409);
    expect(store.get("p", "local-owner", id)?.revision.content).toBe("newer");
  });
});
