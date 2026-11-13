import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { GeneralChatStore, openDatabase, runMigrations } from "@cosmora/db";
import { loadServerConfig } from "@cosmora/config";
import { buildApp } from "../src/app.js";
import { configuredGoogleDrive } from "../src/cloud-storage/google-drive-runtime.js";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import { selectionHash } from "../src/cloud-storage/google-drive-bundle-store.js";
import {
  SNAPSHOT_MAX_BYTES,
  captureSnapshot,
  parseSnapshot,
  readSnapshotPart,
  snapshotHash,
  snapshotPart
} from "../src/cloud-storage/google-drive-snapshot.js";
import { DrivePayloadCipher } from "../src/cloud-storage/google-drive-payload-cipher.js";
import { googleDrivePrivacyAdapter } from "../src/cloud-storage/google-drive-privacy.js";
import { OwnerPrivacyCoordinator } from "../src/account-settings/privacy/coordinator.js";
import { createArchive } from "../src/account-settings/privacy/archive.js";

const { buildOfficeDocument } = createRequire(import.meta.url)(
  "../../../desktop/windows/workspace/office-document.cjs"
) as { buildOfficeDocument: (action: unknown) => { buffer: Buffer } };

const owner = "local-owner",
  origin = "https://kosmora.example",
  base = "/api/v1/storage/drive";
