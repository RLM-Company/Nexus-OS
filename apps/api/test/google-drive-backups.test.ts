import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "@cosmora/db";
import { GoogleDriveBackups } from "../src/cloud-storage/google-drive-backups.js";
import { GoogleDriveStore } from "../src/cloud-storage/google-drive-store.js";
import { DriveGrantCipher } from "../src/cloud-storage/google-drive-grant-cipher.js";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import { googleDrivePrivacyAdapter } from "../src/cloud-storage/google-drive-privacy.js";
import {
  OwnerPrivacyCoordinator,
  type PrivacyAdapter
} from "../src/account-settings/privacy/coordinator.js";

const bytes = Buffer.from("PK binary fixture, not user content");
const grant = {
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  expiresAt: 3601000,
  scope: DRIVE_FILE_SCOPE
} as const;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
type Metadata = {
  id: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  trashed: boolean;
  appProperties: Record<string, string>;
};
class DriveFixture {
  readonly folders = new Map<string, Metadata>();
  readonly files = new Map<string, { metadata: Metadata; bytes: Buffer }>();
  readonly started = deferred();
  readonly methods: string[] = [];
  uploadWrites = 0;
  folderWrites = 0;
  generated = 0;
  loseUploadAck = false;
  loseFolderAck = false;
  failBeforeCreate = false;
  hideFiles = false;
  corruptMedia = false;
  holdUpload: Promise<void> | undefined;
  request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    this.methods.push(init?.method ?? "GET");
    if (url.pathname.endsWith("/generateIds"))
      return json({ ids: [`generated_file_${++this.generated}`] });
    if (init?.method === "POST" && url.pathname === "/drive/v3/files") {
      const data = JSON.parse(init.body as string) as Metadata;
      this.folderWrites++;
      if (this.folders.has(data.id)) return json({ error: "already exists" }, 409);
      this.folders.set(data.id, { ...data, trashed: false });
      if (this.loseFolderAck) {
        this.loseFolderAck = false;
        throw Error("lost folder ACK");
      }
      return json({ id: data.id });
    }
    if (init?.method === "POST" && url.pathname === "/upload/drive/v3/files") {
      const body = Buffer.from(init.body as Uint8Array);
      const begin = body.indexOf("\r\n\r\n") + 4;
      const metadata = JSON.parse(
        body.subarray(begin, body.indexOf("\r\n--", begin)).toString("utf8")
      ) as Metadata;
      this.uploadWrites++;
      if (this.failBeforeCreate) {
        this.failBeforeCreate = false;
        throw Error("request interrupted before create");
      }
      if (this.files.has(metadata.id)) return json({ error: "already exists" }, 409);
      const marker = "Content-Type: application/zip\r\n\r\n";
      const content = body.subarray(
        body.indexOf(marker) + marker.length,
        body.lastIndexOf("\r\n--")
      );
      this.files.set(metadata.id, {
        metadata: { ...metadata, size: String(content.length), trashed: false },
        bytes: Buffer.from(content)
      });
      this.started.resolve();
      await this.holdUpload;
      if (this.loseUploadAck) {
        this.loseUploadAck = false;
        throw Error("lost upload ACK");
      }
      return json({ id: metadata.id });
    }
    const id = url.pathname.split("/").at(-1)!;
    const folder = this.folders.get(id);
    if (folder) return json(folder);
    const file = this.hideFiles ? undefined : this.files.get(id);
    if (!file) return json({ error: "not accessible" }, 404);
    if (url.searchParams.get("alt") === "media") {
      const result = new Uint8Array(file.bytes);
      if (this.corruptMedia) result[0] = result[0]! ^ 1;
      return new Response(result);
    }
    return json(file.metadata);
  });
}
const emptyCore: PrivacyAdapter = {
  id: "account-core",
  quiesce: (_owner, epoch) => Promise.resolve({ drained: true, fence_epoch: epoch }),
  export: () => Promise.resolve({ records: {}, originals: [], complete: true }),
  delete: () => Promise.resolve({ deleted_records: 0 })
};

