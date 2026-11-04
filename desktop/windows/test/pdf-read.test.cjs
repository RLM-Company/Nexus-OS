"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { createComputerWorkspace } = require("../computer-workspace.cjs"),
  { createVaultWorkspace } = require("../vault-workspace.cjs"),
  { validateComputerAction } = require("../computer-policy.cjs"),
  { assetPath, validateResult } = require("../document-reader/host.cjs");
const c = { owner: "owner", origin: "https://example.test" };
const action = (extra = {}) => ({
  kind: "workspace_read_pdf",
  path: "source.pdf",
  page_index: 0,
  mode: "auto",
  offset_utf16: 0,
  expected_text_sha256: null,
  expected_version: null,
  ...extra
});
const result = (text = "Космора 00123; 19700 рублей, кроме доставки.") => ({
  text,
  page_index: 0,
  page_count: 2,
  method: "pdf_text",
  confidence: null,
  needs_ocr: false,
  text_clipped: false
});
async function fixture(t, read = async () => result()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-pdf-test-")),
    folder = path.join(root, "files"),
    profile = path.join(root, "profile");
  fs.mkdirSync(folder);
  fs.mkdirSync(profile);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-pdf-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = createComputerWorkspace({
    userDataPath: profile,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    },
    pickDirectory: async () => folder,
    pdfReader: { read, available: () => true }
  });
  const signal = new AbortController().signal;
  await base.connect(c, signal);
  fs.writeFileSync(path.join(folder, "source.pdf"), "%PDF-fixed fixture bytes");
  const exec = (a = action(), sig = signal) =>
    base.execute(validateComputerAction(a), {
      context: c,
      workspaceId: base.snapshot(c).id,
      signal: sig
    });
  return { base, exec, folder, signal };
}
test("PDF excerpt preserves source/page lineage, bounded Unicode and both version fences", async (t) => {
  const text = "🌙 Сумма 00123; кроме доставки. ".repeat(900),
    f = await fixture(t, async () => result(text));
  let r = await f.exec(),
    full = r.content;
  assert.equal(r.representation.page_number, 1);
  assert.equal(r.representation.complete_document, false);
  assert.equal(r.kind, "untrusted_pdf_page_excerpt");
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 10000);
  while (r.next_offset !== null) {
    r = await f.exec(
      action({
        offset_utf16: r.next_offset,
        expected_version: r.version,
        expected_text_sha256: r.representation.text_sha256
      })
    );
    assert.ok(r.content.isWellFormed());
    full += r.content;
  }
  assert.equal(full, text);
  assert.equal(r.representation.text_sha256, createHash("sha256").update(text).digest("hex"));
  await assert.rejects(
    f.exec(action({ expected_version: "sha256:" + "0".repeat(64) })),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  await assert.rejects(
    f.exec(
      action({
        offset_utf16: 20,
        expected_version: r.version,
        expected_text_sha256: "0".repeat(64)
      })
    ),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
});
test("async PDF reading rejects source mutation even with restored mtime and unchanged size", async (t) => {
  let f;
  f = await fixture(t, async () => {
    const p = path.join(f.folder, "source.pdf"),
      stat = fs.statSync(p),
      b = fs.readFileSync(p);
    b[6] ^= 1;
    fs.writeFileSync(p, b);
    fs.utimesSync(p, stat.atime, stat.mtime);
    return result();
  });
  await assert.rejects(f.exec(), (e) => e.code === "WORKSPACE_VERSION_CONFLICT");
});
test("revoking a PDF read aborts the reader and rejects late untrusted text", async (t) => {
  let started, release;
  const ready = new Promise((r) => (started = r)),
    wait = new Promise((r) => (release = r));
  let readerSignal;
  const f = await fixture(t, async (args) => {
    readerSignal = args.signal;
    started();
    await wait;
    return result("late private contents");
  });
  const pending = f.exec();
  await ready;
  await f.base.invalidate();
  assert.equal(readerSignal.aborted, true);
  release();
  await assert.rejects(pending);
});
test("PDF tool capability survives the ordinary folder/Vault adapter and paths stay scoped", async (t) => {
  const f = await fixture(t),
    wrapper = createVaultWorkspace({ base: f.base, vault: {} });
  assert.equal(wrapper.supportsPdfReads(c), true);
  const r = await wrapper.execute(action(), {
    context: c,
    workspaceId: wrapper.snapshot(c).id,
    signal: f.signal
  });
  assert.ok(r.content.includes("00123"));
  for (const bad of [
    { path: "../source.pdf" },
    { path: "other.docx" },
    { page_index: -1 },
    { page_index: 2000 },
    { mode: "network" },
    { offset_utf16: 1 },
    { expected_text_sha256: "bad" }
  ])
    assert.throws(() => validateComputerAction(action(bad)));
});
test("PDF host only serves fixed runtime assets and bounds renderer data", () => {
  const root = path.resolve("fixture"),
    manifest = { files: { "pdf/pdf.mjs": "hash" } };
  assert.equal(
    assetPath("kosmora-document://reader/vendor/pdf/pdf.mjs", root, manifest),
    path.join(root, "vendor/pdf/pdf.mjs")
  );
  for (const url of [
    "file:///etc/passwd",
    "https://reader/index.html",
    "kosmora-document://other/index.html",
    "kosmora-document://reader/vendor/../../private.txt",
    "kosmora-document://reader/index.html?x=1"
  ])
    assert.equal(assetPath(url, root, manifest), null);
  for (const bad of [
    { ...result(), text: "x".repeat(180001) },
    { ...result(), page_count: 0 },
    { ...result(), confidence: 101 },
    { ...result(), method: "trusted" }
  ])
    assert.throws(() => validateResult(bad, 0));
});

test("PDF host isolates its renderer, cancels the active job and releases its concurrency slot", async (t) => {
  const { EventEmitter } = require("node:events"),
    { createPdfReaderHost } = require("../document-reader/host.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-pdf-host-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-pdf-host-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, "assets-manifest.json"), JSON.stringify({ files: {} }));
  let ready,
    opened,
    settings,
    cleared = 0,
    denied;
  const entered = new Promise((r) => (ready = r)),
    views = [];
  class Window {
    constructor(options) {
      settings = options;
      views.push(this);
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => {
        assert.deepEqual(fn(), { action: "deny" });
      };
      this.webContents.executeJavaScript = async () => {
        ready();
        await new Promise(() => {});
      };
    }
    async loadURL(url) {
      opened = url;
    }
    isDestroyed() {
      return this.dead === true;
    }
    destroy() {
      this.dead = true;
    }
  }
  const session = {
    fromPartition(name) {
      assert.ok(!name.startsWith("persist:"));
      return {
        setPermissionRequestHandler(fn) {
          fn(null, null, (allowed) => assert.equal(allowed, false));
        },
        setPermissionCheckHandler(fn) {
          assert.equal(fn(), false);
        },
        webRequest: {
          onBeforeRequest(filter, fn) {
            assert.ok(filter.urls.includes("https://*/*"));
            fn(null, (v) => (denied = v.cancel));
          }
        },
        protocol: { handle() {}, unhandle() {} },
        on() {},
        async clearStorageData() {
          cleared++;
        }
      };
    }
  };
  const host = createPdfReaderHost({ BrowserWindow: Window, session, root }),
    controller = new AbortController();
  const args = {
    bytes: Buffer.from("%PDF"),
    pageIndex: 0,
    mode: "auto",
    signal: controller.signal
  };
  const job = host.read(args);
  await entered;
  await assert.rejects(host.read(args), /PDF_READER_BUSY/);
  controller.abort();
  await assert.rejects(job, /PDF_CANCELLED/);
  assert.equal(settings.show, false);
  assert.equal(settings.webPreferences.sandbox, true);
  assert.equal(settings.webPreferences.nodeIntegration, false);
  assert.equal(settings.webPreferences.webSecurity, true);
  assert.equal(opened, "kosmora-document://reader/index.html");
  assert.equal(views[0].dead, true);
  assert.equal(cleared, 1);
  assert.equal(denied, true);
  await assert.rejects(
    host.read({ ...args, bytes: Buffer.alloc(26214401), signal: undefined }),
    /PDF_ARGUMENT_INVALID/
  );
});
