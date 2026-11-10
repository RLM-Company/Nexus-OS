import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GoogleDriveImmutableSpooler } from "../src/cloud-storage/google-drive-immutable-spooler.ts";

test("spools archive bytes to disk, retries transient 429/503 errors without re-supplying payload, and prunes old archives", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const spoolDir = mkdtempSync(join(tmpdir(), "kosmora-drive-spool-test-"));

  try {
    const spooler = new GoogleDriveImmutableSpooler(sqlite, {
      spoolRoot: spoolDir,
      maxOwnerSpoolBytes: 1024 * 1024,
      maxRetainedBackups: 2
    });

    const payload = Buffer.from(
      JSON.stringify({
        ownerId: "owner-1",
        chat: { id: "chat-orig-1", title: "Архитектурный чат" },
        messages: [
          {
            id: "m-10",
            role: "user",
            content: "Сохрани неизменяемый архив в Google Drive с поддержкой повторной отправки."
          }
        ]
      }),
      "utf8"
    );

    const meta = spooler.spoolArchive({
      ownerId: "owner-1",
      backupId: "bkp-1",
      payload,
      pinned: true
    });
    assert.equal(meta.sizeBytes, payload.byteLength);
    assert.ok(spooler.getOwnerActiveSpoolBytes("owner-1") > 0);

    // Simulate 2 transient failures (429 rate limit, 503 unavailable) followed by success on attempt 3
    let calls = 0;
    const uploadRes = await spooler.dispatchOrRetrySpooledBackup(
      "owner-1",
      "bkp-1",
      async (bytes, sha256) => {
        calls++;
        assert.equal(bytes.equals(payload), true);
        assert.equal(sha256, meta.sha256);
        if (calls === 1) {
          const err = new Error("Rate limited") as Error & { status?: number; code?: string };
          err.status = 429;
          err.code = "DRIVE_RATE_LIMITED";
          throw err;
        }
        if (calls === 2) {
          const err = new Error("Gateway timeout") as Error & { status?: number; code?: string };
          err.status = 503;
          err.code = "DRIVE_TIMEOUT";
          throw err;
        }
        return { driveFileId: "gdrive-file-101" };
      },
      { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 40 }
    );

    assert.equal(uploadRes.driveFileId, "gdrive-file-101");
    assert.equal(uploadRes.attemptsUsed, 3);
    // Spool file is cleaned up after successful completion
    assert.equal(spooler.getOwnerActiveSpoolBytes("owner-1"), 0);

    // Add 3 unpinned completed backups to verify retention pruning (maxRetainedBackups = 2)
    for (let i = 2; i <= 4; i++) {
      spooler.spoolArchive({
        ownerId: "owner-1",
        backupId: `bkp-${i}`,
        payload,
        pinned: false
      });
      await spooler.dispatchOrRetrySpooledBackup(
        "owner-1",
        `bkp-${i}`,
        async () => ({ driveFileId: `gdrive-file-10${i}` })
      );
    }

    const deletedRemoteIds: string[] = [];
    const pruneRes = await spooler.enforceQuotaAndPruneOldArchives("owner-1", async (fid) => {
      deletedRemoteIds.push(fid);
    });

    // bkp-1 is pinned (kept), bkp-4 and bkp-3 are the 2 newest unpinned (kept), bkp-2 is pruned!
    assert.deepEqual(pruneRes.prunedDriveBackups, ["bkp-2"]);
    assert.deepEqual(deletedRemoteIds, ["gdrive-file-102"]);
  } finally {
    rmSync(spoolDir, { recursive: true, force: true });
  }
});

test("restores a Google Drive archive into a brand-new isolated chat without mutating the original chat", () => {
  const sqlite = new DatabaseSync(":memory:");
  const spoolDir = mkdtempSync(join(tmpdir(), "kosmora-drive-restore-new-"));

  try {
    const spooler = new GoogleDriveImmutableSpooler(sqlite, { spoolRoot: spoolDir });

    // Seed original live chat on server
    sqlite
      .prepare(
        "INSERT INTO general_chats (id, owner_id, title, created_at, updated_at) VALUES ('chat-live-1', 'owner-1', 'Живой чат', '2026-10-30T10:00:00.000Z', '2026-10-30T10:00:00.000Z')"
      )
      .run();

    const archiveBytes = Buffer.from(
      JSON.stringify({
        ownerId: "owner-1",
        chat: { id: "chat-live-1", title: "Живой чат" },
        messages: [
          {
            id: "old-m-1",
            role: "user",
            content: "Первый вопрос из архивной копии Drive"
          },
          {
            id: "old-m-2",
            role: "assistant",
            content: "Ответ ассистента из архивной копии Drive"
          }
        ]
      }),
      "utf8"
    );
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");

    const restored = spooler.restoreArchiveIntoNewChat({
      ownerId: "owner-1",
      backupId: "bkp-restore-99",
      expectedSha256: sha256,
      archiveJsonBytes: archiveBytes
    });

    assert.notEqual(restored.newChatId, "chat-live-1");
    assert.equal(restored.originalChatId, "chat-live-1");
    assert.equal(restored.restoredMessagesCount, 2);
    assert.match(restored.title, /восстановлено из Drive/);

    // Original chat still has 0 messages (unmodified), while newChatId has 2 restored messages
    const origMsgs = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM general_chat_messages WHERE chat_id = 'chat-live-1'")
      .get() as { cnt: number };
    const newMsgs = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM general_chat_messages WHERE chat_id = ?")
      .get(restored.newChatId) as { cnt: number };

    assert.equal(origMsgs.cnt, 0);
    assert.equal(newMsgs.cnt, 2);
  } finally {
    rmSync(spoolDir, { recursive: true, force: true });
  }
});
