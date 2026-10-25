"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { MAX_ENTRIES, createDownloadHistoryStore, downloadScope } = require("../download-history.cjs");

function fixture(fn) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-download-test-"));
  try { fn(folder); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
const scopeA = downloadScope("https://a.test", "owner-a");
const scopeB = downloadScope("https://a.test", "owner-b");
const scopeC = downloadScope("https://b.test", "owner-a");

test("scopes are opaque and owner/origin isolated", () => fixture(folder => {
  const store = createDownloadHistoryStore(folder);
  const a = randomUUID();
  assert.equal(store.start(scopeA, a, "private.pdf", 3, 10), true);
  assert.equal(store.list(scopeA).length, 1);
  assert.deepEqual(store.list(scopeB), []);
  assert.deepEqual(store.list(scopeC), []);
  assert.equal(store.savedPath(scopeB, a), null);
  assert.equal(store.finish(scopeB, a, "completed", 10, 10, path.join(folder, "private.pdf")), false);
  const persisted = fs.readFileSync(path.join(folder, "download-history.json"), "utf8");
  assert.ok(!persisted.includes("owner-a"));
  assert.ok(!persisted.includes("https://a.test"));
  assert.ok(!persisted.includes("auth-token"));
  assert.equal(JSON.parse(persisted).records[0].scope, scopeA);
}));

test("actual bytes, unknown totals, completed path privately held", () => fixture(folder => {
  const store = createDownloadHistoryStore(folder);
  const id = randomUUID();
  const saved = path.join(folder, "result.csv");
  assert.equal(store.start(scopeA, id, "result.csv", 0, null), true);
  assert.equal(store.progress(scopeA, id, 1536, 0), true);
  assert.deepEqual(store.list(scopeA)[0].totalBytes, null);
  assert.equal(store.finish(scopeA, id, "completed", 4096, 4096, saved), true);
  const publicEntry = store.list(scopeA)[0];
  assert.equal(publicEntry.receivedBytes, 4096);
  assert.equal(publicEntry.status, "completed");
  assert.equal(Object.hasOwn(publicEntry, "savePath"), false);
  assert.equal(Object.hasOwn(publicEntry, "scope"), false);
  assert.equal(store.savedPath(scopeA, id), saved);
  assert.equal(store.progress(scopeA, id, 5000, 6000), false);
  store.clearFinished(scopeB);
  assert.equal(store.list(scopeA).length, 1);
  store.clearFinished(scopeA);
  assert.deepEqual(store.list(scopeA), []);
}));

test("crash recovery marks active interrupted and never resumes", () => fixture(folder => {
  let store = createDownloadHistoryStore(folder);
  const id = randomUUID();
  store.start(scopeA, id, "unfinished.zip", 12, 2048);
  store = createDownloadHistoryStore(folder);
  const entry = store.list(scopeA)[0];
  assert.equal(entry.status, "interrupted");
  assert.equal(entry.receivedBytes, 12);
  assert.equal(store.savedPath(scopeA, id), null);
  assert.equal(store.finish(scopeA, id, "completed", 2048, 2048, "/tmp/trap"), false);
}));

test("50 globally bounded records; active records are never evicted silently", () => fixture(folder => {
  const store = createDownloadHistoryStore(folder);
  for (let i = 0; i < MAX_ENTRIES + 17; i++) {
    const id = randomUUID();
    assert.equal(store.start(scopeA, id, `report-${i}.pdf`), true);
    store.finish(scopeA, id, "cancelled", 0, null);
  }
  assert.equal(store.list(scopeA).length, MAX_ENTRIES);
  assert.equal(store.list(scopeA)[0].name, `report-${MAX_ENTRIES + 16}.pdf`);
  store.clearFinished(scopeA);
  for (let i = 0; i < MAX_ENTRIES; i++) assert.ok(store.start(scopeA, randomUUID(), `active-${i}`));
  assert.equal(store.start(scopeA, randomUUID(), "too-many"), false);
}));

test("tampered paths, IDs and leaked fields are never trusted", () => fixture(folder => {
  const id = randomUUID();
  fs.writeFileSync(path.join(folder, "download-history.json"), JSON.stringify({ version: 1, records: [
    { id, scope: scopeA, name: "valid.txt", status: "completed", receivedBytes: 123,
      startedAt: 1, savePath: "relative/path", url: "https://a.test/?token=secret" },
    { id: "../../bad", scope: scopeA, name: "bad", status: "active", startedAt: 1 }
  ] }));
  const store = createDownloadHistoryStore(folder);
  assert.equal(store.list(scopeA).length, 1);
  assert.equal(store.list(scopeA)[0].status, "interrupted");
  assert.equal(store.savedPath(scopeA, id), null);
  const stored = fs.readFileSync(path.join(folder, "download-history.json"), "utf8");
  assert.ok(!stored.includes("token=secret"));
  assert.equal(store.finish(scopeA, "../../bad", "completed", 1, 1, "/a"), false);
}));

test("server filenames containing URLs or auth query fragments are redacted", () => fixture(folder => {
  const store = createDownloadHistoryStore(folder);
  const id = randomUUID();
  assert.equal(store.start(scopeA, id, "download?access_token=secret-value", 1, 0), true);
  assert.equal(store.list(scopeA)[0].name, "cosmora-download");
  const stored = fs.readFileSync(path.join(folder, "download-history.json"), "utf8");
  assert.ok(!stored.includes("secret-value"));
  assert.ok(!stored.includes("access_token"));
}));
