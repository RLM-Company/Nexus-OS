"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { createDownloadCenter } = require("../download-center.cjs");

const panelUrl = pathToFileURL(path.join(__dirname, "..", "downloads.html")).toString();
const panelEvent = { senderFrame: { url: panelUrl } };

function fakeItem(filename, savePath, received = 10, total = 20) {
  const emitter = new EventEmitter();
  let currentReceived = received;
  let currentTotal = total;
  return Object.assign(emitter, {
    cancelled: false,
    getFilename: () => filename,
    getReceivedBytes: () => currentReceived,
    getTotalBytes: () => currentTotal,
    getSavePath: () => savePath,
    setProgress(nextReceived, nextTotal = currentTotal) {
      currentReceived = nextReceived;
      currentTotal = nextTotal;
      emitter.emit("updated");
    },
    cancel() {
      this.cancelled = true;
      emitter.emit("done", {}, "cancelled");
    }
  });
}

test("downloads are isolated by verified owner and origin, and renderer list hides save paths", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-download-center-"));
  try {
    let origin = "https://kosmora.example";
    let epoch = 1;
    let owner = "owner-a";
    const activeDownloads = new Map();
    const opened = [];
    const revealed = [];
    const safeReport = path.join(dir, "report.pdf");
    const scriptFile = path.join(dir, "report.bat");
    fs.writeFileSync(safeReport, "pdf");
    fs.writeFileSync(scriptFile, "echo nope");

    const center = createDownloadCenter({
      profileDirectory: dir,
      getOrigin: () => origin,
      getIdentityEpoch: () => epoch,
      verifiedOwner: async () => owner,
      activeDownloads,
      getDownloadDirectory: () => dir,
      shell: {
        openPath: async (target) => {
          opened.push(target);
          return "";
        },
        showItemInFolder: (target) => revealed.push(target)
      }
    });

    const id1 = "11111111-1111-4111-8111-111111111111";
    const item1 = fakeItem("report.pdf", safeReport, 20, 20);
    activeDownloads.set(id1, item1);
    center.capture(id1, item1);
    await new Promise((resolve) => setImmediate(resolve));
    item1.emit("done", {}, "completed");

    const id2 = "22222222-2222-4222-8222-222222222222";
    const item2 = fakeItem("report.bat", scriptFile, 20, 20);
    activeDownloads.set(id2, item2);
    center.capture(id2, item2);
    await new Promise((resolve) => setImmediate(resolve));
    item2.emit("done", {}, "completed");

    const listA = await center.list(panelEvent);
    assert.equal(listA.ok, true);
    assert.equal(listA.items.length, 2);
    assert.equal(Object.hasOwn(listA.items[0], "savePath"), false);

    assert.deepEqual(await center.openItem(panelEvent, id1), { ok: true });
    assert.deepEqual(opened, [safeReport]);

    const blocked = await center.openItem(panelEvent, id2);
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /Запуск/);
    assert.equal(opened.length, 1);

    assert.deepEqual(await center.revealItem(panelEvent, id2), { ok: true });
    assert.deepEqual(revealed, [scriptFile]);

    owner = "owner-b";
    assert.deepEqual((await center.list(panelEvent)).items, []);
    assert.equal((await center.openItem(panelEvent, id1)).ok, false);

    owner = "owner-a";
    center.invalidate({ forget: true, origin, owner });
    assert.deepEqual((await center.list(panelEvent)).items, []);
    await assert.rejects(
      () => center.list({ senderFrame: { url: "https://kosmora.example" } }),
      /Untrusted/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a download finishing before owner verification keeps its actual terminal bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-download-fast-"));
  try {
    const file = path.join(dir, "archive.zip");
    fs.writeFileSync(file, "zip");
    let releaseOwner;
    const ownerGate = new Promise((resolve) => {
      releaseOwner = resolve;
    });
    const activeDownloads = new Map();
    const opened = [];
    const center = createDownloadCenter({
      profileDirectory: dir,
      getOrigin: () => "https://kosmora.example",
      getIdentityEpoch: () => 1,
      verifiedOwner: () => ownerGate,
      activeDownloads,
      getDownloadDirectory: () => dir,
      shell: {
        openPath: async (target) => {
          opened.push(target);
          return "";
        },
        showItemInFolder: () => {}
      }
    });

    const id = "33333333-3333-4333-8333-333333333333";
    const item = fakeItem("archive.zip", file, 0, 512);
    activeDownloads.set(id, item);
    center.capture(id, item);
    item.setProgress(512, 512);
    item.emit("done", {}, "completed");

    releaseOwner("owner-a");
    await new Promise((resolve) => setImmediate(resolve));

    const list = await center.list(panelEvent);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].status, "completed");
    assert.equal(list.items[0].receivedBytes, 512);
    assert.equal(list.items[0].totalBytes, 512);
    assert.deepEqual(await center.openItem(panelEvent, id), { ok: true });
    assert.deepEqual(opened, [file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an identity epoch change during verification cannot record the old download for the new owner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-download-epoch-"));
  try {
    let epoch = 1;
    let owner = "owner-a";
    let releaseOwner;
    const ownerGate = new Promise((resolve) => {
      releaseOwner = resolve;
    });
    const activeDownloads = new Map();
    const center = createDownloadCenter({
      profileDirectory: dir,
      getOrigin: () => "https://kosmora.example",
      getIdentityEpoch: () => epoch,
      verifiedOwner: () => ownerGate,
      activeDownloads,
      getDownloadDirectory: () => dir,
      shell: { openPath: async () => "", showItemInFolder: () => {} }
    });

    const id = "44444444-4444-4444-8444-444444444444";
    const item = fakeItem("secret.pdf", path.join(dir, "secret.pdf"), 10, 10);
    activeDownloads.set(id, item);
    center.capture(id, item);

    epoch = 2;
    owner = "owner-b";
    releaseOwner("owner-b");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(item.cancelled, true);
    const list = await center.list(panelEvent);
    assert.deepEqual(list.items, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
