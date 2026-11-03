import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GeneralChatStore, openDatabase, runMigrations } from "@cosmora/db";
import { loadServerConfig } from "@cosmora/config";
import { buildApp } from "../src/app.js";
import { configuredGoogleDrive } from "../src/cloud-storage/google-drive-runtime.js";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import {
  parseSnapshot,
  readSnapshotPart,
  snapshotHash,
  snapshotPart
} from "../src/cloud-storage/google-drive-snapshot.js";
import { DrivePayloadCipher } from "../src/cloud-storage/google-drive-payload-cipher.js";
import { googleDrivePrivacyAdapter } from "../src/cloud-storage/google-drive-privacy.js";
import { OwnerPrivacyCoordinator } from "../src/account-settings/privacy/coordinator.js";
import { createArchive } from "../src/account-settings/privacy/archive.js";

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
class GoogleFixture {
  files = new Map<string, { metadata: object; bytes: Buffer }>();
  folders = new Map<string, object>();
  uploads = 0;
  ids = 0;
  failUpload = 0;
  methods: string[] = [];
  request = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    const json = (v: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    this.methods.push(init?.method ?? "GET");
    if (url.pathname.endsWith("generateIds")) return json({ ids: [`google_file_${++this.ids}`] });
    if (init?.method === "POST" && url.pathname === "/drive/v3/files") {
      const m = JSON.parse(init.body as string) as { id: string };
      this.folders.set(m.id, { ...m, trashed: false });
      return json({ id: m.id });
    }
    if (init?.method === "POST") {
      this.uploads++;
      const b = Buffer.from(init.body as Uint8Array),
        start = b.indexOf("\r\n\r\n") + 4;
      const m = JSON.parse(b.subarray(start, b.indexOf("\r\n--", start)).toString()) as {
        id: string;
      };
      if (this.files.has(m.id)) return json({}, 409);
      const marker = "Content-Type: application/zip\r\n\r\n",
        bytes = Buffer.from(b.subarray(b.indexOf(marker) + marker.length, b.lastIndexOf("\r\n--")));
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
    const other = chats.createChat("other owner's secret", randomUUID(), "other-owner");
    chats.cancelRun(other.run.id);
    const t = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES('source-project',?,'Original project','active',?,?)"
      )
      .run(owner, t, t);
    db.sqlite
      .prepare(
        "INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json) VALUES('source-work','source-project',?,'source',1,?)"
      )
      .run(owner, JSON.stringify({ status: "completed" }));
    const content = "<script>not executed</script>";
    db.sqlite
      .prepare(
        "INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at) VALUES('artifact','source-project','source-work','report.html',1,?,?,?,1,?)"
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

  it("rejects foreign selections and never uploads another owner's content", async () => {
    const other = db.sqlite
      .prepare("SELECT id FROM general_chats WHERE owner_id='other-owner'")
      .get() as { id: string };
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
    db.sqlite
      .prepare(
        "INSERT INTO manager_work_files(execution_id,name,content) VALUES('source-work','report.html','legacy duplicate')"
      )
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO manager_work_files(execution_id,name,content) VALUES('source-work','legacy.txt','legacy result')"
      )
      .run();
    const item = await save();
    expect(item.preview.files).toBe(2);
    const p = await preview(item.id);
    const r = await post(`/backups/${item.id}/restore`, {
      token: p.token,
      operation_id: randomUUID()
    });
    expect(r.statusCode).toBe(200);
    const names = runtime.bundleStore.files(owner).map((f) => f.name);
    expect(names.sort()).toEqual(["legacy.txt", "report.html"]);
  });

  it("deletes local snapshots, cache and restored files with the owner's privacy operation, retaining remote copies", async () => {
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
        "INSERT INTO kosmora_data_delete_challenges(owner_id,digest,expires_at) VALUES(?,?,?)"
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
      "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,attachments_json,created_at,updated_at) VALUES(?,?,?,'assistant','text',?,'completed','[]',?,?)"
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
        "UPDATE general_chat_messages SET content='changed after snapshot' WHERE chat_id=? AND role='user'"
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
        .prepare("SELECT content FROM general_chat_messages WHERE chat_id=? AND role='user'")
        .get(newId)
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
      "CREATE TRIGGER fixture_reject_restore BEFORE INSERT ON general_chat_messages BEGIN SELECT RAISE(ABORT,'fixture restore failure'); END;"
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

  it("never restores running work or accepts extra privileged archive fields", async () => {
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
});
