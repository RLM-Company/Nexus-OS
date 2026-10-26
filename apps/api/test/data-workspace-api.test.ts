import { randomUUID, createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import { loadServerConfig } from "@cosmora/config";
import { CanvasArtifactStore, IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import {
  StaticIdentityResolver,
  BearerSessionIdentityResolver,
  LOCAL_DEVELOPMENT_IDENTITY
} from "../src/identity.js";
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
  vi.restoreAllMocks();
  await app.close();
  await foreign.close();
  db.close();
});

it("reads and downloads exact immutable versions with checked hashes, scope and version headers", async () => {
  const { value, input } = await create(snapshot("001\r\n=1+1 🚀 Ж"));
  const url = `${base}/${value.artifact.id}`;
  await app.inject({
    method: "PUT",
    url,
    payload: { baseVersion: 1, title: "new", content: snapshot("9") }
  });
  const read = await app.inject({ method: "GET", url: url + "/revisions/1" });
  expect(read.statusCode).toBe(200);
  expect(read.json<Full["revision"]>().content).toBe(input.content);
  const download = await app.inject({ method: "GET", url: url + "/revisions/1/download" });
  expect(download.statusCode).toBe(200);
  expect(download.rawPayload.equals(Buffer.from(input.content))).toBe(true);
  expect(download.headers["x-table-sha256"]).toBe(value.revision.sha256);
  expect(download.headers["x-table-version"]).toBe("1");
  expect(download.headers["content-disposition"]).toContain("v1.workspace.json");
  expect(download.headers["cache-control"]).toBe("private, no-store");
  expect(download.headers["x-content-type-options"]).toBe("nosniff");
  expect(download.headers["content-security-policy"]).toContain("sandbox");
  expect(store.history("p", "local-owner", value.artifact.id)).toHaveLength(2);
  for (const suffix of ["/revisions/1", "/revisions/1/download"]) {
    expect((await foreign.inject({ method: "GET", url: url + suffix })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: url.replace("/p/", "/other/") + suffix })).statusCode
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: url + suffix.replace("/1", "/999") })).statusCode
    ).toBe(400);
  }
  expect((await app.inject({ method: "GET", url: url + "/revisions/20" })).statusCode).toBe(404);
  expect((await app.inject({ method: "GET", url: url + "/revisions/0/download" })).statusCode).toBe(
    400
  );
  const text = store.create("p", "local-owner", {
    title: "text",
    format: "text",
    content: "secret"
  })!;
  expect(
    (await app.inject({ method: "GET", url: `${base}/${text.artifact.id}/revisions/1/download` }))
      .statusCode
  ).toBe(404);
});

it("rejects corrupted historical reads/downloads/restores without returning content or appending a version", async () => {
  const { value } = await create();
  const url = `${base}/${value.artifact.id}`;
  const original = store.getRevision.bind(store);
  vi.spyOn(store, "getRevision").mockImplementation((...args) => {
    const revision = original(...args);
    return revision ? { ...revision, content: "corrupted-secret" } : null;
  });
  for (const suffix of ["/revisions/1", "/revisions/1/download"]) {
    const result = await app.inject({ method: "GET", url: url + suffix });
    expect(result.statusCode).toBe(409);
    expect(result.body).not.toContain("corrupted-secret");
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: url + "/restore",
        payload: { baseVersion: 1, sourceVersion: 1 }
      })
    ).statusCode
  ).toBe(409);
  expect(store.history("p", "local-owner", value.artifact.id)).toHaveLength(1);
});