const env = {
  KOSMORA_DRIVE_ENABLED: "1",
  KOSMORA_DRIVE_CLIENT_ID: "fixture.apps.googleusercontent.com",
  KOSMORA_DRIVE_CLIENT_SECRET: "fixture-client-secret",
  KOSMORA_DRIVE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64")
};
type View = {
  id: string;
  state: string;
  parts: number;
  saved_parts: number;
  preview: { chats: number; files: number };
};
type Sources = {
  chats: { id: string; title: string; mode: string }[];
  files: {
    id: string;
    name: string;
    project: string;
    version: number;
    bytes: number;
    sha256: string | null;
    kind: "kosmora" | "user";
  }[];
};
class GoogleFixture {
  files = new Map<string, { metadata: object; bytes: Buffer }>();
  folders = new Map<string, object>();
  uploads = 0;
  ids = 0;
  failUpload = 0;
  failBeforeUpload = 0;
  methods: string[] = [];
  urls: string[] = [];
  request = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    const json = (v: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    this.methods.push(init?.method ?? "GET");
    this.urls.push(url.href);
    if (url.pathname.endsWith("generateIds")) return json({ ids: [`google_file_${++this.ids}`] });
    if (init?.method === "POST" && url.pathname === "/drive/v3/files") {
      const m = JSON.parse(init.body as string) as { id: string };
      this.folders.set(m.id, { ...m, trashed: false });
      return json({ id: m.id });
    }
    if (init?.method === "POST") {
      this.uploads++;
      if (this.uploads === this.failBeforeUpload)
        return Promise.reject(Error("upload interrupted"));
      const b = Buffer.from(init.body as Uint8Array),
        doubleCrlf = Buffer.from([13, 10, 13, 10]),
        boundaryMark = Buffer.from([13, 10, 45, 45]),
        start = b.indexOf(doubleCrlf) + 4,
        end = b.indexOf(boundaryMark, start);
      const m = JSON.parse(b.subarray(start, end).toString()) as { id: string };
      if (this.files.has(m.id)) return json({}, 409);
      const marker = Buffer.concat([Buffer.from("Content-Type: application/zip"), doubleCrlf]),
        markerAt = b.indexOf(marker),
        bytes = Buffer.from(b.subarray(markerAt + marker.length, b.lastIndexOf(boundaryMark)));
      this.files.set(m.id, {
        metadata: { ...m, size: String(bytes.length), trashed: false },
        bytes
      });
      if (this.uploads === this.failUpload) return Promise.reject(Error("lost ACK"));
      return json({ id: m.id });
    }
    const id = url.pathname.split("/").at(-1)!,
      folder = this.folders.get(id),
      file = this.files.get(id);
    if (folder) return json(folder);
    if (!file) return json({}, 404);
    return url.searchParams.get("alt") === "media"
      ? Promise.resolve(new Response(new Uint8Array(file.bytes)))
      : json(file.metadata);
  });
}
describe("complete Drive snapshots and restore", () => {
  it("writes a standard ZIP CRC32 known vector", () => {
    const bytes = createArchive([{ path: "check.txt", bytes: Buffer.from("123456789") }], 1024);
    expect(bytes.readUInt32LE(14)).toBe(0xcbf43926);
  });
  let db: ReturnType<typeof openDatabase>,
    runtime: ReturnType<typeof configuredGoogleDrive>,
    google: GoogleFixture;
  let app: ReturnType<typeof buildApp>, chatId: string;
  const build = () =>
    buildApp({
      config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
      database: db,
      googleDrive: runtime
    });
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    google = new GoogleFixture();
    runtime = configuredGoogleDrive(db.sqlite, origin, env, google.request);
    runtime.store.connect(
      runtime.store.beginConnect(owner),
      {
        accessToken: "fixture-access",
        refreshToken: "fixture-refresh",
        scope: DRIVE_FILE_SCOPE,
        expiresAt: Date.now() + 3600000
      },
      "folder_seed"
    );
    await runtime.connection!.check(owner);
    const chats = new GeneralChatStore(db.sqlite);
    const source = chats.createChat(
      "original message",
      randomUUID(),
      owner,
      [{ name: "notes.md", content: "attachment text" }],
      "work"
    );
    chats.cancelRun(source.run.id);
    chatId = source.chat.id;
    const other = chats.createChat("other owner secret", randomUUID(), "other-owner");
    chats.cancelRun(other.run.id);
    const t = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO projects(id,owner_id,title,status,created_at,updated_at)
         VALUES('source-project',?,'Original project','active',?,?)`
      )
      .run(owner, t, t);
    db.sqlite
      .prepare(
        `INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json)
         VALUES('source-work','source-project',?,'source',1,?)`
      )
      .run(owner, JSON.stringify({ status: "completed" }));
    const content = "<script>not executed</script>";
    db.sqlite
      .prepare(
        `INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at)
         VALUES('artifact','source-project','source-work','report.html',1,?,?,?,1,?)`
      )
      .run(content, snapshotHash(Buffer.from(content)), Buffer.byteLength(content), t);
    app = build();
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  const post = (path: string, payload: object = {}) =>
    app.inject({ method: "POST", url: base + path, payload, headers: { origin } });
  const get = (path: string) => app.inject({ url: base + path });
  const loadSources = async () => {
    const r = await get("/sources");
    expect(r.statusCode, r.body).toBe(200);
    return r.json<Sources>();
  };
  const save = async (extra: object = {}, operation = randomUUID()) => {
    const r = await post("/backups", { operation_id: operation, include_results: true, ...extra });
    expect(r.statusCode, r.body).toBe(200);
    return r.json<View>();
  };
  const preview = async (id: string) => {
    const r = await post(`/backups/${id}/preview`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<{ token: string; chats: number; messages: number; files: number }>();
  };
  const insertLegacy = () => {
    db.sqlite
      .prepare(
        `INSERT INTO manager_work_files(execution_id,name,content)
         VALUES('source-work','report.html','legacy duplicate')`
      )
      .run();
    db.sqlite
      .prepare(
        `INSERT INTO manager_work_files(execution_id,name,content)
         VALUES('source-work','legacy.txt','legacy result')`
      )
      .run();
  };

  it.each(["before upload", "after upload"] as const)(
    "retries the same Office backup after a connection failure %s",
    async (failure) => {
      if (failure === "before upload") google.failBeforeUpload = 1;
      else google.failUpload = 1;
      const original = buildOfficeDocument({
        kind: "workspace_create_docx",
        path: "Отчёт.docx",
        title: "Отчёт",
        sections: [{ heading: "Вывод", text: "Проверенная копия" }]
      }).buffer;
      const request = {
        operation_id: randomUUID(),
        chat_ids: [],
        include_results: false,
        office_file: { name: "Отчёт.docx", bytes: original.toString("base64") }
      };
      const interrupted = await post("/backups", request);
      expect(interrupted.statusCode).toBe(502);
      const before = await get("/backups");
      const [existing] = before.json<{ items: View[] }>().items;
      expect(existing?.state).toBe("uncertain");
      expect(google.files.size).toBe(failure === "before upload" ? 0 : 1);
      const reservedIds = google.ids;

      await app.close();
      app = build();
      if (failure === "before upload") {
        const replay = await post("/backups", request);
        expect(replay.statusCode).toBe(502);
        expect(google.uploads).toBe(1);
      }
      const retried = await post("/backups", { ...request, retry_upload: true });
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json()).toMatchObject({ id: existing!.id, state: "verified" });
      expect(google.ids).toBe(reservedIds);
      expect(google.files.size).toBe(1);
      const p = await preview(existing!.id);
      const restored = await post(`/backups/${existing!.id}/restore`, {
        token: p.token,
        operation_id: randomUUID()
      });
      expect(restored.statusCode, restored.body).toBe(200);
      const [file] = restored.json<{ files: { id: string }[] }>().files;
      expect((await get(`/restored-files/${file!.id}`)).rawPayload).toEqual(original);
    }
  );

  it("backs up Office bytes exactly, replays a save and keeps two revisions independently restorable", async () => {
    const name = "О".repeat(175) + ".koswork.docx";
    const document = (revision: number) =>
      buildOfficeDocument({
        kind: "workspace_create_docx",
        path: "Отчёт.docx",
        title: "Отчёт",
        sections: [{ heading: "Источник", text: `v${revision} https://example.org/source` }]
      }).buffer;
    const first = document(1),
      second = document(2);
    const selection = (bytes: Buffer) => ({
      chat_ids: [],
      include_results: false,
      office_file: { name, bytes: bytes.toString("base64") }
    });
    const operation = randomUUID();
    const initial = await save(selection(first), operation);
    expect((await save(selection(first), operation)).id).toBe(initial.id);
    const conflict = await post("/backups", { ...selection(second), operation_id: operation });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "DRIVE_OPERATION_CONFLICT" } });
    expect(google.uploads).toBe(1);
    const malformed = await post("/backups", {
      ...selection(Buffer.from("not an office package")),
      operation_id: randomUUID()
    });
    expect(malformed.statusCode).toBe(400);
    expect(google.uploads).toBe(1);
    const newer = await save(selection(second));
    expect(newer.id).not.toBe(initial.id);

    await app.close();
    app = build();
    for (const [backup, original] of [
      [newer, second],
      [initial, first]
    ] as const) {
      const p = await preview(backup.id);
      expect(p).toMatchObject({ chats: 0, files: 1 });
      const restore = { token: p.token, operation_id: randomUUID() };
      const result = await post(`/backups/${backup.id}/restore`, restore);
      expect(result.statusCode, result.body).toBe(200);
      const saved = result.json<{ files: { id: string; name: string }[] }>();
      expect(saved.files[0]?.name).toBe(name);
      const downloaded = await get(`/restored-files/${saved.files[0]!.id}`);
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.rawPayload).toEqual(original);
      const office = await get(`/restored-files/${saved.files[0]!.id}/office`);
      expect(office.statusCode, office.body).toBe(200);
      expect(office.json()).toEqual({
        name,
        bytes: original.toString("base64"),
        version: "sha256:" + snapshotHash(original)
      });
      expect(runtime.bundleStore.file("other-owner", saved.files[0]!.id)).toBeUndefined();
      expect((await post(`/backups/${backup.id}/restore`, restore)).json()).toEqual(saved);
    }
    expect(google.uploads).toBe(2);
  });

  it("saves chat text/attachments/results and restores new objects atomically without recreating jobs", async () => {
    const operation = randomUUID(),
      item = await save({}, operation);
    expect(item).toMatchObject({
      state: "verified",
      saved_parts: 1,
      preview: { chats: 1, files: 1 }
    });
    expect((await save({}, operation)).id).toBe(item.id);
    expect(google.uploads).toBe(1);
    expect(db.sqlite.prepare("SELECT payload FROM drive_snapshots").get()).toMatchObject({
      payload: null
    });
    const p = await preview(item.id);
    expect(p).toMatchObject({ chats: 1, messages: 2, files: 1 });
    const before = db.sqlite.prepare("SELECT count(*) AS n FROM general_chat_runs").get();
    const op = randomUUID(),
      r = await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: op });
    expect(r.statusCode, r.body).toBe(200);
    const result = r.json<{ id: string; chats: { id: string }[]; files: { id: string }[] }>();
    expect(result.chats[0]?.id).not.toBe(chatId);
    const m = db.sqlite
      .prepare("SELECT content,attachments_json,run_id FROM general_chat_messages WHERE chat_id=?")
      .get(result.chats[0]!.id);
    expect(m).toMatchObject({ content: "original message", run_id: null });
    expect(m?.attachments_json).toContain("attachment text");
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM general_chat_runs").get()).toEqual(before);
    expect(
      db.sqlite.prepare("SELECT content FROM general_chat_messages WHERE chat_id=?").get(chatId)
    ).toMatchObject({ content: "original message" });
    const download = await app.inject({ url: `${base}/restored-files/${result.files[0]!.id}` });
    expect(download.body).toBe("<script>not executed</script>");
    expect(download.headers["content-type"]).toContain("application/octet-stream");
    expect(download.headers["content-disposition"]).toContain("attachment;");
    expect((await get(`/restored-files/${result.files[0]!.id}/office`)).statusCode).toBe(404);
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: op })).json()
    ).toEqual(result);
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: randomUUID() }))
        .statusCode
    ).toBe(409);
    expect(
      db.sqlite.prepare("SELECT count(*) AS n FROM general_chats WHERE owner_id=?").get(owner)
    ).toMatchObject({ n: 2 });
    const reopened = await preview(item.id);
    expect(reopened.token).not.toBe(p.token);
    const recovered = await post(`/backups/${item.id}/restore`, {
      token: reopened.token,
      operation_id: op
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json()).toEqual(result);
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM drive_restored_files").get()).toMatchObject(
      {
        n: 1
      }
    );
    const normal = new GeneralChatStore(db.sqlite);
    expect(normal.getChat(result.chats[0]!.id, owner)?.mode).toBe("work");
    const next = normal.createMessage(
      result.chats[0]!.id,
      "continue restored conversation",
      randomUUID(),
      owner
    );
    expect(next).not.toBeNull();
    normal.cancelRun(next!.run.id);
  });

  it("rejects foreign selections and never uploads another owner content", async () => {
    const other = db.sqlite
      .prepare("SELECT id FROM general_chats WHERE owner_id=?")
      .get("other-owner") as { id: string };
    expect(
      (
        await post("/backups", {
          operation_id: randomUUID(),
          include_results: false,
          chat_ids: [other.id]
        })
      ).statusCode
    ).toBe(400);
    expect(google.uploads).toBe(0);
    const item = await save({ chat_ids: [], include_results: true });
    expect(item.preview).toMatchObject({ chats: 0, files: 1 });
  });

  it("includes completed legacy Work files without duplicating published versions", async () => {
    insertLegacy();
    const list = await loadSources();
    expect(list.files.filter((f) => f.name === "report.html")).toHaveLength(1);
    expect(list.files.find((f) => f.name === "legacy.txt")?.kind).toBe("user");
    const item = await save({ chat_ids: [], include_results: true });
    expect(item.preview.files).toBe(2);
    const p = await preview(item.id),
      r = await post(`/backups/${item.id}/restore`, {
        token: p.token,
        operation_id: randomUUID()
      });
    expect(r.statusCode, r.body).toBe(200);
    const result = r.json<{ files: { id: string; name: string }[] }>();
    expect(result.files.map((f) => f.name)).toEqual(["legacy.txt", "report.html"]);
    const legacy = result.files.find((f) => f.name === "legacy.txt")!,
      published = result.files.find((f) => f.name === "report.html")!;
    expect((await get(`/restored-files/${legacy.id}`)).body).toBe("legacy result");
    expect((await get(`/restored-files/${published.id}`)).body).toBe(
      "<script>not executed</script>"
    );
    expect(google.urls.every((u) => !new URL(u).searchParams.has("q"))).toBe(true);
  });

  it.each([
    { damage: "unpublished", checkpoint: false },
    { damage: "unpublished", checkpoint: true },
    { damage: "missing", checkpoint: true }
  ])(
    "never downgrades $damage modern result evidence (checkpoint=$checkpoint) to legacy",
    async ({ damage, checkpoint }) => {
      insertLegacy();
      if (checkpoint)
        db.sqlite
          .prepare(
            "INSERT INTO work_checkpoints(work_id,version,state_json) VALUES('source-work',1,'{}')"
          )
          .run();
      if (damage === "missing")
        db.sqlite.prepare("DELETE FROM work_artifact_versions WHERE id='artifact'").run();
      else
        db.sqlite
          .prepare("UPDATE work_artifact_versions SET published=0 WHERE id='artifact'")
          .run();
      const sources = await loadSources();
      expect(sources.files.filter((file) => file.name === "report.html")).toEqual([]);
      expect(sources.files.map((file) => file.name)).toEqual(checkpoint ? [] : ["legacy.txt"]);
      expect(google.uploads).toBe(0);
    }
  );

  it("rejects an old legacy selection after modern checkpoints appear without uploading it", async () => {
    insertLegacy();
    const old = (await loadSources()).files.find((file) => file.name === "legacy.txt")!;
    db.sqlite
      .prepare(
        "INSERT INTO work_checkpoints(work_id,version,state_json) VALUES('source-work',1,'{}')"
      )
      .run();
    const response = await post("/backups", {
      operation_id: randomUUID(),
      chat_ids: [],
      include_results: false,
      file_ids: [old.id]
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "DRIVE_OPERATION_CONFLICT" } });
    expect(google.uploads).toBe(0);
  });

  it("keeps stored legacy hashes and treats explicit file selections as a distinct operation identity", async () => {
    insertLegacy();
    expect(selectionHash({ include_results: true, chat_ids: ["b", "a"] })).toBe(
      selectionHash({ include_results: true, chat_ids: ["a", "b"] })
    );
    expect(selectionHash({ include_results: true })).not.toBe(
      selectionHash({ include_results: true, file_ids: [] })
    );
    const list = await loadSources(),
      legacy = list.files.find((f) => f.name === "legacy.txt")!;
    const selected = await save({
      chat_ids: [],
      include_results: false,
      file_ids: [legacy.id]
    });
    expect(selected.preview.files).toBe(1);
    const p = await preview(selected.id),
      r = await post(`/backups/${selected.id}/restore`, {
        token: p.token,
        operation_id: randomUUID()
      });
    expect(r.statusCode, r.body).toBe(200);
    const result = r.json<{ files: { id: string; name: string }[] }>();
    expect(result.files.map((f) => f.name)).toEqual(["legacy.txt"]);
    expect((await get(`/restored-files/${result.files[0]!.id}`)).body).toBe("legacy result");
  });

  it("succeeds chat-only backup when an EXCLUDED artifact has an invalid stored checksum", async () => {
    db.sqlite
      .prepare("UPDATE work_artifact_versions SET sha256=? WHERE id=?")
      .run("invalid-checksum", "artifact");
    const r = await post("/backups", { operation_id: randomUUID(), include_results: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<View>().preview).toMatchObject({ chats: 1, files: 0 });
    expect(google.uploads).toBe(1);
  });

  it("fails an explicitly selected artifact with an invalid stored checksum instead of claiming success", async () => {
    db.sqlite
      .prepare("UPDATE work_artifact_versions SET sha256=? WHERE id=?")
      .run("invalid-checksum", "artifact");
    const list = await loadSources(),
      artifact = list.files.find((f) => f.kind === "kosmora")!;
    const r = await post("/backups", {
      operation_id: randomUUID(),
      chat_ids: [],
      include_results: false,
      file_ids: [artifact.id]
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json()).toMatchObject({ error: { code: "BACKUP_INVALID" } });
    expect(google.uploads).toBe(0);
  });

  it("rejects a stale explicit source version instead of silently substituting changed Work output", async () => {
    insertLegacy();
    const list = await loadSources(),
      legacy = list.files.find((f) => f.name === "legacy.txt")!;
    db.sqlite.prepare("UPDATE manager_work SET version=2 WHERE id=?").run("source-work");
    const r = await post("/backups", {
      operation_id: randomUUID(),
      chat_ids: [],
      include_results: false,
      file_ids: [legacy.id]
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ error: { code: "DRIVE_OPERATION_CONFLICT" } });
    expect(google.uploads).toBe(0);
  });

  it("rejects oversized selected aggregate bytes BEFORE reading file bodies", async () => {
    const huge = "x".repeat(SNAPSHOT_MAX_BYTES + 1024),
      t = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at)
         VALUES('huge-artifact','source-project','source-work','huge.txt',1,?,?,?,1,?)`
      )
      .run(huge, "0".repeat(64), Buffer.byteLength(huge), t);
    const r = await post("/backups", {
      operation_id: randomUUID(),
      chat_ids: [],
      include_results: true
    });
    expect(r.statusCode, r.body).toBe(413);
    expect(r.json()).toMatchObject({ error: { code: "BACKUP_TOO_LARGE" } });
    expect(google.uploads).toBe(0);
  });

  it("saves three selected results through /sources and /link, survives a lost second part on restart", async () => {
    const t = new Date().toISOString();
    const insert = db.sqlite.prepare(
      `INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at)
       VALUES(?,?,?,?,?,?,?,?,1,?)`
    );
    for (const [artifactId, name, marker] of [
      ["artifact-one", "large-one.txt", "large-one-marker"],
      ["artifact-two", "large-two.txt", "large-two-marker"],
      ["artifact-three", "large-three.txt", "large-three-marker"]
    ] as const) {
      const content = `${marker}${"x".repeat(900000)}`;
      insert.run(
        artifactId,
        "source-project",
        "source-work",
        name,
        1,
        content,
        snapshotHash(Buffer.from(content)),
        Buffer.byteLength(content),
        t
      );
    }
    const list = await loadSources();
    expect(list.chats.length).toBe(1);
    const ids = list.files
      .filter((f) => ["large-one.txt", "large-two.txt", "large-three.txt"].includes(f.name))
      .map((f) => f.id);
    expect(ids).toHaveLength(3);
    const status = await get("");
    expect(status.json()).toMatchObject({ state: "connected" });
    const link = await get("/link");
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json<{ url: string }>().url).toContain("/drive/folders/folder_seed");
    expect(google.urls.some((u) => new URL(u).searchParams.has("q"))).toBe(false);
    google.failUpload = 2;
    const first = await post("/backups", {
      operation_id: randomUUID(),
      chat_ids: [],
      include_results: false,
      file_ids: ids
    });
    expect(first.statusCode, first.body).toBe(502);
    const item = runtime.bundleStore.list(owner)[0]!;
    expect(item.parts).toBe(2);
    expect(item.state).toBe("uncertain");
    await app.close();
    runtime = configuredGoogleDrive(db.sqlite, origin, env, google.request);
    app = build();
    const retry = await post(`/backups/${item.id}/retry`);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({ state: "verified", saved_parts: 2 });
    expect(google.files.size).toBe(2);
    expect(google.ids).toBe(2);
    const p = await preview(item.id);
    expect(p.files).toBe(3);
    const restored = await post(`/backups/${item.id}/restore`, {
      token: p.token,
      operation_id: randomUUID()
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json<{ files: { id: string }[] }>().files).toHaveLength(3);
    const one = runtime.bundleStore.files(owner).find((f) => f.name === "large-one.txt")!;
    expect(typeof one.id).toBe("string");
    const download = await get(`/restored-files/${String(one.id)}`);
    expect(download.body).toContain("large-one-marker");
    expect(google.urls.every((u) => !new URL(u).searchParams.has("q"))).toBe(true);
  });

  it("rejects a reused operation whose file selection changed", async () => {
    const operation = randomUUID(),
      list = await loadSources(),
      artifact = list.files.find((f) => f.kind === "kosmora")!;
    await save({ chat_ids: [], include_results: false, file_ids: [artifact.id] }, operation);
    const conflict = await post("/backups", {
      operation_id: operation,
      chat_ids: [],
      include_results: true
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "DRIVE_OPERATION_CONFLICT" } });
    expect(google.uploads).toBe(1);
  });

  it("marks a corrupt remote part as a conflict, not a verified backup", async () => {
    const item = await save();
    const fileId = [...google.files.keys()][0]!;
    const bytes = google.files.get(fileId)!.bytes;
    bytes[0] = bytes[0]! ^ 1;
    const r = await post(`/backups/${item.id}/preview`, {});
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ error: { code: "DRIVE_ARCHIVE_CHANGED" } });
    expect(runtime.bundleStore.get(owner, item.id).state).toBe("uncertain");
  });

  it("deletes local snapshots, cache and restored files with the owner privacy operation, retaining remote copies", async () => {
    const item = await save(),
      p = await preview(item.id);
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: randomUUID() }))
        .statusCode
    ).toBe(200);
    google.failUpload = google.uploads + 1;
    expect(
      (await post("/backups", { operation_id: randomUUID(), include_results: false })).statusCode
    ).toBe(502);
    const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    privacy.register({
      id: "account-core",
      quiesce: (_o, e) => Promise.resolve({ drained: true, fence_epoch: e }),
      export: () => Promise.resolve({ complete: true, records: {}, originals: [] }),
      delete: () => Promise.resolve({ deleted_records: 0 })
    });
    privacy.register(googleDrivePrivacyAdapter(db.sqlite, runtime.worker!, runtime.bundleStore));
    const token = "fixture-delete-confirmation-token";
    db.sqlite
      .prepare(
        `INSERT INTO kosmora_data_delete_challenges(owner_id,digest,expires_at)
         VALUES(?,?,?)`
      )
      .run(owner, snapshotHash(Buffer.from(token)), new Date(Date.now() + 60000).toISOString());
    expect((await privacy.delete(owner, token, "УДАЛИТЬ МОИ ДАННЫЕ")).deleted).toBe(true);
    expect(runtime.bundleStore.list(owner)).toEqual([]);
    expect(runtime.bundleStore.files(owner)).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT count(*) AS n FROM drive_restores WHERE owner_id=?").get(owner)
    ).toMatchObject({ n: 0 });
    expect(google.files.size).toBe(2);
    expect(google.methods).not.toContain("DELETE");
  });

  it("keeps an immutable multi-part snapshot across worker restart and lost ACK, then resumes with the same remote IDs", async () => {
    const insert = db.sqlite.prepare(
      `INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,attachments_json,created_at,updated_at)
       VALUES(?,?,?,'assistant','text',?,'completed','[]',?,?)`
    );
    for (let i = 0; i < 24; i++) {
      const at = new Date().toISOString();
      insert.run(randomUUID(), chatId, owner, "x".repeat(100000), at, at);
    }
    google.failUpload = 2;
    const first = await post("/backups", { operation_id: randomUUID(), include_results: false });
    expect(first.statusCode).toBe(502);
    const item = runtime.bundleStore.list(owner)[0]!;
    expect(item.parts).toBe(2);
    expect(item.state).toBe("uncertain");
    const raw = db.sqlite.prepare("SELECT payload FROM drive_snapshots").get() as {
      payload: Uint8Array;
    };
    expect(Buffer.from(raw.payload).includes(Buffer.from("original message"))).toBe(false);
    db.sqlite
      .prepare(
        `UPDATE general_chat_messages SET content='changed after snapshot'
          WHERE chat_id=? AND role='user'`
      )
      .run(chatId);
    await app.close();
    runtime = configuredGoogleDrive(db.sqlite, origin, env, google.request);
    app = build();
    const retry = await post(`/backups/${item.id}/retry`);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({ state: "verified", saved_parts: 2 });
    expect(google.files.size).toBe(2);
    expect(google.ids).toBe(2);
    expect((await app.inject({ url: base })).json()).toMatchObject({
      archive_count: 1,
      pending_count: 0
    });
    const p = await preview(item.id),
      restored = await post(`/backups/${item.id}/restore`, {
        token: p.token,
        operation_id: randomUUID()
      });
    const newId = restored.json<{ chats: { id: string }[] }>().chats[0]!.id;
    expect(
      db.sqlite
        .prepare("SELECT content FROM general_chat_messages WHERE chat_id=? AND role=?")
        .get(newId, "user")
    ).toMatchObject({ content: "original message" });
  });

  it("does not accept missing or corrupt parts as a verified copy", async () => {
    const item = await save();
    google.files.clear();
    expect((await post(`/backups/${item.id}/preview`)).statusCode).toBe(502);
    expect(runtime.bundleStore.get(owner, item.id).state).toBe("uncertain");
  });

  it("rolls back the entire restore if any new message cannot be inserted", async () => {
    const item = await save(),
      p = await preview(item.id),
      op = randomUUID();
    db.sqlite.exec(
      `CREATE TRIGGER fixture_reject_restore BEFORE INSERT ON general_chat_messages
       BEGIN SELECT RAISE(ABORT,'fixture restore failure'); END;`
    );
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: op })).statusCode
    ).toBe(502);
    expect(
      db.sqlite.prepare("SELECT count(*) AS n FROM general_chats WHERE owner_id=?").get(owner)
    ).toMatchObject({ n: 1 });
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM drive_restores").get()).toMatchObject({
      n: 0
    });
    db.sqlite.exec("DROP TRIGGER fixture_reject_restore");
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: op })).statusCode
    ).toBe(200);
  });

  it("includes cached originals in privacy export without credentials and fences the earlier preview", async () => {
    const item = await save(),
      p = await preview(item.id);
    const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    privacy.register({
      id: "account-core",
      quiesce: (_o, e) => Promise.resolve({ drained: true, fence_epoch: e }),
      export: () => Promise.resolve({ complete: true, records: {}, originals: [] }),
      delete: () => Promise.resolve({ deleted_records: 0 })
    });
    privacy.register(googleDrivePrivacyAdapter(db.sqlite, runtime.worker!, runtime.bundleStore));
    const out = await privacy.export(owner);
    expect(out.sections["cloud-storage"]?.originals).toHaveLength(1);
    expect(JSON.stringify(out)).not.toMatch(
      /fixture-access|fixture-refresh|preview_token|grant_ciphertext/
    );
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: randomUUID() }))
        .statusCode
    ).toBe(409);
    const section = await googleDrivePrivacyAdapter(
      db.sqlite,
      runtime.worker!,
      runtime.bundleStore
    ).export(owner);
    const binary = await privacy.binary(owner, "cloud-storage", section.originals[0]!.id);
    expect(binary?.original.sha256).toBe(section.originals[0]!.sha256);
  });

  it("never restores running work, incompatible versions or extra privileged archive fields", async () => {
    const item = await save(),
      bytes = Buffer.from(
        JSON.stringify({
          format: "kosmora-chat-backup",
          version: 1,
          exported_at: new Date().toISOString(),
          chats: [],
          files: [],
          credentials: "must reject"
        })
      );
    expect(() => parseSnapshot(bytes)).toThrow("BACKUP_INVALID");
    const incompatible = Buffer.from(
      JSON.stringify({
        format: "kosmora-chat-backup",
        version: 2,
        exported_at: new Date().toISOString(),
        chats: [],
        files: []
      })
    );
    expect(() => parseSnapshot(incompatible)).toThrow("BACKUP_INVALID");
    const p = await preview(item.id);
    await post(`/backups/${item.id}/cancel-preview`);
    expect(
      (await post(`/backups/${item.id}/restore`, { token: p.token, operation_id: randomUUID() }))
        .statusCode
    ).toBe(409);
  });

  it("rejects swapped parts, compression and corrupt ciphertext without filesystem extraction", () => {
    const payload = Buffer.from("x".repeat(2300000)),
      id = randomUUID();
    const part = snapshotPart(payload, id, 0),
      expected = { id, bytes: payload.length, sha256: snapshotHash(payload), count: 2 };
    expect(readSnapshotPart(part, expected, 0).equals(payload.subarray(0, 2 * 1024 * 1024))).toBe(
      true
    );
    expect(() => readSnapshotPart(part, expected, 1)).toThrow("BACKUP_INVALID_PART");
    const bad = Buffer.from(part);
    bad.writeUInt16LE(8, 8);
    expect(() => readSnapshotPart(bad, expected, 0)).toThrow("BACKUP_INVALID_PART");
    const cipher = new DrivePayloadCipher(Buffer.alloc(32)),
      encrypted = cipher.seal(owner, id, payload);
    expect(() => cipher.open("other-owner", id, encrypted)).toThrow("BACKUP_CACHE_UNREADABLE");
    encrypted[20] = encrypted[20]! ^ 1;
    expect(() => cipher.open(owner, id, encrypted)).toThrow("BACKUP_CACHE_UNREADABLE");
  });
  it("can clear temporary cache even when Drive and its encryption key are unavailable", async () => {
    const item = await save();
    await preview(item.id);
    await app.close();
    runtime = configuredGoogleDrive(db.sqlite, origin, {}, google.request);
    app = build();
    expect(() => runtime.bundleStore.privacySection(owner)).toThrow();
    expect((await post(`/backups/${item.id}/cancel-preview`)).statusCode).toBe(200);
    expect(runtime.bundleStore.privacySection(owner).complete).toBe(true);
    expect(runtime.bundleStore.get(owner, item.id).state).toBe("verified");
    expect(google.files.size).toBe(1);
    const page = await app.inject({ url: base + "/backups?offset=1" });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ items: [], has_more: false });
  });
  it("accepts selected file bytes above 16 MiB while the canonical snapshot stays below 32 MiB", () => {
    const content = "x".repeat(1_900_000),
      at = new Date().toISOString();
    const insert = db.sqlite.prepare(
      "INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at) VALUES(?,'source-project','source-work',?,1,?,?,?,1,?)"
    );
    for (let n = 0; n < 9; n++)
      insert.run(
        `bulk-${n}`,
        `bulk-${n}.txt`,
        content,
        snapshotHash(content),
        Buffer.byteLength(content),
        at
      );
    const bytes = captureSnapshot(db.sqlite, owner, { chat_ids: [], include_results: true });
    expect(bytes.byteLength).toBeGreaterThan(16 * 1024 * 1024);
    expect(bytes.byteLength).toBeLessThan(32 * 1024 * 1024);
    expect(parseSnapshot(bytes).files).toHaveLength(10);
  });

  it("preserves the legacy sources.items chat list alongside additive file sources", async () => {
    const r = await app.inject({ url: base + "/sources" });
    expect(r.statusCode, r.body).toBe(200);
    const data = r.json<{ items: unknown[]; chats: unknown[]; files: unknown[] }>();
    expect(data.items).toEqual(data.chats);
    expect(data.items).toEqual([expect.objectContaining({ id: chatId, mode: "work" })]);
    expect(data.files).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("other owner's secret");
  });
});
