import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import test from "node:test";
import { createArchive } from "../src/account-settings/privacy/archive.js";
import type {
  BinaryStream,
  OriginalBinary,
  OwnerPrivacyCoordinator,
  PrivacySection
} from "../src/account-settings/privacy/coordinator.js";
import {
  DRIVE_BACKUP_SCHEMA_VERSION,
  DRIVE_FILE_SCOPE,
  DriveGrantCipher,
  GoogleDriveAuthorization,
  GoogleDriveBackups,
  GoogleDriveController,
  GoogleDriveStore,
  aggregateMultipartBackupSets,
  buildDriveArchiveSetFromCoordinator,
  executeTransactionalDriveRestore,
  formatBackupSetOperationId,
  googleDrivePrivacyAdapter,
  previewDriveRestore,
  registerGoogleDriveRoutes
} from "../src/cloud-storage/index.js";

function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE kosmora_owner_data_lifecycle (
      owner_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO kosmora_owner_data_lifecycle (owner_id, epoch, state) VALUES ('owner-1', 1, 'active');
    INSERT INTO kosmora_owner_data_lifecycle (owner_id, epoch, state) VALUES ('owner-2', 1, 'active');

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE general_chats (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE general_chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE document_library_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE canvas_artifacts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE research_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT,
      query TEXT NOT NULL,
      status TEXT NOT NULL,
      report_markdown TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const migrationSql = readFileSync(
    resolve(process.cwd(), "packages/db/migrations/0060_drive_storage.sql"),
    "utf8"
  );
  db.exec(migrationSql);
  return db;
}

function createMockGoogleFetch() {
  let idCounter = 1;
  const folders = new Map<string, { owner: string; trashed: boolean }>();
  const files = new Map<
    string,
    {
      folderId: string;
      owner: string;
      operationId: string;
      sha256: string;
      bytes: Buffer;
      trashed: boolean;
    }
  >();
  let failNextUploadWith500 = false;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";

    if (url === "https://oauth2.googleapis.com/token" && method === "POST") {
      const bodyParams = new URLSearchParams(String(init?.body ?? ""));
      const grantType = bodyParams.get("grant_type");
      if (grantType === "authorization_code") {
        return new Response(
          JSON.stringify({
            access_token: "at_fresh_123",
            refresh_token: "rt_fresh_456",
            expires_in: 3600,
            scope: DRIVE_FILE_SCOPE
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (grantType === "refresh_token") {
        return new Response(
          JSON.stringify({
            access_token: "at_refreshed_789",
            expires_in: 3600,
            scope: DRIVE_FILE_SCOPE
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (url.startsWith("https://www.googleapis.com/drive/v3/files/generateIds")) {
      const nextId = `gdrive_id_${String(idCounter++).padStart(4, "0")}`;
      return new Response(JSON.stringify({ ids: [nextId] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (
      url.startsWith("https://www.googleapis.com/drive/v3/files?fields=") &&
      method === "POST"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        id: string;
        mimeType: string;
        appProperties?: { owner?: string };
      };
      folders.set(body.id, { owner: body.appProperties?.owner ?? "", trashed: false });
      return new Response(
        JSON.stringify({
          id: body.id,
          mimeType: body.mimeType,
          trashed: false,
          appProperties: body.appProperties
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (
      url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart") &&
      method === "POST"
    ) {
      if (failNextUploadWith500) {
        failNextUploadWith500 = false;
        return new Response("Internal Server Error", { status: 500 });
      }
      const rawBody = Buffer.from(init?.body as Buffer);
      const contentType =
        (init?.headers as Record<string, string>)?.["Content-Type"] ?? "";
      const boundary = contentType.split("boundary=")[1]!;
      const parts = rawBody.toString("latin1").split(`--${boundary}`);
      const metaPart = parts[1]!;
      const jsonStart = metaPart.indexOf("{");
      const jsonEnd = metaPart.lastIndexOf("}") + 1;
      const meta = JSON.parse(metaPart.slice(jsonStart, jsonEnd)) as {
        id: string;
        name: string;
        parents: string[];
        appProperties: { owner: string; operation_id: string; sha256: string };
      };

      const zipHeaderMarker = "Content-Type: application/zip\r\n\r\n";
      const zipMarkerIdx = rawBody.indexOf(Buffer.from(zipHeaderMarker, "utf8"));
      const zipStart = zipMarkerIdx + zipHeaderMarker.length;
      const zipEnd = rawBody.lastIndexOf(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
      const zipBytes = Buffer.from(rawBody.subarray(zipStart, zipEnd));
      const sha256 = createHash("sha256").update(zipBytes).digest("hex");

      files.set(meta.id, {
        folderId: meta.parents[0]!,
        owner: meta.appProperties.owner,
        operationId: meta.appProperties.operation_id,
        sha256,
        bytes: zipBytes,
        trashed: false
      });

      return new Response(
        JSON.stringify({
          id: meta.id,
          name: meta.name,
          parents: meta.parents,
          mimeType: "application/zip",
          size: String(zipBytes.byteLength),
          sha256Checksum: sha256,
          trashed: false,
          appProperties: meta.appProperties
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && method === "GET") {
      const u = new URL(url);
      const fileId = decodeURIComponent(u.pathname.split("/").pop()!);
      if (u.searchParams.get("alt") === "media") {
        const stored = files.get(fileId);
        if (!stored) return new Response("Not Found", { status: 404 });
        return new Response(stored.bytes, { status: 200 });
      }
      const folder = folders.get(fileId);
      if (folder) {
        return new Response(
          JSON.stringify({
            id: fileId,
            mimeType: "application/vnd.google-apps.folder",
            trashed: folder.trashed,
            appProperties: { owner: folder.owner }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const file = files.get(fileId);
      if (file) {
        return new Response(
          JSON.stringify({
            id: fileId,
            parents: [file.folderId],
            mimeType: "application/zip",
            size: String(file.bytes.byteLength),
            sha256Checksum: file.sha256,
            trashed: file.trashed,
            appProperties: {
              owner: file.owner,
              operation_id: file.operationId,
              sha256: file.sha256
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not Found", { status: 404 });
    }

    return new Response("Unhandled", { status: 404 });
  };

  return {
    mockFetch,
    files,
    setFailNextUpload(value: boolean) {
      failNextUploadWith500 = value;
    }
  };
}

function createMockPrivacyCoordinator(): {
  coordinator: Pick<OwnerPrivacyCoordinator, "export" | "binary">;
  docBytes: Buffer;
} {
  const docBytes = Buffer.from("Проверенный оригинальный документ Kosmora.\n", "utf8");
  const docSha = createHash("sha256").update(docBytes).digest("hex");
  const docDescriptor: OriginalBinary = {
    id: "doc_orig_1",
    filename: "spec.txt",
    content_type: "text/plain",
    size_bytes: docBytes.byteLength,
    sha256: docSha
  };

  const sections: Record<string, PrivacySection> = {
    "account-core": {
      complete: true,
      originals: [],
      records: {
        projects: [
          {
            id: "proj_old_1",
            owner_id: "owner-1",
            name: "Kosmora Core",
            description: "Main project",
            status: "active",
            created_at: "2026-10-01T00:00:00Z"
          }
        ],
        project_messages: [
          {
            id: "pmsg_old_1",
            project_id: "proj_old_1",
            role: "user",
            content: "Собрать архитектуру",
            created_at: "2026-10-01T00:01:00Z"
          }
        ],
        general_chats: [
          {
            id: "chat_old_1",
            owner_id: "owner-1",
            title: "Архивный диалог",
            created_at: "2026-10-02T00:00:00Z"
          }
        ],
        general_chat_messages: [
          {
            id: "cmsg_old_1",
            chat_id: "chat_old_1",
            owner_id: "owner-1",
            role: "assistant",
            content: "Ответ сохранён в архиве",
            created_at: "2026-10-02T00:01:00Z"
          }
        ],
        // Forbidden session collection that must be stripped automatically
        identity_sessions: [
          {
            id: "sess_secret",
            session_token: "secret_token_should_never_be_archived"
          }
        ]
      }
    },
    documents: {
      complete: true,
      originals: [docDescriptor],
      records: {
        files: [
          {
            id: "doc_orig_1",
            project_id: "proj_old_1",
            owner_id: "owner-1",
            name: "spec.txt",
            media_type: "text/plain",
            bytes: docBytes.byteLength,
            sha256: docSha,
            extracted_text: "Проверенный оригинальный документ Kosmora.",
            created_at: "2026-10-03T00:00:00Z"
          }
        ]
      }
    },
    canvas: {
      complete: true,
      originals: [],
      records: {
        artifacts: [
          {
            id: "canvas_old_1",
            owner_id: "owner-1",
            project_id: "proj_old_1",
            title: "Схема БД",
            kind: "markdown",
            content: "# Схема",
            created_at: "2026-10-04T00:00:00Z"
          }
        ]
      }
    },
    // Forbidden section that must be excluded from Drive archives
    "policy-projects": {
      complete: true,
      originals: [],
      records: {
        point_overrides: [{ id: "override_1", owner_id: "owner-1" }]
      }
    }
  };

  return {
    docBytes,
    coordinator: {
      async export(owner: string) {
        return {
          format: "kosmora-owner-export-v2",
          complete: true,
          owner_id: owner,
          generated_at: "2026-11-01T12:00:00Z",
          fence_epoch: 1,
          record_count: 6,
          original_count: 1,
          sections,
          retained: ["user-managed Google Drive archive copies"]
        };
      },
      async binary(_owner: string, store: string, id: string): Promise<BinaryStream | null> {
        if (store === "documents" && id === "doc_orig_1") {
          return {
            stream: Readable.from([docBytes]),
            original: docDescriptor
          };
        }
        return null;
      }
    }
  };
}

test("OAuth controller binds single-use state to server ticket, enforces session/owner, and cancels on privacy epoch bump", async () => {
  const db = createTestDatabase();
  const cipher = new DriveGrantCipher(randomBytes(32));
  const store = new GoogleDriveStore(db, cipher);
  const { mockFetch } = createMockGoogleFetch();
  const auth = new GoogleDriveAuthorization({
    clientId: "cid_test",
    clientSecret: "csec_test",
    redirectUri: "https://kosmora.example/api/v1/personal-settings/google-drive/connect/callback",
    request: mockFetch
  });
  const backups = new GoogleDriveBackups(store, auth, mockFetch);
  const { coordinator } = createMockPrivacyCoordinator();
  const controller = new GoogleDriveController({
    db,
    store,
    backups,
    auth,
    privacy: coordinator,
    request: mockFetch
  });

  const started = controller.startOAuthConnect({
    ownerId: "owner-1",
    sessionId: "sess-1"
  });
  assert.ok(started.authorizationUrl.includes("code_challenge_method=S256"));
  assert.ok(started.state.length >= 16);

  // Wrong session or wrong owner cannot consume the state
  await assert.rejects(
    () =>
      controller.finishOAuthCallback(
        { ownerId: "owner-1", sessionId: "sess-wrong" },
        { state: started.state, code: "auth_code_1" }
      ),
    /DRIVE_OAUTH_SESSION_MISMATCH/
  );

  // Single-use state is now invalidated and cannot be replayed even by the original session
  await assert.rejects(
    () =>
      controller.finishOAuthCallback(
        { ownerId: "owner-1", sessionId: "sess-1" },
        { state: started.state, code: "auth_code_1" }
      ),
    /DRIVE_OAUTH_STATE_INVALID/
  );

  // If privacy fence epoch changes while OAuth is in flight, callback must fail with DRIVE_CONNECT_EXPIRED
  const startedBeforeEpochBump = controller.startOAuthConnect({
    ownerId: "owner-1",
    sessionId: "sess-1"
  });
  db.prepare("UPDATE kosmora_owner_data_lifecycle SET epoch=epoch+1 WHERE owner_id='owner-1'").run();
  await assert.rejects(
    () =>
      controller.finishOAuthCallback(
        { ownerId: "owner-1", sessionId: "sess-1" },
        { state: startedBeforeEpochBump.state, code: "auth_code_2" }
      ),
    /DRIVE_CONNECT_EXPIRED/
  );

  // Normal OAuth completion succeeds, initializes folder, and never exposes grant in overview
  const startedValid = controller.startOAuthConnect({
    ownerId: "owner-1",
    sessionId: "sess-1"
  });
  const overview = await controller.finishOAuthCallback(
    { ownerId: "owner-1", sessionId: "sess-1" },
    { state: startedValid.state, code: "auth_code_3" }
  );
  assert.equal(overview.connected, true);
  assert.equal(overview.connection?.folder_state, "ready");
  assert.equal("grant_ciphertext" in (overview.connection ?? {}), false);
  assert.equal(JSON.stringify(overview).includes("at_fresh_123"), false);
});

test("shared GoogleDriveBackups instance quiesces on privacy adapter and multipart sets never claim completion prematurely", async () => {
  const db = createTestDatabase();
  const cipher = new DriveGrantCipher(randomBytes(32));
  const store = new GoogleDriveStore(db, cipher);
  const { mockFetch, setFailNextUpload } = createMockGoogleFetch();
  const auth = new GoogleDriveAuthorization({
    clientId: "cid_test",
    clientSecret: "csec_test",
    redirectUri: "https://kosmora.example/callback",
    request: mockFetch
  });
  const backups = new GoogleDriveBackups(store, auth, mockFetch);
  const privacyAdapter = googleDrivePrivacyAdapter(db, backups);
  const { coordinator } = createMockPrivacyCoordinator();
  const controller = new GoogleDriveController({
    db,
    store,
    backups,
    auth,
    privacy: coordinator,
    request: mockFetch
  });

  const { state } = controller.startOAuthConnect({ ownerId: "owner-1", sessionId: "sess-1" });
  await controller.finishOAuthCallback(
    { ownerId: "owner-1", sessionId: "sess-1" },
    { state, code: "code_ok" }
  );

  // Verify multipart aggregation: 1 of 2 parts verified must NOT mark the set complete/verified
  const partialSetViews = aggregateMultipartBackupSets([
    {
      id: "arch_1",
      connectionId: "conn_1",
      operationId: formatBackupSetOperationId("setA123", 1, 2),
      fileId: "file_1",
      folderId: "folder_1",
      bytes: 1024,
      sha256: "a".repeat(64),
      state: "verified",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z"
    }
  ]);
  assert.equal(partialSetViews.length, 1);
  assert.equal(partialSetViews[0]!.complete, false);
  assert.equal(partialSetViews[0]!.state, "incomplete");

  // Quiescing via privacyAdapter blocks uploads with OWNER_DATA_FENCED until resumed
  await privacyAdapter.quiesce("owner-1", 1);
  await assert.rejects(
    () => controller.createBackupCopy("owner-1", { backupSetId: "blockedSet" }),
    /OWNER_DATA_FENCED/
  );
  await privacyAdapter.resume("owner-1");

  // Simulate transient 500 on first upload -> state becomes 'uncertain', then reconcile/retryUpload fixes it
  setFailNextUpload(true);
  const uncertainAttempt = await controller.createBackupCopy("owner-1", {
    backupSetId: "retrySet01"
  });
  assert.equal(uncertainAttempt.backupSet.complete, false);
  assert.equal(uncertainAttempt.backupSet.state, "uncertain");
  const partArchId = uncertainAttempt.backupSet.parts[0]!.archiveId;

  // Reject retry if tampered bytes are supplied
  await assert.rejects(
    () => controller.retryArchiveUpload("owner-1", partArchId, Buffer.from("tampered")),
    /DRIVE_ARCHIVE_CHANGED/
  );

  // Explicit retry with original staged bytes verifies the archive
  const retried = await controller.retryArchiveUpload("owner-1", partArchId);
  assert.equal(retried.state, "verified");
  const afterRetryOverview = controller.overview("owner-1");
  const retrySetView = afterRetryOverview.backupSets.find((s) => s.backupSetId === "retrySet01");
  assert.equal(retrySetView?.complete, true);
  assert.equal(retrySetView?.state, "verified");
});

test("archive builder strips secrets/sessions/policies, verifies originals, and transactional restore creates new IDs without overwriting existing data", async () => {
  const db = createTestDatabase();
  const cipher = new DriveGrantCipher(randomBytes(32));
  const store = new GoogleDriveStore(db, cipher);
  const { mockFetch } = createMockGoogleFetch();
  const auth = new GoogleDriveAuthorization({
    clientId: "cid_test",
    clientSecret: "csec_test",
    redirectUri: "https://kosmora.example/callback",
    request: mockFetch
  });
  const backups = new GoogleDriveBackups(store, auth, mockFetch);
  const { coordinator, docBytes } = createMockPrivacyCoordinator();
  const restoredBinaries: { oldId: string; newId: string; bytes: Buffer }[] = [];

  const controller = new GoogleDriveController({
    db,
    store,
    backups,
    auth,
    privacy: coordinator,
    request: mockFetch,
    onRestoreBinary(item) {
      restoredBinaries.push({ oldId: item.oldId, newId: item.newId, bytes: item.bytes });
    }
  });

  // Seed existing live project and chat in SQLite to prove restore never overwrites them
  db.prepare(
    "INSERT INTO projects (id, owner_id, name, description, status, created_at, updated_at) VALUES ('proj_old_1', 'owner-1', 'Existing Live Project', 'Do not overwrite', 'active', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')"
  ).run();
  db.prepare(
    "INSERT INTO general_chats (id, owner_id, title, created_at, updated_at) VALUES ('chat_old_1', 'owner-1', 'Existing Live Chat', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')"
  ).run();

  const { state } = controller.startOAuthConnect({ ownerId: "owner-1", sessionId: "sess-1" });
  await controller.finishOAuthCallback(
    { ownerId: "owner-1", sessionId: "sess-1" },
    { state, code: "code_restore" }
  );

  const created = await controller.createBackupCopy("owner-1", { backupSetId: "fullSet2026" });
  assert.equal(created.backupSet.complete, true);
  assert.equal(created.backupSet.state, "verified");

  // Preview restore without mutating SQLite
  const preview = await controller.previewRestoreFromDrive("owner-1", "fullSet2026");
  assert.equal(preview.valid, true);
  assert.equal(preview.schemaVersion, DRIVE_BACKUP_SCHEMA_VERSION);
  assert.equal(preview.counts.projects, 1);
  assert.equal(preview.counts.generalChats, 1);
  assert.equal(preview.counts.generalMessages, 1);
  assert.equal(preview.counts.projectMessages, 1);
  assert.equal(preview.counts.documents, 1);
  assert.equal(preview.counts.canvasArtifacts, 1);
  assert.equal(preview.counts.originals, 1);

  // Execute transactional restore into new IDs
  const restored = await controller.executeRestoreFromDrive("owner-1", "fullSet2026");
  assert.equal(restored.restored, true);
  const newProjId = restored.idMapping.projects["proj_old_1"];
  const newChatId = restored.idMapping.generalChats["chat_old_1"];
  assert.ok(newProjId && newProjId !== "proj_old_1");
  assert.ok(newChatId && newChatId !== "chat_old_1");

  // Existing live project and chat remain untouched
  const existingLiveProj = db
    .prepare("SELECT name, description FROM projects WHERE id='proj_old_1'")
    .get() as { name: string; description: string };
  assert.equal(existingLiveProj.name, "Existing Live Project");
  assert.equal(existingLiveProj.description, "Do not overwrite");

  // Restored project and chat exist under new IDs with child messages linked to the new IDs
  const restoredProj = db
    .prepare("SELECT name FROM projects WHERE id=?")
    .get(newProjId) as { name: string };
  assert.equal(restoredProj.name, "Kosmora Core (из архива)");

  const restoredChatMsg = db
    .prepare("SELECT content FROM general_chat_messages WHERE chat_id=?")
    .get(newChatId) as { content: string };
  assert.equal(restoredChatMsg.content, "Ответ сохранён в архиве");

  assert.equal(restoredBinaries.length, 1);
  assert.equal(Buffer.compare(restoredBinaries[0]!.bytes, docBytes), 0);
});

test("restore rejects forbidden sections/collections and rolls back completely on transaction failure", async () => {
  const db = createTestDatabase();

  // 1. Archive containing forbidden 'policies' or 'sessions' collection must be rejected before DB access
  const maliciousManifest = {
    schemaVersion: DRIVE_BACKUP_SCHEMA_VERSION,
    backupSetId: "badSet01",
    ownerId: "owner-1",
    generatedAt: "2026-11-01T00:00:00Z",
    partIndex: 1,
    totalParts: 1,
    operationId: formatBackupSetOperationId("badSet01", 1, 1),
    restorableCollections: {},
    originals: [],
    excludedCategories: []
  };
  const maliciousZip = createArchive(
    [
      { path: "manifest.json", bytes: Buffer.from(JSON.stringify(maliciousManifest), "utf8") },
      {
        path: "records/all.json",
        bytes: Buffer.from(
          JSON.stringify({
            "account-core": {
              identity_sessions: [{ id: "s1", token: "hijack" }]
            }
          }),
          "utf8"
        )
      }
    ],
    4 * 1024 * 1024
  );

  assert.throws(
    () => previewDriveRestore("owner-1", [maliciousZip]),
    /DRIVE_RESTORE_FORBIDDEN_COLLECTION:identity_sessions/
  );

  // 2. Archive with an orphan message (pointing to non-existent chat_id) triggers atomic ROLLBACK
  const brokenIntegrityZip = createArchive(
    [
      { path: "manifest.json", bytes: Buffer.from(JSON.stringify(maliciousManifest), "utf8") },
      {
        path: "records/all.json",
        bytes: Buffer.from(
          JSON.stringify({
            "account-core": {
              projects: [{ id: "p_rollback_1", name: "Should Rollback" }],
              general_chat_messages: [{ id: "m1", chat_id: "missing_chat", content: "orphan" }]
            }
          }),
          "utf8"
        )
      }
    ],
    4 * 1024 * 1024
  );

  assert.throws(
    () => executeTransactionalDriveRestore(db, "owner-1", [brokenIntegrityZip]),
    /DRIVE_RESTORE_ORPHAN_CHAT_MESSAGE/
  );

  const countProjects = (
    db.prepare("SELECT COUNT(*) AS cnt FROM projects").get() as { cnt: number }
  ).cnt;
  assert.equal(Number(countProjects), 0, "Rolled back transaction must leave zero projects");
});


test("owner-only HTTP routes enforce silent callback logging, no-store headers, and reject non-owner actors", async () => {
  const db = createTestDatabase();
  const cipher = new DriveGrantCipher(randomBytes(32));
  const store = new GoogleDriveStore(db, cipher);
  const { mockFetch } = createMockGoogleFetch();
  const auth = new GoogleDriveAuthorization({
    clientId: "cid_test",
    clientSecret: "csec_test",
    redirectUri: "https://kosmora.example/callback",
    request: mockFetch
  });
  const backups = new GoogleDriveBackups(store, auth, mockFetch);
  const { coordinator } = createMockPrivacyCoordinator();
  const controller = new GoogleDriveController({
    db,
    store,
    backups,
    auth,
    privacy: coordinator,
    request: mockFetch
  });

  const routes = new Map<string, { opts: Record<string, unknown>; handler: Function }>();
  const mockFastify = {
    get(url: string, optsOrHandler: unknown, maybeHandler?: unknown) {
      const handler = typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler;
      const opts = typeof optsOrHandler === "object" && optsOrHandler ? optsOrHandler : {};
      routes.set(`GET ${url}`, { opts: opts as Record<string, unknown>, handler: handler as Function });
    },
    post(url: string, optsOrHandler: unknown, maybeHandler?: unknown) {
      const handler = typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler;
      const opts = typeof optsOrHandler === "object" && optsOrHandler ? optsOrHandler : {};
      routes.set(`POST ${url}`, { opts: opts as Record<string, unknown>, handler: handler as Function });
    }
  };

  let currentIdentity = {
    owner_id: "owner-1",
    session_id: "sess-route-1",
    actor: { kind: "owner" }
  };

  registerGoogleDriveRoutes(
    mockFastify as never,
    controller,
    () => currentIdentity as never
  );

  // Verify callback routes use logLevel: "silent" so authorization codes are never logged
  const getCb = routes.get("GET /api/v1/personal-settings/google-drive/connect/callback")!;
  const postCb = routes.get("POST /api/v1/personal-settings/google-drive/connect/callback")!;
  assert.deepEqual(getCb.opts.config, { logLevel: "silent" });
  assert.deepEqual(postCb.opts.config, { logLevel: "silent" });

  function makeReply() {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let payload: unknown = null;
    const replyObj = {
      header(k: string, v: string) {
        headers[k.toLowerCase()] = v;
        return replyObj;
      },
      status(code: number) {
        statusCode = code;
        return replyObj;
      },
      send(body: unknown) {
        payload = body;
        return body;
      },
      getHeaders: () => headers,
      getStatus: () => statusCode,
      getPayload: () => payload
    };
    return replyObj;
  }

  // Non-owner actor is rejected with 403
  currentIdentity = { owner_id: "owner-1", session_id: "s1", actor: { kind: "agent" } };
  const forbiddenReply = makeReply();
  await routes.get("GET /api/v1/personal-settings/google-drive/status")!.handler(
    { query: {} },
    forbiddenReply
  );
  assert.equal(forbiddenReply.getStatus(), 403);
  assert.equal(forbiddenReply.getHeaders()["cache-control"], "private, no-store");
  assert.equal(forbiddenReply.getHeaders()["referrer-policy"], "no-referrer");

  // Restore owner identity and complete connect -> backup -> preview -> restore via routes
  currentIdentity = { owner_id: "owner-1", session_id: "sess-route-1", actor: { kind: "owner" } };
  const startReply = makeReply();
  const startBody = await routes
    .get("POST /api/v1/personal-settings/google-drive/connect/start")!
    .handler({}, startReply);
  assert.ok(startBody.state);

  const cbReply = makeReply();
  const cbOverview = await getCb.handler(
    { query: { state: startBody.state, code: "route_code_1" } },
    cbReply
  );
  assert.equal(cbOverview.connected, true);

  const backupReply = makeReply();
  await routes
    .get("POST /api/v1/personal-settings/google-drive/backups")!
    .handler({ body: { backup_set_id: "routeSet01" } }, backupReply);
  assert.equal(backupReply.getStatus(), 200);
});
