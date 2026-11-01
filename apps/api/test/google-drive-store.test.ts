import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "@cosmora/db";
import { GoogleDriveStore } from "../src/cloud-storage/google-drive-store.js";
import { DriveGrantCipher } from "../src/cloud-storage/google-drive-grant-cipher.js";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import { googleDrivePrivacyAdapter } from "../src/cloud-storage/google-drive-privacy.js";
import {
  OwnerPrivacyCoordinator,
  type PrivacyAdapter
} from "../src/account-settings/privacy/coordinator.js";

const grant = {
  accessToken: "fixture-access-secret",
  refreshToken: "fixture-refresh-secret",
  scope: DRIVE_FILE_SCOPE,
  expiresAt: 3601000
} as const;
const bytes = Buffer.from("PK fixture payload");
const cipher = () => new DriveGrantCipher(new Uint8Array(32).fill(7));
const emptyCore: PrivacyAdapter = {
  id: "account-core",
  quiesce: (_owner, epoch) => Promise.resolve({ drained: true, fence_epoch: epoch }),
  export: () => Promise.resolve({ records: {}, originals: [], complete: true }),
  delete: () => Promise.resolve({ deleted_records: 0 })
};

describe("durable owner-bound Drive journal", () => {
  let db: ReturnType<typeof openDatabase>, store: GoogleDriveStore;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new GoogleDriveStore(db.sqlite, cipher());
  });
  afterEach(() => db.close());
  const connect = (owner = "owner-a") =>
    store.connect(store.beginConnect(owner), grant, `folder_${owner}`);
  const ready = (owner = "owner-a") => {
    const context = connect(owner),
      { lease } = store.claimFolder(context);
    store.finishFolder(context, lease, true);
    return context;
  };
  const fence = (state: string, epoch = 1) => {
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('owner-a',?,?,'fixture','now','now') ON CONFLICT(owner_id) DO UPDATE SET state=excluded.state,epoch=excluded.epoch"
      )
      .run(epoch, state);
  };

  it("persists only encrypted credentials and exposes explicit safe metadata", () => {
    const context = connect();
    const raw = db.sqlite
      .prepare("SELECT grant_ciphertext FROM kosmora_drive_connections")
      .get() as { grant_ciphertext: string };
    expect(raw.grant_ciphertext).not.toContain("secret");
    expect(store.readGrant(context)).toEqual({ grant, version: 0 });
    expect(JSON.stringify(store.status("owner-a"))).not.toMatch(
      /secret|ciphertext|grant_version|folder_lease/
    );
  });

  it("invalidates a pending first connection when the owner disconnects", () => {
    const ticket = store.beginConnect("owner-a");
    store.disconnect("owner-a");
    expect(() => store.connect(ticket, grant, "folder_123")).toThrow("DRIVE_CONNECTION_CHANGED");
    expect(store.status("owner-a")?.folder_state).toBe("disconnected");
  });

  it("uses compare-and-swap for both reconnect and token refresh", () => {
    const ticket = store.beginConnect("owner-a"),
      context = store.connect(ticket, grant, "folder_123");
    expect(() => store.connect(ticket, grant, "folder_456")).toThrow("DRIVE_CONNECTION_CHANGED");
    const fresh = { ...grant, accessToken: "new-access" };
    store.refreshGrant(context, 0, fresh);
    expect(() => store.refreshGrant(context, 0, grant)).toThrow("DRIVE_GRANT_CHANGED");
    expect(store.readGrant(context)).toEqual({ grant: fresh, version: 1 });
    store.disconnect("owner-a");
    expect(() => store.refreshGrant(context, 1, grant)).toThrow("DRIVE_CONNECTION_CHANGED");
    expect(
      db.sqlite.prepare("SELECT grant_ciphertext FROM kosmora_drive_connections").get()
    ).toMatchObject({ grant_ciphertext: null });
  });

  it("reserves one receipt per operation and refuses changed data or a second ID", () => {
    const context = ready(),
      item = store.reserveArchive(context, "op-1", "archive_123", bytes);
    expect(store.reserveArchive(context, "op-1", "archive_123", bytes)).toEqual(item);
    expect(() => store.reserveArchive(context, "op-1", "archive_456", bytes)).toThrow(
      "DRIVE_OPERATION_CONFLICT"
    );
    expect(() =>
      store.reserveArchive(context, "op-1", "archive_123", Buffer.from("changed"))
    ).toThrow("DRIVE_OPERATION_CONFLICT");
    expect(store.listArchives("owner-a")).toHaveLength(1);
    expect(store.findArchive(context, "op-1")?.id).toBe(item.id);
  });

  it("requires a verified folder before reserving an archive", () => {
    const context = connect();
    expect(() => store.reserveArchive(context, "op-1", "archive_123", bytes)).toThrow(
      "DRIVE_FOLDER_NOT_READY"
    );
    const first = store.claimFolder(context);
    expect(() => store.claimFolder(context)).toThrow("DRIVE_FOLDER_BUSY");
    const second = store.claimFolderReconciliation(context);
    expect(() => store.finishFolder(context, first.lease, true)).toThrow("DRIVE_LEASE_CHANGED");
    store.finishFolder(context, second.lease, false);
    expect(() => store.claimFolder(context)).toThrow("DRIVE_FOLDER_BUSY");
    const third = store.claimFolderReconciliation(context);
    store.finishFolder(context, third.lease, true);
    expect(store.status("owner-a")?.folder_state).toBe("ready");
  });

  it("prevents a second upload claim and fences a stale worker after reconciliation", () => {
    const context = ready(),
      item = store.reserveArchive(context, "op-1", "archive_123", bytes);
    const first = store.claimArchive(context, item.id, "upload");
    const other = new GoogleDriveStore(db.sqlite, cipher());
    expect(() => other.claimArchive(context, item.id, "upload")).toThrow("DRIVE_ARCHIVE_BUSY");
    const second = other.claimArchive(context, item.id, "reconcile");
    expect(() => store.finishArchive(context, item.id, first.lease, "verified")).toThrow(
      "DRIVE_LEASE_CHANGED"
    );
    other.finishArchive(context, item.id, second.lease, "verified");
    expect(store.getArchive(context, item.id).state).toBe("verified");
  });

  it("isolates owners even when they use the same operation ID", () => {
    const a = ready(),
      b = ready("owner-b");
    const item = store.reserveArchive(a, "op-1", "archive_123", bytes);
    store.reserveArchive(b, "op-1", "archive_456", bytes);
    expect(() => store.getArchive(b, item.id)).toThrow("DRIVE_ARCHIVE_NOT_FOUND");
    expect(() => store.readGrant({ ...a, ownerId: "owner-b" })).toThrow("DRIVE_CONNECTION_CHANGED");
    expect(store.listArchives("owner-b").map((i) => i.fileId)).toEqual(["archive_456"]);
  });

  it("keeps uncertain receipts across disconnect without accepting a late completion", () => {
    const context = ready(),
      item = store.reserveArchive(context, "op-1", "archive_123", bytes);
    const claimed = store.claimArchive(context, item.id, "upload");
    store.disconnect("owner-a");
    expect(() => store.finishArchive(context, item.id, claimed.lease, "verified")).toThrow(
      "DRIVE_CONNECTION_CHANGED"
    );
    expect(store.listArchives("owner-a")[0]?.state).toBe("uploading");
    const replacement = ready();
    expect(store.getArchive(replacement, item.id).fileId).toBe(item.fileId);
    expect(() => store.claimArchive(replacement, item.id, "retry")).toThrow(
      "DRIVE_ARCHIVE_NOT_FOUND"
    );
    expect(store.listArchives("owner-a")).toHaveLength(1);
  });

  it("bounds the pending queue per connection without letting retired receipts block a new one", () => {
    const context = ready();
    for (let i = 0; i < 10; i++)
      store.reserveArchive(context, `op-${i}`, `archive_old_${i}`, bytes);
    expect(() => store.reserveArchive(context, "overflow", "archive_overflow", bytes)).toThrow(
      "DRIVE_JOURNAL_FULL"
    );
    const replacement = ready();
    expect(store.reserveArchive(replacement, "op-new", "archive_new", bytes).state).toBe(
      "reserved"
    );
    expect(store.listArchives("owner-a")).toHaveLength(11);
  });

  it("enforces lifecycle fences in methods and raw SQL, and rejects pre-export epochs after resume", () => {
    const context = ready(),
      item = store.reserveArchive(context, "op-1", "archive_123", bytes);
    fence("quiescing");
    expect(() => store.beginConnect("owner-a")).toThrow("OWNER_DATA_FENCED");
    expect(() =>
      db.sqlite
        .prepare(
          "UPDATE kosmora_drive_connections SET revision=revision+1 WHERE owner_id='owner-a'"
        )
        .run()
    ).toThrow("OWNER_DATA_FENCED");
    expect(() =>
      db.sqlite.prepare("UPDATE kosmora_drive_archives SET state='failed' WHERE id=?").run(item.id)
    ).toThrow("OWNER_DATA_FENCED");
    fence("active");
    expect(() => store.readGrant(context)).toThrow("OWNER_DATA_FENCED");
    expect(store.readGrant(store.context("owner-a")).grant).toEqual(grant);
  });

  it("exports journal metadata, excludes tokens and deletes only the selected owner's local records", async () => {
    const context = ready();
    ready("owner-b");
    store.reserveArchive(context, "op-1", "archive_123", bytes);
    const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    privacy.register(emptyCore);
    privacy.register(googleDrivePrivacyAdapter(db.sqlite));
    const exported = await privacy.export("owner-a");
    expect(exported.sections["cloud-storage"]?.count).toBe(2);
    expect(JSON.stringify(exported)).not.toMatch(
      /fixture-access-secret|fixture-refresh-secret|grant_ciphertext|folder_lease/
    );
    expect(exported.sections["cloud-storage"]?.records.connections?.[0]).toMatchObject({
      remote_copies: "retained_on_user_drive",
      credential_export: "excluded"
    });
    const adapter = googleDrivePrivacyAdapter(db.sqlite);
    expect(() => adapter.delete("owner-a", 1)).toThrow("OWNER_DATA_FENCED");
    fence("deleting", 2);
    expect(await adapter.delete("owner-a", 2)).toEqual({ deleted_records: 2 });
    expect(store.status("owner-a")).toBeNull();
    expect(store.status("owner-b")?.folder_state).toBe("ready");
    expect(() => store.readGrant(context)).toThrow("OWNER_DATA_FENCED");
  });

  it("fails closed when the mandatory Drive privacy adapter is absent", async () => {
    const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
      required: ["account-core", "cloud-storage"]
    });
    privacy.register(emptyCore);
    await expect(privacy.export("owner-a")).rejects.toMatchObject({
      code: "PRIVACY_ADAPTERS_UNAVAILABLE"
    });
  });

  it("survives closing and reopening a real SQLite file without authorizing another POST", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-drive-journal-"));
    let disk: ReturnType<typeof openDatabase> | undefined;
    try {
      disk = openDatabase(join(directory, "journal.sqlite"));
      await runMigrations(disk);
      let journal = new GoogleDriveStore(disk.sqlite, cipher());
      const context = journal.connect(journal.beginConnect("owner-a"), grant, "folder_disk");
      const folder = journal.claimFolder(context);
      journal.finishFolder(context, folder.lease, true);
      const item = journal.reserveArchive(context, "op-1", "archive_disk", bytes);
      journal.claimArchive(context, item.id, "upload");
      disk.close();
      disk = undefined;
      disk = openDatabase(join(directory, "journal.sqlite"));
      journal = new GoogleDriveStore(disk.sqlite, cipher());
      expect(journal.getArchive(journal.context("owner-a"), item.id).state).toBe("uploading");
      expect(() => journal.claimArchive(context, item.id, "upload")).toThrow("DRIVE_ARCHIVE_BUSY");
      const claimed = journal.claimArchive(context, item.id, "reconcile");
      journal.finishArchive(context, item.id, claimed.lease, "verified");
      expect(journal.listArchives("owner-a")).toHaveLength(1);
      expect(journal.readGrant(context).grant).toEqual(grant);
    } finally {
      disk?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
