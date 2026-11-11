"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createDownloadCenter } = require("../download-center.cjs");

class TestWindow extends EventEmitter {
  static windows = [];
  constructor(options) {
    super();
    this.options = options;
    this.dead = false;
    this.webContents = new EventEmitter();
    this.webContents.mainFrame = { url: "" };
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.getURL = () => this.url || "";
    this.webContents.send = (channel, entries) => {
      this.sent = { channel, entries };
    };
    TestWindow.windows.push(this);
  }
  async loadURL(url) {
    this.url = url;
    this.webContents.mainFrame.url = url;
    this.webContents.emit("did-finish-load");
  }
  isDestroyed() {
    return this.dead;
  }
  show() {
    this.shown = true;
  }
  focus() {
    this.focused = true;
  }
  destroy() {
    this.dead = true;
    this.emit("closed");
  }
}
class Item extends EventEmitter {
  constructor(name, file, url = "https://kosmora.test/files/report.pdf") {
    super();
    this.name = name;
    this.file = file;
    this.received = 0;
    this.total = 0;
    this.urls = [url];
  }
  getURL() {
    return this.urls[this.urls.length - 1];
  }
  getURLChain() {
    return this.urls.slice();
  }
  getFilename() {
    return this.name;
  }
  getReceivedBytes() {
    return this.received;
  }
  getTotalBytes() {
    return this.total;
  }
  getSavePath() {
    return this.file;
  }
  cancel() {
    this.cancelled = true;
    this.emit("done", {}, "cancelled");
  }
  finish(state = "completed") {
    this.emit("done", {}, state);
  }
}

