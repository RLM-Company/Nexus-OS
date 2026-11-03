import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  buildCanonicalStoreZipSnapshot,
  GoogleDriveJournalRecoveryAndZipImporter
} from "../src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts";
import {
  estimateConversationWindowUsage,
  ProviderAuthenticityAuditor
} from "../../../packages/core/src/bpe-context-estimator-and-audit.ts";

test("rebuilds Drive backup catalog after local journal loss and imports external ZIP STORE archives into new IDs with quiesced runs", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const recovery = new GoogleDriveJournalRecoveryAndZipImporter(sqlite);

  const wfContent = "Опубликованный отчёт Work по архитектуре Kosmora";
  const wfSha256 = createHash("sha256").update(wfContent, "utf8").digest("hex");

  const validSnapshot = buildCanonicalStoreZipSnapshot(
    "snap-20261102-01",
    {
      ownerId: "owner-1",
      chats: [
        {
          id: "chat-src-1",
          title: "Стратегия восстановления Drive",
          created_at: "2026-11-01T10:00:00.000Z",
          updated_at: "2026-11-01T10:15:00.000Z"
        }
      ],
      messages: [
        {
          id: "msg-src-1",
          chat_id: "chat-src-1",
          role: "user",
          content: "Проверь восстановление каталога при полной утрате локального журнала.",
          status: "completed",
          created_at: "2026-11-01T10:01:00.000Z"
        },
        {
          id: "msg-src-2",
          chat_id: "chat-src-1",
          role: "assistant",
          content: "Незавершённый ответ во время обрыва...",
          status: "streaming",
          created_at: "2026-11-01T10:02:00.000Z"
        }
      ],
      workFiles: [
        {
          id: "wf-1",
          project_id: "proj-1",
          work_id: "work-1",
          name: "architecture-summary.md",
          content: wfContent,
          sha256: wfSha256,
          bytes: Buffer.byteLength(wfContent, "utf8"),
          created_at: "2026-11-01T10:10:00.000Z"
        }
      ]
    },
    "2026-11-02T01:00:00.000Z"
  );

  // Also build a foreign-owner archive that must be skipped during journal rebuild
  const foreignSnapshot = buildCanonicalStoreZipSnapshot("snap-foreign-99", {
    ownerId: "owner-2",
    chats: [],
    messages: []
  });

  // 1. Test Journal-Loss Folder Discovery & Rebuild
  const rebuildRes = await recovery.discoverAndRebuildDriveJournal("owner-1", [
    {
      driveFileId: "gdrive-zip-1",
      name: "kosmora-snap-20261102-01.zip",
      sizeBytes: validSnapshot.zipBuffer.byteLength,
      createdTime: "2026-11-02T01:00:00.000Z",
      downloadZipBytes: async () => validSnapshot.zipBuffer
    },
    {
      driveFileId: "gdrive-zip-foreign",
      name: "kosmora-snap-foreign.zip",
      sizeBytes: foreignSnapshot.zipBuffer.byteLength,
      createdTime: "2026-11-02T01:05:00.000Z",
      downloadZipBytes: async () => foreignSnapshot.zipBuffer
    },
    {
      driveFileId: "gdrive-zip-corrupt",
      name: "corrupt.zip",
      sizeBytes: 32,
      createdTime: "2026-11-02T01:06:00.000Z",
      downloadZipBytes: async () => Buffer.from("not-a-valid-zip-archive", "utf8")
    }
  ]);

  assert.equal(rebuildRes.rebuilt.length, 1);
  assert.equal(rebuildRes.rebuilt[0].snapshotId, "snap-20261102-01");
  assert.equal(rebuildRes.rebuilt[0].status, "verified");
  assert.deepEqual(rebuildRes.skippedCorruptOrForeign, [
    "gdrive-zip-foreign",
    "gdrive-zip-corrupt"
  ]);

  // 2. Test External / Picker ZIP Snapshot Import into new isolated IDs
  const importRes = recovery.importExternalKosmoraZipSnapshot(
    "owner-1",
    validSnapshot.zipBuffer
  );

  assert.equal(importRes.restoredChatsCount, 1);
  assert.equal(importRes.restoredMessagesCount, 2);
  assert.equal(importRes.restoredWorkFilesCount, 1);
  assert.equal(importRes.interruptedRunsQuiesced, 1); // 'streaming' message was quiesced to 'cancelled'

  const newChatId = importRes.restoredChatIds["chat-src-1"];
  assert.ok(newChatId && newChatId !== "chat-src-1");

  const importedMsgs = sqlite
    .prepare(
      "SELECT role, status FROM general_chat_messages WHERE chat_id = ? ORDER BY created_at ASC"
    )
    .all(newChatId) as Array<{ role: string; status: string }>;

  assert.equal(importedMsgs.length, 2);
  assert.equal(importedMsgs[0].status, "completed");
  assert.equal(importedMsgs[1].status, "cancelled");
});

test("estimates calibrated BPE + image-tile tokens for the 1.05M Sol window and records provider authenticity probes", () => {
  const estimate = estimateConversationWindowUsage({
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    reservedOutputTokens: 8192,
    messages: [
      {
        role: "user",
        content:
          "Проверь калиброванный расчёт токенов для русского текста, кода TypeScript и вложенного изображения 1024x1024.",
        images: [{ width: 1024, height: 1024, detail: "high" }]
      }
    ]
  });

  // 1024x1024 scaled shortest side to 768 -> 768x768 -> 2x2 = 4 tiles -> 85 + 4*170 = 765 image tokens
  assert.equal(estimate.imageTokens, 765);
  assert.ok(estimate.textTokens > 25);
  assert.equal(estimate.fitsContextWindow, true);
  assert.equal(estimate.availableOutputTokens, 128_000);

  const auditor = new ProviderAuthenticityAuditor();
  auditor.recordAttestationProbe({
    runId: "probe-1",
    providerId: "cheapvibecode",
    modelRequested: "sol-1m",
    modelResolved: "sol-1m-2026",
    contextWindowTested: 64_000,
    expectedNeedle: "KOSMORA-NEEDLE-98412",
    requestPayload: "long context ... KOSMORA-NEEDLE-98412 ...",
    responsePayload: "Найденный маркер: KOSMORA-NEEDLE-98412",
    latencyMs: 1420
  });

  auditor.recordAttestationProbe({
    runId: "probe-2",
    providerId: "cheapvibecode",
    modelRequested: "sol-1m",
    modelResolved: "sol-1m-2026",
    contextWindowTested: 128_000,
    expectedNeedle: "KOSMORA-NEEDLE-99999",
    requestPayload: "long context ...",
    responsePayload: "",
    latencyMs: 5000,
    transportErrorCode: "UPSTREAM_SOCKET_HANGUP"
  });

  const summary = auditor.summarizeAudit();
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.passedRuns, 1);
  assert.equal(summary.transportFailures, 1);
  assert.equal(summary.maxVerifiedContextTokens, 64_000);
});
