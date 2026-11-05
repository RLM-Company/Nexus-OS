"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { createLocalVault } = require("../local-vault.cjs");
const { createVaultConsole } = require("../vault-console.cjs");
const independentOffice = require("./fixtures/office-import.json").files;
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
test("Office originals are locally searchable and addressable without changing bytes or evaluating formulas", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  for (const input of independentOffice) {
    const bytes = Buffer.from(input.base64, "base64"),
      item = f.vault.put(alice, input.name, bytes);
    const excerpt = f.vault.fragment(alice, item.id);
    assert.equal(excerpt.sha256, item.id);
    assert.equal(excerpt.representation.kind, "office_text");
    assert.equal(excerpt.offset_utf16, 0);
    assert.ok(excerpt.content.length > 0);
    assert.deepEqual(f.vault.get(alice, item.id).bytes, bytes);
    assert.ok(f.vault.context(alice, item.id).includes("office_text"));
    assert.ok(
      f.vault.search(alice, "доставки").items.some((i) => i.id === item.id) ||
        input.name.endsWith("xlsx")
    );
  }
  const broken = f.vault.put(alice, "broken.docx", Buffer.from("not a container"));
  assert.throws(() => f.vault.context(alice, broken.id), /VAULT_DOCUMENT_INVALID/);
  assert.equal(f.vault.search(alice, "anything").limited, true);
  f.vault.disconnect(alice);
  assert.throws(() => f.vault.fragment(alice, independentOffice[0].sha256));
});
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
  const escaped = f.vault.put(alice, "escaped.txt", Buffer.from("\t".repeat(11000)));
  assert.throws(() => f.vault.context(alice, escaped.id), /VAULT_CONTEXT_LIMIT/);
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

test("Vault preview bounds UTF-8 bytes and falls back to exact paginated source reads", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const text = "漢".repeat(9000),
    item = f.vault.put(alice, "source.txt", Buffer.from(text));
  assert.throws(() => f.vault.context(alice, item.id), /VAULT_CONTEXT_LIMIT/);
  let offset = 0,
    actual = "";
  do {
    const page = f.vault.fragment(alice, item.id, offset);
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 10000);
    assert.equal(page.offset_utf16, offset);
    assert.equal(page.sha256, item.id);
    actual += page.content;
    offset = page.next_offset;
  } while (offset !== null);
  assert.equal(actual, text);
  assert.equal(f.vault.get(alice, item.id).bytes.toString(), text);
});

test("Vault refuses a cursor inside a Unicode character without rewinding or duplicating text", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const item = f.vault.put(alice, "emoji.txt", Buffer.from("A🚀B"));
  assert.throws(() => f.vault.fragment(alice, item.id, 2), /VAULT_QUERY/);
  assert.equal(f.vault.fragment(alice, item.id, 3).content, "B");
  assert.equal(f.vault.fragment(alice, item.id, 4).next_offset, null);
});

test("Vault search paths begin at a whole Unicode character", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const text = "A🚀" + "x".repeat(78) + " needle";
  const item = f.vault.put(alice, "search.txt", Buffer.from(text));
  const hit = f.vault.search(alice, "needle").items.find((i) => i.id === item.id);
  assert.equal(hit.offset, 1);
  assert.ok(f.vault.fragment(alice, item.id, hit.offset).content.startsWith("🚀"));
});

test("normalized Vault matches quote the actual original occurrence, including expanded graphemes", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  for (const [original, query] of [
    ["① １２３", "1 123"],
    ["ﬃ", "ffi"],
    ["Cafe\u0301", "café"],
    ["İstanbul", "i\u0307stanbul"]
  ]) {
    const text = "Вступление. ".repeat(90) + original + " — кроме доставки.";
    const item = f.vault.put(alice, "source.txt", Buffer.from(text));
    const hit = f.vault.search(alice, query).items.find((i) => i.id === item.id);
    assert.ok(hit, query);
    assert.ok(hit.snippet.includes(original), JSON.stringify(hit));
    assert.ok(hit.snippet.includes("кроме доставки"));
    assert.equal(hit.snippet, text.slice(hit.offset, hit.offset + hit.snippet.length));
    assert.ok(f.vault.fragment(alice, item.id, hit.offset).content.includes(original));
  }
});
test("Vault rejects blank queries and excess terms instead of silently matching unrelated sources", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  f.vault.put(alice, "source.txt", Buffer.from("private"));
  for (const query of ["   ", "\t\n", Array(13).fill("word").join(" ")])
    assert.throws(() => f.vault.search(alice, query), /VAULT_QUERY/);
});
test("Vault search snippets never end inside an emoji", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const text = "needle" + "x".repeat(493) + "🚀";
  const item = f.vault.put(alice, "source.txt", Buffer.from(text));
  const hit = f.vault.search(alice, "needle").items.find((i) => i.id === item.id);
  assert.ok(hit.snippet.isWellFormed());
  assert.equal(hit.snippet, text.slice(0, 499));
});

test("Markdown outline returns exact heading offsets and ignores fenced examples", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const text =
    "# План 🚀\r\nТекст\r## Бюджет 00123 ###\n```md\n# Ложный раздел\n```\n~~~\n## Также код\n~~~\n### Кроме доставки\n    # Отступ кода\n";
  const item = f.vault.put(alice, "report.md", Buffer.from(text));
  const outline = f.vault.outline(alice, item.id);
  assert.equal(outline.truncated, false);
  assert.equal(outline.sha256, item.id);
  assert.deepEqual(
    outline.headings.map((h) => h.title),
    ["План 🚀", "Бюджет 00123", "Кроме доставки"]
  );
  for (const h of outline.headings) {
    const read = f.vault.fragment(alice, item.id, h.offset_utf16);
    assert.ok(read.content.startsWith("#".repeat(h.level)));
    assert.ok(read.content.includes(h.title));
  }
});
test("Markdown outline is bounded and explicitly reports missing coverage", (t) => {
  const f = fixture(t);
  f.vault.choose(alice, f.folder);
  const text = Array.from({ length: 120 }, (_, i) => "## " + i + " 🚀".repeat(150)).join("\n");
  const item = f.vault.put(alice, "large.md", Buffer.from(text));
  const r = f.vault.outline(alice, item.id);
  assert.ok(r.headings.length > 0 && r.headings.length <= 40);
  assert.equal(r.truncated, true);
  assert.ok(r.headings.every((h) => h.title_truncated && h.title.isWellFormed()));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 6600);
  const huge = f.vault.put(alice, "huge.md", Buffer.from("x".repeat(256001) + "\n# Hidden"));
  assert.equal(f.vault.outline(alice, huge.id).truncated, true);
  const plain = f.vault.put(alice, "plain.txt", Buffer.from("# Not Markdown"));
  assert.throws(() => f.vault.outline(alice, plain.id), /VAULT_TEXT_ONLY/);
});