describe("Drive copies through real transport and durable journal", () => {
  let db: ReturnType<typeof openDatabase>,
    store: GoogleDriveStore,
    fixture: DriveFixture,
    backups: GoogleDriveBackups;
  let authorization: {
    refresh: ReturnType<typeof vi.fn<(g: typeof grant) => Promise<typeof grant>>>;
  };
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new GoogleDriveStore(db.sqlite, new DriveGrantCipher(new Uint8Array(32)));
    fixture = new DriveFixture();
    authorization = { refresh: vi.fn().mockResolvedValue(grant) };
    backups = new GoogleDriveBackups(store, authorization, fixture.request, () => 1000);
  });
  afterEach(() => db.close());
  const connected = async (owner = "owner-a") => {
    store.connect(store.beginConnect(owner), grant, `folder_${owner}`);
    await backups.initializeFolder(owner);
  };
  const privacy = () => {
    const result = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    result.register(emptyCore);
    result.register(googleDrivePrivacyAdapter(db.sqlite, backups));
    return result;
  };

  it("uploads, verifies actual bytes and reuses the same operation without creating a duplicate", async () => {
    await connected();
    const item = await backups.upload("owner-a", "op-1", bytes);
    expect(item.state).toBe("verified");
    expect(item.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await backups.download("owner-a", item.id)).toEqual(bytes);
    expect((await backups.upload("owner-a", "op-1", bytes)).id).toBe(item.id);
    expect(fixture.uploadWrites).toBe(1);
    expect(fixture.generated).toBe(1);
    expect(fixture.folderWrites).toBe(1);
    await expect(backups.upload("owner-a", "op-1", Buffer.from("changed"))).rejects.toMatchObject({
      code: "DRIVE_OPERATION_CONFLICT"
    });
    expect(fixture.uploadWrites).toBe(1);
  });

  it("does not equate a successful upload ACK with a valid backup", async () => {
    await connected();
    fixture.corruptMedia = true;
    await expect(backups.upload("owner-a", "op-1", bytes)).rejects.toMatchObject({
      code: "DRIVE_ARCHIVE_CHANGED"
    });
    expect(store.listArchives("owner-a")[0]?.state).toBe("failed");
    expect(fixture.uploadWrites).toBe(1);
  });

  it("recovers after a lost upload ACK using only reads, even across a new worker instance", async () => {
    await connected();
    fixture.loseUploadAck = true;
    await expect(backups.upload("owner-a", "op-1", bytes)).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED"
    });
    const item = store.listArchives("owner-a")[0]!;
    expect(item.state).toBe("uncertain");
    fixture.hideFiles = true;
    const restarted = new GoogleDriveBackups(store, authorization, fixture.request, () => 1000);
    await expect(restarted.reconcile("owner-a", item.id)).rejects.toMatchObject({
      code: "DRIVE_ARCHIVE_UNAVAILABLE"
    });
    expect(store.listArchives("owner-a")[0]?.state).toBe("uncertain");
    fixture.hideFiles = false;
    expect((await restarted.upload("owner-a", "op-1", bytes)).state).toBe("verified");
    expect(fixture.uploadWrites).toBe(1);
    expect(fixture.generated).toBe(1);
  });

  it("reconciles a lost folder ACK without creating another folder", async () => {
    store.connect(store.beginConnect("owner-a"), grant, "folder_a");
    fixture.loseFolderAck = true;
    await expect(backups.initializeFolder("owner-a")).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED"
    });
    expect(store.status("owner-a")?.folder_state).toBe("uncertain");
    await backups.initializeFolder("owner-a");
    expect(store.status("owner-a")?.folder_state).toBe("ready");
    expect(fixture.folderWrites).toBe(1);
  });

  it("explicit retry after a request never reached Google uses the original ID and bytes", async () => {
    await connected();
    fixture.failBeforeCreate = true;
    await expect(backups.upload("owner-a", "op-1", bytes)).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED"
    });
    const item = store.listArchives("owner-a")[0]!;
    await expect(
      backups.retryUpload("owner-a", item.id, Buffer.from("changed"))
    ).rejects.toMatchObject({ code: "DRIVE_OPERATION_CONFLICT" });
    expect(fixture.uploadWrites).toBe(1);
    const retried = await backups.retryUpload("owner-a", item.id, bytes);
    expect(retried.state).toBe("verified");
    expect(retried.fileId).toBe(item.fileId);
    expect(fixture.generated).toBe(1);
    expect(fixture.files.size).toBe(1);
    expect(fixture.uploadWrites).toBe(2);
  });

  it("explicit retry of an existing archive reconciles 409 instead of overwriting it", async () => {
    await connected();
    fixture.loseUploadAck = true;
    await expect(backups.upload("owner-a", "op-1", bytes)).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED"
    });
    const item = store.listArchives("owner-a")[0]!;
    expect((await backups.retryUpload("owner-a", item.id, bytes)).state).toBe("verified");
    expect(fixture.files.size).toBe(1);
    expect(fixture.generated).toBe(1);
    expect(fixture.files.get(item.fileId)?.bytes).toEqual(bytes);
  });

  it("explicit folder retry uses the recorded ID and verifies a 409 conflict", async () => {
    store.connect(store.beginConnect("owner-a"), grant, "folder_a");
    fixture.loseFolderAck = true;
    await expect(backups.initializeFolder("owner-a")).rejects.toMatchObject({
      code: "DRIVE_TRANSPORT_FAILED"
    });
    await backups.retryFolder("owner-a");
    expect(store.status("owner-a")?.folder_state).toBe("ready");
    expect(fixture.folders.size).toBe(1);
    expect(fixture.folderWrites).toBe(2);
  });

  it("can read an older owned receipt after reconnect but cannot upload into its retired connection", async () => {
    await connected();
    const item = await backups.upload("owner-a", "op-1", bytes);
    await backups.disconnect("owner-a");
    store.connect(store.beginConnect("owner-a"), grant, "folder_reconnected");
    await backups.initializeFolder("owner-a");
    expect(await backups.download("owner-a", item.id)).toEqual(bytes);
    await expect(backups.retryUpload("owner-a", item.id, bytes)).rejects.toMatchObject({
      code: "DRIVE_CONNECTION_CHANGED"
    });
    fixture.hideFiles = true;
    await expect(backups.download("owner-a", item.id)).rejects.toMatchObject({
      code: "DRIVE_ARCHIVE_UNAVAILABLE"
    });
    expect(fixture.uploadWrites).toBe(1);
    expect(fixture.files.size).toBe(1);
  });

  it("refreshes an expired token through encrypted compare-and-swap before calling Drive", async () => {
    store.connect(store.beginConnect("owner-a"), { ...grant, expiresAt: 1 }, "folder_a");
    await backups.initializeFolder("owner-a");
    expect(authorization.refresh).toHaveBeenCalledTimes(1);
    expect(store.readGrant(store.context("owner-a")).version).toBe(1);
  });

  it("disconnects before draining an in-flight request and cannot resurrect its token or verified state", async () => {
    await connected();
    const gate = deferred();
    fixture.holdUpload = gate.promise;
    const job = backups.upload("owner-a", "op-1", bytes).catch((e: unknown) => e);
    await fixture.started.promise;
    const stopped = backups.disconnect("owner-a");
    expect(store.status("owner-a")?.folder_state).toBe("disconnected");
    gate.resolve();
    expect(await job).toBeInstanceOf(Error);
    await stopped;
    expect(store.listArchives("owner-a")[0]?.state).toBe("uploading");
    expect(
      db.sqlite.prepare("SELECT grant_ciphertext FROM kosmora_drive_connections").get()
    ).toMatchObject({ grant_ciphertext: null });
    expect(fixture.uploadWrites).toBe(1);
  });

  it("drains an in-flight upload before privacy export and reconciles it after resume with a new epoch", async () => {
    await connected();
    const gate = deferred();
    fixture.holdUpload = gate.promise;
    const job = backups.upload("owner-a", "op-1", bytes).catch((e: unknown) => e);
    await fixture.started.promise;
    const quiesce = vi.spyOn(backups, "quiesce");
    const exported = privacy().export("owner-a");
    await vi.waitFor(() => expect(quiesce).toHaveBeenCalledWith("owner-a"));
    await expect(backups.upload("owner-a", "op-2", bytes)).rejects.toMatchObject({
      code: "OWNER_DATA_FENCED"
    });
    gate.resolve();
    expect(await job).toBeInstanceOf(Error);
    const snapshot = await exported;
    expect(JSON.stringify(snapshot)).not.toContain("fixture-refresh");
    const item = store.listArchives("owner-a")[0]!;
    expect(item.state).toBe("uploading");
    expect((await backups.reconcile("owner-a", item.id)).state).toBe("verified");
    expect(fixture.uploadWrites).toBe(1);
  });

  it("privacy deletion removes local credentials and receipts without deleting the user's Drive copies", async () => {
    await connected();
    const gate = deferred();
    fixture.holdUpload = gate.promise;
    const upload = backups.upload("owner-a", "op-1", bytes).catch((e: unknown) => e);
    await fixture.started.promise;
    const token = "fixture-deletion-confirmation-123456";
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_data_delete_challenges(owner_id,digest,expires_at) VALUES(?,?,?)"
      )
      .run(
        "owner-a",
        createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() + 60_000).toISOString()
      );
    const quiesce = vi.spyOn(backups, "quiesce");
    const deleting = privacy().delete("owner-a", token, "УДАЛИТЬ МОИ ДАННЫЕ");
    await vi.waitFor(() => expect(quiesce).toHaveBeenCalledWith("owner-a"));
    expect(store.status("owner-a")).not.toBeNull();
    gate.resolve();
    expect(await upload).toBeInstanceOf(Error);
    const result = await deleting;
    expect(result.by_store["cloud-storage"]).toBe(2);
    expect(store.status("owner-a")).toBeNull();
    expect(store.listArchives("owner-a")).toEqual([]);
    expect(fixture.files.size).toBe(1);
    expect(fixture.folders.size).toBe(1);
    expect(fixture.methods).not.toContain("DELETE");
    await expect(backups.initializeFolder("owner-a")).rejects.toMatchObject({
      code: "OWNER_DATA_FENCED"
    });
  });

  it("bounds simultaneous binary operations across owners", async () => {
    for (let i = 0; i < 5; i++) await connected(`owner-${i}`);
    const gate = deferred();
    fixture.holdUpload = gate.promise;
    const jobs = Array.from({ length: 4 }, (_, i) => backups.upload(`owner-${i}`, "op-1", bytes));
    await vi.waitFor(() => expect(fixture.uploadWrites).toBe(4));
    await expect(backups.upload("owner-4", "op-1", bytes)).rejects.toMatchObject({
      code: "DRIVE_BUSY"
    });
    gate.resolve();
    expect((await Promise.all(jobs)).every((a) => a.state === "verified")).toBe(true);
    expect(fixture.uploadWrites).toBe(4);
  });
});