it("refuses corrupted current snapshots on both JSON reads and attachment downloads", async () => {
  const { value } = await create();
  const url = `${base}/${value.artifact.id}`;
  const original = store.get.bind(store);
  vi.spyOn(store, "get").mockImplementation((...args) => {
    const result = original(...args);
    return result
      ? { ...result, revision: { ...result.revision, content: "private-corrupted-snapshot" } }
      : null;
  });
  for (const suffix of ["", "/download"]) {
    const response = await app.inject({ method: "GET", url: url + suffix });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain("private-corrupted-snapshot");
  }
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

it("profiles and pages a pinned saved view without changing the table or history", async () => {
  const input = JSON.parse(snapshot()) as {
    table: { rows: string[][] };
    settings: { filters: unknown[]; sort: unknown; columns: number[] };
  };
  input.table.rows = [
    ["001", "1,5"],
    ["002", "2,5"],
    ["003", "bad"],
    ["002", "2,5"]
  ];
  input.settings.filters = [{ column: 1, operator: "greater", value: "2" }];
  input.settings.sort = { column: 1, direction: "desc" };
  const { value } = await create(JSON.stringify(input));
  const url = `${base}/${value.artifact.id}/revisions/1`;
  const analysis = await app.inject({ method: "GET", url: url + "/analysis" });
  expect(analysis.statusCode, analysis.body).toBe(200);
  expect(analysis.json()).toMatchObject({
    analyzed_rows: 2,
    source_rows: 4,
    duplicate_rows: 1,
    sampled: false
  });
  expect(analysis.headers["x-table-sha256"]).toBe(value.revision.sha256);
  expect(analysis.headers["cache-control"]).toBe("private, no-store");
  expect(analysis.headers["x-content-type-options"]).toBe("nosniff");
  const all = await app.inject({ method: "GET", url: url + "/analysis?scope=all" });
  expect(all.json()).toMatchObject({
    analyzed_rows: 4,
    columns: [{ numeric: null }, { numeric: { invalid: 1, sum: 6.5 } }]
  });
  const rows = await app.inject({ method: "GET", url: url + "/rows?limit=1&offset=1" });
  expect(rows.statusCode).toBe(200);
  expect(rows.json()).toMatchObject({
    total_rows: 2,
    next_offset: null,
    rows: [{ source_row: 4, cells: ["002", "2,5"] }]
  });
  await app.inject({
    method: "PUT",
    url: `${base}/${value.artifact.id}`,
    payload: { baseVersion: 1, title: "new", content: snapshot("99") }
  });
  expect((await app.inject({ method: "GET", url: url + "/analysis" })).json()).toEqual(
    analysis.json()
  );
  expect(store.history("p", "local-owner", value.artifact.id)).toHaveLength(2);
});

it("exports complete view data with formula-safe CSV, exact JSON and output checksums", async () => {
  const input = JSON.parse(snapshot()) as { table: { rows: string[][] } };
  input.table.rows = [
    ['=HYPERLINK("https://invalid")', "-2"],
    ["001", "3"]
  ];
  const { value } = await create(JSON.stringify(input));
  const url = `${base}/${value.artifact.id}/revisions/1/export`;
  const csv = await app.inject({ method: "GET", url: url + "?format=csv" });
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain("\"'=HYPERLINK(");
  expect(csv.body).toContain(',"-2"');
  expect(csv.headers["x-export-sha256"]).toBe(
    createHash("sha256").update(csv.rawPayload).digest("hex")
  );
  expect(csv.headers["content-disposition"]).toContain("v1-view.csv");
  const json = await app.inject({ method: "GET", url: url + "?format=json&scope=all" });
  expect(json.statusCode).toBe(200);
  expect(json.json()).toMatchObject({
    format: "kosmora.table-export.v1",
    rows: [{ cells: input.table.rows[0] }, { cells: input.table.rows[1] }]
  });
  expect(store.history("p", "local-owner", value.artifact.id)).toHaveLength(1);
});

it("keeps derived endpoints private and rejects corrupt revisions, bad queries and other artifact types", async () => {
  const { value } = await create();
  const url = `${base}/${value.artifact.id}/revisions/1`;
  for (const suffix of ["/analysis", "/rows", "/export?format=csv"]) {
    expect((await foreign.inject({ method: "GET", url: url + suffix })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: url.replace("/p/", "/other/") + suffix })).statusCode
    ).toBe(404);
  }
  for (const suffix of [
    "/analysis?scope=evil",
    "/rows?limit=501",
    "/rows?offset=-1",
    "/export?format=html",
    "/export"
  ]) {
    expect((await app.inject({ method: "GET", url: url + suffix })).statusCode).toBe(400);
  }
  const text = store.create("p", "local-owner", {
    title: "secret",
    format: "text",
    content: "private"
  })!;
  expect(
    (await app.inject({ method: "GET", url: `${base}/${text.artifact.id}/revisions/1/analysis` }))
      .statusCode
  ).toBe(404);
  const original = store.getRevision.bind(store);
  vi.spyOn(store, "getRevision").mockImplementation((...args) => {
    const revision = original(...args);
    return revision ? { ...revision, content: "corrupt-secret" } : null;
  });
  for (const suffix of ["/analysis", "/rows", "/export?format=json"]) {
    const result = await app.inject({ method: "GET", url: url + suffix });
    expect(result.statusCode).toBe(409);
    expect(result.body).not.toContain("corrupt-secret");
  }
});