async function fixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-center-test-"));
  const handlers = new Map();
  let currentOwner = "alice";
  let origin = "https://kosmora.test";
  let epoch = 1;
  const shown = [];
  const active = new Map();
  let count = 0;
  let mainWindow = { type: "remote" };
  const center = createDownloadCenter({
    BrowserWindow: TestWindow,
    ipcMain: {
      handle: (channel, fn) => {
        assert.ok(!handlers.has(channel));
        handlers.set(channel, fn);
      }
    },
    shell: {
      showItemInFolder: (target) => shown.push(target),
      openPath: () => assert.fail("must never open files")
    },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    profileDirectory: directory,
    getOrigin: () => origin,
    getIdentityEpoch: () => epoch,
    verifiedOwner: async () => currentOwner,
    getMainWindow: () => mainWindow,
    activeDownloads: active,
    onChange: () => {
      count++;
    }
  });
  const invoke = (channel, event, ...args) =>
    handlers.get(`cosmora:downloads:${channel}`)(event, ...args);
  try {
    await callback({
      directory,
      center,
      invoke,
      active,
      shown,
      count: () => count,
      setOwner: (name) => {
        currentOwner = name;
      },
      setMainWindow: (value) => {
        mainWindow = value;
      },
      setOrigin: (value) => {
        origin = value;
      },
      bumpEpoch: () => epoch++,
      lastWindow: () => TestWindow.windows.at(-1),
      trustedEvent: () => {
        const w = TestWindow.windows.at(-1);
        return {
          sender: w.webContents,
          senderFrame: w.webContents.mainFrame
        };
      }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("sandboxed window, exact main-frame IPC, no arbitrary filesystem bridge", async () =>
  fixture(async (t) => {
    assert.equal(await t.center.show(), true);
    const w = t.lastWindow();
    assert.equal(w.options.webPreferences.sandbox, true);
    assert.equal(w.options.webPreferences.contextIsolation, true);
    assert.equal(w.options.webPreferences.nodeIntegration, false);
    assert.match(w.url, /^file:/);
    assert.equal((await t.invoke("list", t.trustedEvent())).ok, true);
    assert.equal((await t.invoke("list", { sender: {}, senderFrame: {} })).ok, false);
    assert.equal(
      (await t.invoke("list", { sender: w.webContents, senderFrame: { url: w.url } })).ok,
      false
    );
    w.webContents.mainFrame.url = "file:///tmp/other.html";
    assert.equal((await t.invoke("list", t.trustedEvent())).ok, false);
  }));

test("byte accuracy, cancel owned ID, no foreign ID or file access", async () =>
  fixture(async (t) => {
    await t.center.show();
    const id = randomUUID();
    const item = new Item("draft.pdf", path.join(t.directory, "draft.pdf"));
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    item.received = 64;
    item.total = 512;
    item.emit("updated");
    const entries = (await t.invoke("list", t.trustedEvent())).entries;
    assert.equal(entries[0].receivedBytes, 64);
    assert.equal(entries[0].totalBytes, 512);
    assert.equal(Object.hasOwn(entries[0], "savePath"), false);
    assert.equal((await t.invoke("cancel", t.trustedEvent(), randomUUID())).ok, false);
    assert.equal((await t.invoke("reveal", t.trustedEvent(), id)).ok, false);
    assert.equal((await t.invoke("cancel", t.trustedEvent(), id)).ok, true);
    assert.equal(item.cancelled, true);
    assert.equal((await t.invoke("list", t.trustedEvent())).entries[0].status, "cancelled");
    assert.equal((await t.invoke("clear", t.trustedEvent())).ok, true);
    assert.deepEqual((await t.invoke("list", t.trustedEvent())).entries, []);
  }));

test("reveal only exact, existing completed path using showItemInFolder", async () =>
  fixture(async (t) => {
    await t.center.show();
    const id = randomUUID();
    const destination = path.join(t.directory, "result.txt");
    fs.writeFileSync(destination, "exact");
    const item = new Item("result.txt", destination);
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    item.received = 5;
    item.total = 5;
    item.finish();
    assert.equal((await t.invoke("reveal", t.trustedEvent(), id)).ok, true);
    assert.deepEqual(t.shown, [destination]);
    fs.unlinkSync(destination);
    assert.equal((await t.invoke("reveal", t.trustedEvent(), id)).ok, false);
  }));

test("owner switch and server switch deny stale window and cancel old operations", async () =>
  fixture(async (t) => {
    await t.center.show();
    const old = t.trustedEvent();
    const id = randomUUID();
    const item = new Item("secret.zip", path.join(t.directory, "secret.zip"));
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    t.setOwner("bob");
    assert.equal((await t.invoke("list", old)).ok, false);
    t.center.invalidate({ forget: true, owner: "alice", origin: "https://kosmora.test" });
    assert.equal(item.cancelled, true);
    await t.center.show();
    assert.deepEqual((await t.invoke("list", t.trustedEvent())).entries, []);
    t.setOrigin("https://elsewhere.test");
    assert.equal((await t.invoke("clear", t.trustedEvent())).ok, false);
  }));

test("unknown owner means history window cannot open", async () =>
  fixture(async (t) => {
    t.setOwner(null);
    assert.equal(await t.center.show(), false);
  }));

test("a download finishing before owner verification keeps its actual terminal bytes", async () =>
  fixture(async (t) => {
    await t.center.show();
    const destination = path.join(t.directory, "tiny.txt");
    fs.writeFileSync(destination, "tiny");
    const id = randomUUID();
    const item = new Item("tiny.txt", destination);
    t.active.set(id, item);
    t.center.capture(id, item);
    item.received = 4;
    item.total = 4;
    item.finish(); // synchronous done, before the verification promise resumes
    await tick();
    const entries = (await t.invoke("list", t.trustedEvent())).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "completed");
    assert.equal(entries[0].receivedBytes, 4);
    assert.equal((await t.invoke("reveal", t.trustedEvent(), id)).ok, true);
  }));

test("an identity epoch change during verification cannot record the old download for the new owner", async () =>
  fixture(async (t) => {
    await t.center.show();
    const id = randomUUID();
    const item = new Item("old.txt", path.join(t.directory, "old.txt"));
    t.active.set(id, item);
    t.center.capture(id, item);
    t.setOwner("bob");
    t.bumpEpoch();
    await tick();
    assert.equal(item.cancelled, true);
    await t.center.show();
    assert.deepEqual((await t.invoke("list", t.trustedEvent())).entries, []);
  }));

const remoteMain = (downloaded, pageURL = "https://kosmora.test/app") => ({
  isDestroyed: () => false,
  webContents: {
    getURL: () => pageURL,
    downloadURL: (url) => downloaded.push(url)
  }
});

test("an interrupted download is retried from session memory through the owning window", async () =>
  fixture(async (t) => {
    await t.center.show();
    const downloaded = [];
    t.setMainWindow(remoteMain(downloaded));
    const id = randomUUID();
    const item = new Item("big.zip", path.join(t.directory, "big.zip"));
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    item.received = 128;
    item.total = 1024;
    item.finish("interrupted");
    const entries = (await t.invoke("list", t.trustedEvent())).entries;
    assert.equal(entries[0].status, "interrupted");
    assert.equal(entries[0].retryable, true);
    // No link persistence: the public entry and stored metadata never carry a URL.
    assert.equal(Object.hasOwn(entries[0], "url"), false);
    const stored = fs.readFileSync(path.join(t.directory, "download-history.json"), "utf8");
    assert.ok(!stored.includes("files/report.pdf"));
    assert.equal((await t.invoke("retry", t.trustedEvent(), id)).ok, true);
    assert.deepEqual(downloaded, ["https://kosmora.test/files/report.pdf"]);
  }));

test("retry denies completed, unknown and stale-owner/stale-origin sources", async () =>
  fixture(async (t) => {
    await t.center.show();
    const downloaded = [];
    t.setMainWindow(remoteMain(downloaded));
    const completedId = randomUUID();
    const completed = new Item("done.txt", path.join(t.directory, "done.txt"));
    t.active.set(completedId, completed);
    t.center.capture(completedId, completed);
    await tick();
    completed.finish();
    assert.equal((await t.invoke("retry", t.trustedEvent(), completedId)).ok, false);
    assert.equal((await t.invoke("retry", t.trustedEvent(), randomUUID())).ok, false);
    const staleId = randomUUID();
    const stale = new Item("stale.bin", path.join(t.directory, "stale.bin"));
    t.active.set(staleId, stale);
    t.center.capture(staleId, stale);
    await tick();
    stale.finish("interrupted");
    // Origin changed after the interruption: the remembered route is no longer current.
    t.setOrigin("https://elsewhere.test");
    assert.equal((await t.invoke("retry", t.trustedEvent(), staleId)).ok, false);
    // Owner switched: authorize re-verifies and the scope no longer matches.
    t.setOrigin("https://kosmora.test");
    t.setOwner("bob");
    assert.equal((await t.invoke("retry", t.trustedEvent(), staleId)).ok, false);
    assert.deepEqual(downloaded, []);
  }));

test("retry requires the main window to still show an allowed same-origin page", async () =>
  fixture(async (t) => {
    await t.center.show();
    const downloaded = [];
    const main = remoteMain(downloaded);
    t.setMainWindow(main);
    const id = randomUUID();
    const item = new Item("image.iso", path.join(t.directory, "image.iso"));
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    item.finish("interrupted");
    main.webContents.getURL = () => "https://elsewhere.test/other";
    assert.equal((await t.invoke("retry", t.trustedEvent(), id)).ok, false);
    main.webContents.getURL = () => "https://kosmora.test/app";
    main.isDestroyed = () => true;
    assert.equal((await t.invoke("retry", t.trustedEvent(), id)).ok, false);
    t.setMainWindow({ type: "remote" });
    assert.equal((await t.invoke("retry", t.trustedEvent(), id)).ok, false);
    assert.deepEqual(downloaded, []);
  }));

test("invalidate clears remembered retry routes", async () =>
  fixture(async (t) => {
    await t.center.show();
    const downloaded = [];
    t.setMainWindow(remoteMain(downloaded));
    const id = randomUUID();
    const item = new Item("gone.bin", path.join(t.directory, "gone.bin"));
    t.active.set(id, item);
    t.center.capture(id, item);
    await tick();
    item.finish("interrupted");
    t.center.invalidate({});
    await t.center.show();
    assert.equal((await t.invoke("retry", t.trustedEvent(), id)).ok, false);
    const entries = (await t.invoke("list", t.trustedEvent())).entries;
    assert.equal(entries.find((entry) => entry.id === id)?.retryable ?? false, false);
    assert.deepEqual(downloaded, []);
  }));
