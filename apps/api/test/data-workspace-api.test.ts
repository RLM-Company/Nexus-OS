import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import { loadServerConfig } from "@cosmora/config";
import { CanvasArtifactStore, openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver, LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { canvasPrivacyAdapter } from "../src/canvas/canvas-privacy.js";

type Full = {
  artifact: { id: string; version: number };
  revision: { content: string; sha256: string };
};
let db: ReturnType<typeof openDatabase>,
  app: ReturnType<typeof buildApp>,
  foreign: ReturnType<typeof buildApp>,
  store: CanvasArtifactStore;
const base = "/api/v1/projects/p/tables";
const snapshot = (value = "5") =>
  JSON.stringify({
    schema: "kosmora.studio.data",
    version: 1,
    name: "fixture.csv",
    table: { delimiter: ",", headers: ["id", "value"], rows: [["A", value]] },
    settings: {
      types: ["text", "number"],
      columns: [0, 1],
      filters: [],
      sort: null,
      group: null,
      measure: 1,
      chart: { kind: "line", x: 0, y: 1 }
    }
  });
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
      owner_id: "foreign"
    })
  });
});
afterEach(async () => {
  await app.close();
  await foreign.close();
  db.close();
});
const create = async (content = snapshot()) => {
  const input = { client_id: randomUUID(), title: "Table", content };
  const response = await app.inject({ method: "POST", url: base, payload: input });
  expect(response.statusCode, response.body).toBe(201);
  return {
    input,
    value: response.json<Full>()
  };
};

it("creates once after a repeated request, isolates owners/types, validates snapshots and provides exact private downloads", async () => {
  const { input, value } = await create();
  const id = value.artifact.id;
  expect(
    (await app.inject({ method: "POST", url: base, payload: input })).json<Full>().artifact.id
  ).toBe(id);
  expect(db.sqlite.prepare("SELECT count(*) n FROM canvas_revisions").get()!.n).toBe(1);
  expect(
    (await app.inject({ method: "POST", url: base, payload: { ...input, content: snapshot("7") } }))
      .statusCode
  ).toBe(409);
  expect(
    (await app.inject({ method: "GET", url: "/api/v1/projects/p/canvas" })).json<{
      items: unknown[];
    }>().items
  ).toEqual([]);
  expect(
    (await app.inject({ method: "GET", url: base })).json<{ items: unknown[] }>().items
  ).toHaveLength(1);
  const download = await app.inject({ method: "GET", url: `${base}/${id}/download` });
  expect(download.body).toBe(input.content);
  expect(download.headers["cache-control"]).toBe("private, no-store");
  expect(download.headers["content-disposition"]).toContain("attachment");
  for (const suffix of ["", `/${id}`, `/${id}/revisions`, `/${id}/download`])
    expect((await foreign.inject({ method: "GET", url: base + suffix })).statusCode).toBe(404);
  expect((await foreign.inject({ method: "DELETE", url: `${base}/${id}` })).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: `/api/v1/projects/p/canvas/${id}`,
        payload: { baseVersion: 1, title: "Wrong editor", format: "text", content: "no" }
      })
    ).statusCode
  ).toBeGreaterThanOrEqual(400);
  const invalid = parseDataWorkspace(snapshot());
  invalid.settings.columns = [999];
  expect(
    (
      await app.inject({
        method: "POST",
        url: base,
        payload: { ...input, client_id: randomUUID(), content: JSON.stringify(invalid) }
      })
    ).statusCode
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: base,
        payload: { ...input, client_id: randomUUID(), content: snapshot("я".repeat(1_050_000)) }
      })
    ).statusCode
  ).toBe(413);
  expect(store.get("p", "local-owner", id)!.revision.content).toBe(input.content);
  const wrongType = await app.inject({
    method: "POST",
    url: "/api/v1/projects/p/canvas",
    payload: {
      client_request_id: id,
      title: "Table",
      format: "text",
      content: "wrong editor"
    }
  });
  expect(wrongType.statusCode).toBe(409);
  expect(store.get("p", "local-owner", id)!.revision.content).toBe(input.content);
});

it("uses optimistic versions, preserves immutable history and restores a new version", async () => {
  const { value } = await create();
  const url = `${base}/${value.artifact.id}`;
  const saved = await app.inject({
    method: "PUT",
    url,
    payload: { baseVersion: 1, title: "Updated", content: snapshot("7") }
  });
  expect(saved.statusCode).toBe(200);
  const stale = await app.inject({
    method: "PUT",
    url,
    payload: { baseVersion: 1, title: "Stale", content: snapshot("9") }
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json<{ error: { currentVersion: number } }>().error.currentVersion).toBe(2);
  const restored = await app.inject({
    method: "POST",
    url: url + "/restore",
    payload: { baseVersion: 2, sourceVersion: 1 }
  });
  expect(restored.statusCode).toBe(200);
  expect(restored.json<Full>().artifact.version).toBe(3);
  expect(restored.json<Full>().revision.content).toBe(snapshot());
  expect(
    (await app.inject({ method: "GET", url: url + "/revisions" }))
      .json<{ items: Array<{ version: number }> }>()
      .items.map((v) => v.version)
  ).toEqual([3, 2, 1]);
  expect(() =>
    db.sqlite
      .prepare("UPDATE canvas_revisions SET content='tampered' WHERE artifact_id=?")
      .run(value.artifact.id)
  ).toThrow("IMMUTABLE");
});

it("fences all writes and includes table bytes in the existing owner privacy lifecycle", async () => {
  const { value } = await create();
  const url = `${base}/${value.artifact.id}`;
  db.sqlite
    .prepare(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES ('local-owner','quiescing',1,'table-test','now','now')"
    )
    .run();
  for (const [method, path, payload] of [
    ["PUT", url, { baseVersion: 1, title: "T", content: snapshot("8") }],
    ["POST", url + "/restore", { baseVersion: 1, sourceVersion: 1 }],
    ["DELETE", url, undefined]
  ] as const)
    expect(
      (await app.inject({ method, url: path, ...(payload ? { payload } : {}) })).statusCode
    ).toBe(409);
  const privacy = canvasPrivacyAdapter(store);
  const exported = await privacy.export("local-owner");
  expect(JSON.stringify(exported.records)).toContain("fixture.csv");
  expect(JSON.stringify(exported.records)).toContain("data_workspace");
  db.sqlite
    .prepare(
      "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='local-owner'"
    )
    .run();
  expect((await privacy.delete("local-owner", 1)).deleted_records).toBe(2);
  expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
});

it("enforces a twenty-version ceiling and an atomic project history quota", async () => {
  const { value } = await create();
  let version = 1;
  for (; version < 20; version++)
    store.update("p", "local-owner", value.artifact.id, {
      baseVersion: version,
      title: "T",
      format: "code",
      content: snapshot(String(version)),
      source: { kind: "data_workspace" }
    });
  expect(() =>
    store.update("p", "local-owner", value.artifact.id, {
      baseVersion: 20,
      title: "T",
      format: "code",
      content: snapshot(),
      source: { kind: "data_workspace" }
    })
  ).toThrow("REVISION_LIMIT");
  let count = 0;
  while (count < 30) {
    try {
      store.create("p", "local-owner", {
        title: "Large",
        format: "code",
        content: snapshot("a".repeat(1_900_000)),
        source: { kind: "data_workspace" }
      });
      count++;
    } catch (error) {
      expect((error as Error).message).toBe("DATA_WORKSPACE_PROJECT_QUOTA");
      break;
    }
  }
  expect(count).toBe(17);
  expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
