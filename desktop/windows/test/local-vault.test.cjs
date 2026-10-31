"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { createLocalVault } = require("../local-vault.cjs");
const { createVaultConsole } = require("../vault-console.cjs");
const codec = {
  seal: (s) => Buffer.from(s).toString("base64"),
  open: (s) => Buffer.from(s, "base64").toString()
};
const alice = { origin: "https://kosmora.test", owner: "alice" };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-vault-test-"));
  const profile = path.join(dir, "profile"),
    folder = path.join(dir, "files");
  fs.mkdirSync(profile);
  fs.mkdirSync(folder);
  t.after(() => {
    assert.ok(
      path.dirname(dir) === fs.realpathSync(os.tmpdir()) || path.dirname(dir) === os.tmpdir()
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, profile, folder, vault: createLocalVault({ userDataPath: profile, codec }) };
}
test("stores exact originals, deduplicates, searches and restores a binding after restart", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const bytes = Buffer.from("Бюджет 17350.25. Не менять sidebar."),
    item = f.vault.put(alice, "план.md", bytes);
  assert.deepEqual(f.vault.get(alice, item.id).bytes, bytes);
  assert.equal(f.vault.put(alice, "копия.md", bytes).id, item.id);
  assert.equal(f.vault.list(alice).items.length, 1);
  assert.equal(f.vault.search(alice, "17350.25 sidebar").items[0].id, item.id);
  const restarted = createLocalVault({ userDataPath: f.profile, codec });
  assert.equal(restarted.list(alice).items[0].id, item.id);
  assert.match(restarted.context(alice, item.id), /цитируемые данные/);
});
test("isolates server and owner scopes; disconnect preserves files but revokes the binding", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const item = f.vault.put(alice, "note.txt", Buffer.from("private"));
  for (const c of [
    { ...alice, owner: "bob" },
    { ...alice, origin: "https://other.test" }
  ]) {
    assert.equal(f.vault.status(c).connected, false);
    f.vault.choose(c, f.folder);
    assert.equal(f.vault.list(c).items.length, 0);
    assert.throws(() => f.vault.get(c, item.id));
  }
  f.vault.disconnect(alice);
  assert.equal(f.vault.status(alice).connected, false);
  f.vault.choose(alice, f.folder);
  assert.equal(f.vault.get(alice, item.id).bytes.toString(), "private");
});
test("rejects traversal, sensitive names, excessive input and corrupted blobs", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  for (const name of ["../x", "C:\\x", ".env", "secret.key"])
    assert.throws(() => f.vault.put(alice, name, Buffer.from("x")));
  assert.throws(() => f.vault.put(alice, "large.txt", Buffer.alloc(10 * 1024 * 1024 + 1)));
  assert.throws(() => f.vault.get(alice, "../x"));
  const item = f.vault.put(alice, "x.txt", Buffer.from("exact"));
  const root = path.join(f.folder, fs.readdirSync(f.folder)[0]);
  fs.writeFileSync(path.join(root, item.id), "wrong");
  assert.throws(() => f.vault.get(alice, item.id), /VAULT_FILE_CHANGED/);
});
test("rejects a hardlinked blob and refuses to overwrite an invalid vault manifest", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const item = f.vault.put(alice, "x.txt", Buffer.from("exact"));
  const root = path.join(f.folder, fs.readdirSync(f.folder)[0]);
  fs.linkSync(path.join(root, item.id), path.join(f.dir, "linked"));
  assert.throws(() => f.vault.get(alice, item.id));
  fs.writeFileSync(path.join(root, "index.json"), "broken");
  assert.throws(() => f.vault.choose(alice, f.folder));
  assert.equal(fs.readFileSync(path.join(root, "index.json"), "utf8"), "broken");
});
test("detects manifest path injection and binary context; removes only its own copy", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const image = f.vault.put(alice, "photo.png", Buffer.from([1, 2, 3]));
  assert.throws(() => f.vault.context(alice, image.id), /VAULT_TEXT_ONLY/);
  f.vault.remove(alice, image.id);
  assert.equal(f.vault.list(alice).items.length, 0);
  const root = path.join(f.folder, fs.readdirSync(f.folder)[0]),
    manifest = JSON.parse(fs.readFileSync(path.join(root, "index.json")));
  manifest.items = [{ ...image, id: "../../outside" }];
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify(manifest));
  assert.throws(() => f.vault.status(alice), /VAULT_INDEX_INVALID/);
});
test("keeps memory snapshots searchable without model calls and bounds context", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  f.vault.put(
    alice,
    "memory.json",
    Buffer.from(JSON.stringify({ entries: [{ content: "Меня зовут Александр" }] })),
    "memory"
  );
  assert.equal(f.vault.search(alice, "Александр").items.length, 1);
  const large = f.vault.put(alice, "long.txt", Buffer.from("x".repeat(12001)));
  assert.throws(() => f.vault.context(alice, large.id), /VAULT_CONTEXT_LIMIT/);
});
class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.dead = false;
    this.webContents = new EventEmitter();
    this.webContents.mainFrame = { url: "" };
    this.webContents.getURL = () => this.url;
    this.webContents.setWindowOpenHandler = () => {};
  }
  async loadURL(url) {
    this.url = url;
    this.webContents.mainFrame.url = url;
  }
  show() {}
  focus() {}
  isDestroyed() {
    return this.dead;
  }
  destroy() {
    this.dead = true;
    this.emit("closed");
  }
}
test("native console rejects remote/subframe commands, imports only a chosen file and queues consented text", async (t) => {
  const f = fixture(t),
    handlers = new Map();
  let owner = alice,
    epoch = 1,
    win;
  const file = path.join(f.dir, "original.txt");
  fs.writeFileSync(file, "Точный текст");
  const sent = [];
  const console = createVaultConsole({
    BrowserWindow: class extends FakeWindow {
      constructor(o) {
        super(o);
        win = this;
      }
    },
    ipcMain: { handle: (k, v) => handlers.set(k, v) },
    dialog: {
      showOpenDialog: async (_w, o) => ({
        canceled: false,
        filePaths: [o.properties.includes("openDirectory") ? f.folder : file]
      }),
      showMessageBox: async () => ({ response: 1 })
    },
    profileDirectory: f.profile,
    codec,
    identity: async () => owner,
    getEpoch: () => epoch,
    getMainWindow: () => ({ webContents: { send: (channel) => sent.push(channel) } }),
    getSession: () => ({})
  });
  await console.show();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame },
    command = handlers.get("kosmora:vault-command");
  assert.equal((await command({ sender: {} }, "status")).ok, false);
  assert.equal((await command({ ...event, senderFrame: { url: win.url } }, "status")).ok, false);
  assert.equal((await command(event, "choose")).ok, true);
  const imported = await command(event, "import");
  assert.equal(imported.ok, true);
  const id = imported.data.items[0].id;
  assert.equal((await command(event, "send", id)).ok, true);
  assert.equal(sent[0], "kosmora:vault-context-ready");
  const context = await console.readContext();
  assert.match(context.text, /Точный текст/);
  await console.ackContext(context.id);
  assert.equal(await console.readContext(), null);
  await command(event, "remove", id);
  assert.equal(fs.readFileSync(file, "utf8"), "Точный текст");
  owner = { ...alice, owner: "bob" };
  epoch++;
  assert.equal((await command(event, "status")).ok, false);
  console.invalidate();
});
test("native console rechecks identity after a delayed folder dialog", async (t) => {
  const f = fixture(t),
    handlers = new Map();
  let current = alice,
    epoch = 1,
    win;
  const console = createVaultConsole({
    BrowserWindow: class extends FakeWindow {
      constructor(o) {
        super(o);
        win = this;
      }
    },
    ipcMain: { handle: (k, v) => handlers.set(k, v) },
    dialog: {
      showOpenDialog: async () => {
        current = { ...alice, owner: "bob" };
        epoch++;
        return { canceled: false, filePaths: [f.folder] };
      }
    },
    profileDirectory: f.profile,
    codec,
    identity: async () => current,
    getEpoch: () => epoch,
    getMainWindow: () => null,
    getSession: () => ({})
  });
  await console.show();
  const result = await handlers.get("kosmora:vault-command")(
    { sender: win.webContents, senderFrame: win.webContents.mainFrame },
    "choose"
  );
  assert.equal(result.ok, false);
  assert.equal(f.vault.status(alice).connected, false);
  console.invalidate();
});