it("requires a real owner session on every derived endpoint", async () => {
  const { value } = await create();
  const identities = new IdentityStore(db.sqlite);
  identities.registerActor("local-owner", "table-owner", "owner");
  const token = identities.issueSession({
    ownerId: "local-owner",
    actorId: "table-owner",
    assurance: "single_factor",
    ttlMs: 60000
  }).token;
  const secured = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    canvasStore: store,
    identityResolver: new BearerSessionIdentityResolver(identities)
  });
  try {
    const comparisonUrl = `${base}/${value.artifact.id}/compare`;
    const comparisonBody = { before_version: 1, after_version: 1, alignment: { kind: "position" } };
    expect(
      (await secured.inject({ method: "POST", url: comparisonUrl, payload: comparisonBody }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await secured.inject({
          method: "POST",
          url: comparisonUrl,
          payload: comparisonBody,
          headers: { authorization: `Bearer ${token}` }
        })
      ).statusCode
    ).toBe(200);
    for (const suffix of ["analysis", "rows", "export?format=json"]) {
      const url = `${base}/${value.artifact.id}/revisions/1/${suffix}`;
      expect((await secured.inject({ method: "GET", url })).statusCode).toBe(401);
      expect(
        (await secured.inject({ method: "GET", url, headers: { authorization: "Bearer forged" } }))
          .statusCode
      ).toBe(401);
      expect(
        (
          await secured.inject({
            method: "GET",
            url,
            headers: { authorization: `Bearer ${token}` }
          })
        ).statusCode
      ).toBe(200);
    }
  } finally {
    await secured.close();
  }
});

