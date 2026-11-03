"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const {
  attachDeterministicDownloadHandler,
  waitForVerifiedDownload
} = require("../browser/download-verifier.cjs");

test("waits for .crdownload partial file to finalize into result.txt before reading", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-dl-test-"));
  const partialPath = path.join(tmpDir, "result.txt.crdownload");
  const finalPath = path.join(tmpDir, "result.txt");

  fs.writeFileSync(partialPath, "partial-data", "utf8");

  setTimeout(() => {
    fs.writeFileSync(finalPath, "KOSWORK_UNIFIED_RESULT_OK=1\n", "utf8");
    fs.unlinkSync(partialPath);
  }, 90);

  const verified = await waitForVerifiedDownload({
    filename: "result.txt",
    primaryDir: tmpDir,
    expectedSubstring: "KOSWORK_UNIFIED_RESULT_OK=1",
    timeoutMs: 2000,
    pollIntervalMs: 25
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.reconciledFromFallback, false);
  assert.match(verified.content, /KOSWORK_UNIFIED_RESULT_OK=1/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("reconciles result.txt from fallback Downloads directory into primary fixture directory", async () => {
  const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-dl-primary-"));
  const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-dl-fallback-"));

  setTimeout(() => {
    fs.writeFileSync(path.join(fallbackDir, "result.txt"), "FALLBACK_DOWNLOAD_SUCCESS\n", "utf8");
  }, 60);

  const verified = await waitForVerifiedDownload({
    filename: "result.txt",
    primaryDir,
    fallbackDirs: [fallbackDir],
    expectedSubstring: "FALLBACK_DOWNLOAD_SUCCESS",
    timeoutMs: 2000,
    pollIntervalMs: 25
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.reconciledFromFallback, true);
  assert.equal(fs.existsSync(path.join(primaryDir, "result.txt")), true);
  assert.equal(fs.readFileSync(path.join(primaryDir, "result.txt"), "utf8"), "FALLBACK_DOWNLOAD_SUCCESS\n");

  fs.rmSync(primaryDir, { recursive: true, force: true });
  fs.rmSync(fallbackDir, { recursive: true, force: true });
});

test("attachDeterministicDownloadHandler synchronously sets savePath on will-download", () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-session-dl-"));
  const fakeSession = new EventEmitter();
  const handler = attachDeterministicDownloadHandler(fakeSession, { downloadDir });

  let assignedSavePath = null;
  const fakeItem = new EventEmitter();
  fakeItem.getFilename = () => "result.txt";
  fakeItem.setSavePath = (p) => {
    assignedSavePath = p;
  };

  fakeSession.emit("will-download", {}, fakeItem);
  assert.equal(assignedSavePath, path.join(downloadDir, "result.txt"));

  fakeItem.emit("done", {}, "completed");
  assert.equal(handler.completedDownloads.length, 1);
  assert.equal(handler.completedDownloads[0].filename, "result.txt");

  handler.detach();
  fs.rmSync(downloadDir, { recursive: true, force: true });
});
