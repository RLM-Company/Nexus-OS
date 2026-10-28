"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDownloadHistoryStore } = require("../download-history.cjs");

const scopeA = crypto.createHash("sha256").update("https://kosmora.example\0owner-a").digest("hex");
const scopeB = crypto.createHash("sha256").update("https://kosmora.example\0owner-b").digest("hex");
const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

function withTempDir(run) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-download-history-"));
  try {
    return run(folder);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test("download history persists by scope, redacts paths from renderer entries, and recovers active items as interrupted", () =>
  withTempDir((folder) => {
    const first = createDownloadHistoryStore(folder);
    const saveFile = path.join(folder, "report.pdf");
    fs.writeFileSync(saveFile, "ok");

    assert.equal(first.start(scopeA, idA, 'bad<name>:"?.pdf', 12, 100), true);
    assert.equal(first.start(scopeA, idB, "unfinished.csv", 10, 50), true);
    first.progress(scopeA, idA, 55, 100);
    first.finish(scopeA, idA, "completed", 100, 100, saveFile);

    const visible = first.list(scopeA);
    assert.equal(visible.length, 2);
    assert.equal(visible.find((item) => item.id === idA).name, "bad_name____.pdf");
    assert.equal(Object.hasOwn(visible[0], "savePath"), false);
    assert.equal(Object.hasOwn(visible[0], "scope"), false);
    assert.equal(first.resolvePath(scopeA, idA), saveFile);
    assert.equal(first.resolvePath(scopeB, idA), null);
    assert.deepEqual(first.list(scopeB), []);

    const second = createDownloadHistoryStore(folder);
    const recovered = second.list(scopeA);
    assert.equal(recovered.find((item) => item.id === idB).status, "interrupted");
    assert.equal(second.resolvePath(scopeA, idB), null);
    assert.equal(second.resolvePath(scopeA, idA), saveFile);
  }));

test("tampered paths, IDs and leaked fields are never trusted", () =>
  withTempDir((folder) => {
    const validId = "33333333-3333-4333-8333-333333333333";
    fs.writeFileSync(
      path.join(folder, "download-history.json"),
      JSON.stringify({
        version: 1,
        records: [
          {
            id: validId,
            scope: scopeA,
            name: "bad/name.txt",
            status: "completed",
            receivedBytes: 1,
            totalBytes: 1,
            startedAt: "2026-10-10T00:00:00.000Z",
            finishedAt: "2026-10-10T00:00:01.000Z",
            savePath: "relative/path",
            url: "https://kosmora.example/secret?token=1"
          },
          {
            id: "not-a-uuid",
            scope: scopeA,
            name: "ignored.txt",
            status: "completed",
            startedAt: "2026-10-10T00:00:00.000Z"
          }
        ]
      })
    );
    const store = createDownloadHistoryStore(folder);
    const items = store.list(scopeA);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "bad_name.txt");
    assert.equal(items[0].status, "interrupted");
    assert.equal(store.resolvePath(scopeA, validId), null);
    assert.equal(
      fs.readFileSync(path.join(folder, "download-history.json"), "utf8").includes("secret"),
      false
    );
  }));

test("active downloads are not evicted when history is full", () =>
  withTempDir((folder) => {
    const store = createDownloadHistoryStore(folder);
    for (let i = 0; i < 50; i += 1) {
      const id = `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`;
      assert.equal(store.start(scopeA, id, `file-${i}.txt`, 0, 10), true);
    }
    const overflowId = "99999999-1111-4111-8111-111111111111";
    assert.equal(store.start(scopeA, overflowId, "overflow.txt", 0, 10), false);
    const firstId = "00000000-1111-4111-8111-111111111111";
    store.finish(scopeA, firstId, "completed", 10, 10, path.join(folder, "done.txt"));
    assert.equal(store.start(scopeA, overflowId, "overflow.txt", 0, 10), true);
    assert.equal(store.resolvePath(scopeA, firstId), null);
  }));