it("compares immutable table versions with explicit matching and provenance without writing new versions", async () => {
  const before = JSON.parse(snapshot()) as { table: { rows: string[][] } };
  before.table.rows = [
    ["001", "1"],
    ["002", "2"],
    ["003", "3"]
  ];
  const { value } = await create(JSON.stringify(before));
  const after = JSON.parse(snapshot()) as { table: { rows: string[][] } };
  after.table.rows = [
    ["003", "3"],
    ["002", "20"],
    ["004", "4"]
  ];
  const updated = store.update("p", "local-owner", value.artifact.id, {
    baseVersion: 1,
    title: "Updated",
    format: "code",
    content: JSON.stringify(after),
    source: { kind: "data_workspace" }
  })!;
  const url = `${base}/${value.artifact.id}/compare`;
  const payload = {
    before_version: 1,
    after_version: 2,
    alignment: { kind: "key", before_columns: [1], after_columns: [1] },
    limit: 1
  };
  const response = await app.inject({ method: "POST", url, payload });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({
    source: {
      table_id: value.artifact.id,
      before: { version: 1, sha256: value.revision.sha256 },
      after: { version: 2, sha256: updated.revision.sha256 }
    },
    scope: "all_original_rows",
    sampled: false,
    summary: {
      added_rows: 1,
      removed_rows: 1,
      changed_rows: 1,
      unchanged_rows: 1,
      moved_rows: 1,
      changed_cells: 1
    },
    detail: { total_changes: 3, returned_changes: 1, next_offset: 1, all_changes_included: false },
    changes: [{ kind: "removed", before_row: 1, after_row: null }]
  });
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.json<{ changes: unknown[] }>().changes[0]).not.toHaveProperty("before");
  const page = await app.inject({
    method: "POST",
    url,
    payload: { ...payload, offset: 1, include_values: true }
  });
  expect(page.json()).toMatchObject({
    changes: [{ kind: "changed", before: ["002", "2"], after: ["002", "20"] }],
    detail: { next_offset: 2 }
  });
  expect(store.history("p", "local-owner", value.artifact.id)).toHaveLength(2);
  for (const body of [
    { ...payload, after_version: 20 },
    { ...payload, before_version: 20 }
  ])
    expect((await app.inject({ method: "POST", url, payload: body })).statusCode).toBe(404);
  expect((await foreign.inject({ method: "POST", url, payload })).statusCode).toBe(404);
  expect(
    (await app.inject({ method: "POST", url: url.replace("/p/", "/other/"), payload })).statusCode
  ).toBe(404);
  for (const body of [
    { ...payload, owner_id: "forged" },
    { ...payload, limit: 201 },
    { ...payload, alignment: { kind: "key", before_columns: [0], after_columns: [1] } }
  ])
    expect((await app.inject({ method: "POST", url, payload: body })).statusCode).toBe(400);
  const original = store.getRevision.bind(store);
  vi.spyOn(store, "getRevision").mockImplementation((...args) => {
    const r = original(...args);
    return r && args[3] === 2 ? { ...r, content: "corrupt-private" } : r;
  });
  const corrupt = await app.inject({ method: "POST", url, payload });
  expect(corrupt.statusCode).toBe(409);
  expect(corrupt.body).not.toContain("corrupt-private");
});

it("refuses ambiguous keys and bounds large comparison responses without truncation", async () => {
  const before = JSON.parse(snapshot()) as { table: { rows: string[][] } };
  before.table.rows = [
    ["A", "one"],
    ["A", "two"]
  ];
  const { value } = await create(JSON.stringify(before));
  const url = `${base}/${value.artifact.id}/compare`;
  const payload = {
    before_version: 1,
    after_version: 1,
    alignment: { kind: "key", before_columns: [1], after_columns: [1] }
  };
  const ambiguous = await app.inject({ method: "POST", url, payload });
  expect(ambiguous.statusCode).toBe(422);
  expect(ambiguous.json()).toEqual({
    error: { code: "TABLE_COMPARE_DUPLICATE_KEY", side: "before", row: 2 }
  });
  const large = await create(snapshot("x".repeat(1_010_000)));
  store.update("p", "local-owner", large.value.artifact.id, {
    baseVersion: 1,
    title: "Large",
    format: "code",
    content: snapshot("y".repeat(1_010_000)),
    source: { kind: "data_workspace" }
  });
  const largeUrl = `${base}/${large.value.artifact.id}/compare`,
    body = { before_version: 1, after_version: 2, alignment: { kind: "position" } };
  expect(
    (
      await app.inject({
        method: "POST",
        url: largeUrl,
        payload: { ...body, include_values: true }
      })
    ).statusCode
  ).toBe(413);
  const compact = await app.inject({ method: "POST", url: largeUrl, payload: body });
  expect(compact.statusCode, compact.body).toBe(200);
  expect(compact.body.length).toBeLessThan(2000);
  expect(compact.json()).toMatchObject({
    summary: { changed_rows: 1, changed_cells: 1 },
    changes: [{ changed_columns: [2] }]
  });
});
