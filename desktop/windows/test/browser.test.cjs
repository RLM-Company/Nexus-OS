"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createBrowserEngine } = require("../browser/engine.cjs");
const { createBrowserProfiles } = require("../browser/profiles.cjs");
const { safeUrl, address, profileKey, createTaskGate } = require("../browser/policy.cjs");
const { validateComputerAction } = require("../computer-policy.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const documentCode = require("../browser/document.cjs");
const context = { owner: "owner", origin: "https://example.test" };
function fixture(t, options = {}) {
  const calls = [],
    views = [],
    session = new EventEmitter(),
    window = {
      contentView: { addChildView() {}, removeChildView() {} },
      isDestroyed: () => false,
      getContentSize: () => [1280, 840]
    };
  let onCommand = null,
    captures = 0,
    takeovers = 0;
  const nodes = [
    { ref: "e1", role: "a", name: "Next", href: "https://example.test/next", signature: "link" },
    { ref: "e2", role: "input", name: "Search", type: "text", signature: "input" },
    { ref: "e3", role: "button", name: "Send", submit: true, signature: "button" },
    { ref: "e4", role: "input", name: "Password", secret: true, signature: "secret" },
    { ref: "e5", role: "input", name: "Attach", upload: true, signature: "upload" }
  ];
  class View {
    constructor(options) {
      this.options = options;
      views.push(this);
      const web = (this.webContents = new EventEmitter());
      web.destroyed = false;
      web.value = "";
      web.isDestroyed = () => web.destroyed;
      web.isLoading = () => false;
      web.isCurrentlyAudible = () => false;
      web.setWindowOpenHandler = (fn) => (web.openHandler = fn);
      web.navigationHistory = {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: () => calls.push({ method: "back" }),
        goForward: () => {}
      };
      web.reload = () => calls.push({ method: "reload" });
      web.close = () => {
        web.destroyed = true;
      };
      web.downloadURL = (url) => calls.push({ method: "downloadURL", url });
      web.loadURL = async (url) => {
        web.url = url;
        calls.push({ method: "loadURL", url });
        web.emit("did-start-navigation", {}, url, false, true);
        web.emit("did-navigate", {}, url);
      };
      web.capturePage = async () => {
        captures++;
        return {
          getSize: () => ({ width: 960 }),
          resize() {
            return this;
          },
          toJPEG: () => Buffer.from([255, 216, 255, 217])
        };
      };
      let attached = false;
      web.debugger = {
        isAttached: () => attached,
        attach: () => {
          attached = true;
        },
        sendCommand: async (method, args = {}) => {
          calls.push({ method, args });
          await onCommand?.(method, args, web);
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame" } } };
          if (method === "Page.createIsolatedWorld") return { executionContextId: 12 };
          if (method === "Runtime.callFunctionOn") {
            const values = args.arguments.map((x) => x.value);
            if (args.functionDeclaration === documentCode.capture) {
              web.snapshot = values[0];
              return {
                result: {
                  value: {
                    url: web.url,
                    title: "Fixture",
                    text: "Fixture page",
                    nodes: nodes.map((n) => ({ ...n })),
                    dirty: false
                  }
                }
              };
            }
            if (args.functionDeclaration === documentCode.locate) {
              const node = nodes.find((n) => n.ref === values[1]);
              return {
                result: {
                  value: node?.secret
                    ? { blocked: true }
                    : node
                      ? { x: 20, y: 30, info: { ...node } }
                      : null
                }
              };
            }
            if (args.functionDeclaration === documentCode.fileNode)
              return { result: { objectId: "file-node" } };
            if (args.functionDeclaration.includes("node.value"))
              return { result: { value: web.value === values[2] } };
            return { result: { value: true } };
          }
          if (method === "Input.insertText") web.value = args.text;
          return {};
        }
      };
    }
    setBounds(value) {
      this.bounds = value;
    }
    setVisible(value) {
      this.visible = value;
    }
  }
  session.setPermissionRequestHandler = (fn) => (session.permission = fn);
  session.setPermissionCheckHandler = (fn) => (session.check = fn);
  const workspace = {
    snapshot: () => ({ id: "a".repeat(24), name: "Work" }),
    uploadFile: () => "C:\\fixture\\upload.txt",
    reserveDownload: () => ({ path: "C:\\fixture\\download.txt", name: "download.txt" }),
    verifyDownload() {}
  };
  const engine = createBrowserEngine({
    WebContentsView: View,
    ...options,
    window,
    browserSession: session,
    workspace,
    context,
    takeover: () => {
      takeovers++;
    }
  });
  t.after(() => engine.dispose());
  return {
    engine,
    calls,
    views,
    session,
    workspace,
    nodes,
    setHook: (fn) => {
      onCommand = fn;
    },
    get captures() {
      return captures;
    },
    get takeovers() {
      return takeovers;
    }
  };
}
test("URL/action policy refuses executable schemes, credentials, code injection and extra fields", () => {
  for (const url of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "https://user:pass@example.test",
    "data:text/html,x",
    "ms-settings:privacy",
    "https://example.test/\n"
  ]) {
    assert.equal(safeUrl(url), null);
    assert.throws(() => validateComputerAction({ kind: "browser_open", url }), /ACTION_INVALID/);
  }
  assert.equal(address("example.com"), "https://example.com/");
  assert.ok(address("a useful query").startsWith("https://duckduckgo.com/?q="));
  for (const action of [
    { kind: "browser_evaluate", code: "1" },
    { kind: "browser_click", ref: "e1", script: "x" },
    { kind: "browser_fill", ref: "e1", text: "x\0y" },
    { kind: "browser_upload", ref: "e1", path: "../private" },
    { kind: "browser_key", ref: "e1", key: "CTRL" }
  ])
    assert.throws(() => validateComputerAction(action), /ACTION_INVALID/);
  assert.notEqual(profileKey(context), profileKey({ ...context, owner: "other" }));
});
test("home allocates no page renderer; DOM observation sends no screenshots by default", async (t) => {
  const f = fixture(t);
  await f.engine.open();
  assert.equal(f.views.length, 0);
  const home = await f.engine.observe(new AbortController().signal);
  assert.equal(home.image_jpeg_base64, undefined);
  await f.engine.execute(
    { kind: "browser_open", url: "https://example.test" },
    home,
    new AbortController().signal
  );
  const observation = await f.engine.observe(new AbortController().signal);
  assert.equal(observation.image_jpeg_base64, undefined);
  assert.equal(f.captures, 0);
  assert.equal(f.calls.filter((x) => x.method === "loadURL").length, 1);
  assert.ok(observation.description.includes("Fixture page"));
  assert.ok(observation.description.length < 16000);
  for (const view of f.views) {
    assert.equal(view.options.webPreferences.nodeIntegration, false);
    assert.equal(view.options.webPreferences.sandbox, true);
    assert.equal(view.options.webPreferences.contextIsolation, true);
    assert.equal(view.options.webPreferences.backgroundThrottling, true);
  }
});
test("screenshot is opt-in and only captures the page once", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  const first = await f.engine.observe(new AbortController().signal);
  await f.engine.execute({ kind: "browser_screenshot" }, first, new AbortController().signal);
  assert.ok((await f.engine.observe(new AbortController().signal)).image_jpeg_base64);
  assert.equal((await f.engine.observe(new AbortController().signal)).image_jpeg_base64, undefined);
  assert.equal(f.captures, 1);
});
test("tab cap keeps at most three page renderers and never force-evicts edited tabs", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.engine.open("https://example.test/" + i);
  assert.equal(f.engine.state().tabs.length, 8);
  assert.equal(f.engine.state().liveTabs, 3);
  await assert.rejects(f.engine.open(), /TAB_LIMIT/);
  const g = fixture(t);
  for (let i = 0; i < 3; i++) {
    await g.engine.open("https://example.test/" + i);
    g.views.at(-1).webContents.emit("before-input-event");
  }
  await assert.rejects(g.engine.open("https://example.test/new"), /TAB_LIMIT/);
  assert.equal(g.engine.state().tabs.length, 3);
  assert.equal(g.takeovers, 3);
});
test("navigation, resize, tab changes and target changes invalidate old refs before input", async (t) => {
  for (const change of [
    (f) => f.engine.navigate("https://example.test/new"),
    (f) => f.engine.resize(),
    async (f) => {
      f.nodes[0].signature = "changed";
    }
  ]) {
    const f = fixture(t);
    await f.engine.open("https://example.test");
    const observation = await f.engine.observe(new AbortController().signal);
    await change(f);
    const before = f.calls.filter((x) => x.method.startsWith("Input.")).length;
    await assert.rejects(
      f.engine.execute(
        { kind: "browser_click", ref: "e1" },
        observation,
        new AbortController().signal
      ),
      /STALE|ELEMENT_UNAVAILABLE/
    );
    assert.equal(f.calls.filter((x) => x.method.startsWith("Input.")).length, before);
  }
});
test("native approval binds current target evidence; passwords cannot be filled", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  const o = await f.engine.observe(new AbortController().signal);
  assert.equal(f.engine.requiresConfirmation({ kind: "browser_click", ref: "e1" }, o), false);
  assert.equal(f.engine.requiresConfirmation({ kind: "browser_click", ref: "e3" }, o), true);
  assert.equal(
    f.engine.requiresConfirmation({ kind: "browser_fill", ref: "e2", text: "x" }, o),
    true
  );
  await assert.rejects(
    f.engine.execute(
      { kind: "browser_fill", ref: "e4", text: "secret" },
      o,
      new AbortController().signal
    ),
    /ELEMENT_UNAVAILABLE/
  );
  assert.ok(!f.calls.some((x) => x.method === "Input.insertText"));
});
test("stop during click or Ctrl+A releases inserted inputs and never types later text", async (t) => {
  for (const trigger of ["mousePressed", "keyDown"]) {
    const f = fixture(t);
    await f.engine.open("https://example.test");
    const o = await f.engine.observe(new AbortController().signal),
      controller = new AbortController();
    f.setHook((method, args) => {
      if (method.startsWith("Input.") && args.type === trigger) {
        controller.abort();
        f.engine.stop();
      }
    });
    await assert.rejects(
      f.engine.execute(
        { kind: "browser_fill", ref: "e2", text: "must-not-appear" },
        o,
        controller.signal
      ),
      /STOPPED|STALE/
    );
    assert.ok(!f.calls.some((x) => x.method === "Input.insertText"));
    assert.ok(
      f.calls.some((x) => x.args?.type === (trigger === "mousePressed" ? "mouseReleased" : "keyUp"))
    );
  }
});
test("fill verifies the exact resulting value and file upload never exposes filesystem IPC to a page", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  let o = await f.engine.observe(new AbortController().signal);
  const result = await f.engine.execute(
    { kind: "browser_fill", ref: "e2", text: "Unicode Привет 🌙" },
    o,
    new AbortController().signal
  );
  assert.equal(result.input_verified, true);
  o = await f.engine.observe(new AbortController().signal);
  await f.engine.execute(
    { kind: "browser_upload", ref: "e5", path: "upload.txt" },
    o,
    new AbortController().signal
  );
  const command = f.calls.find((x) => x.method === "DOM.setFileInputFiles");
  assert.deepEqual(command.args.files, ["C:\\fixture\\upload.txt"]);
  assert.ok(f.calls.some((x) => x.method === "Runtime.releaseObject"));
});
test("browser denies popups, local schemes, permissions and unsolicited downloads", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  const web = f.views[0].webContents;
  assert.deepEqual(web.openHandler({ url: "https://unrelated.test" }), { action: "deny" });
  let prevented = 0;
  web.emit("will-navigate", { preventDefault: () => prevented++ }, "file:///C:/secret");
  f.session.emit("will-download", { preventDefault: () => prevented++ }, {}, web);
  assert.equal(prevented, 2);
  let allowed = true;
  f.session.permission(web, "camera", (value) => {
    allowed = value;
  });
  assert.equal(allowed, false);
  assert.equal(f.session.check(), false);
});
test("download binds the approved link and workspace, enforces size and verifies completion", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  const web = f.views[0].webContents,
    o = await f.engine.observe(new AbortController().signal);
  await f.engine.execute({ kind: "browser_download", ref: "e1" }, o, new AbortController().signal);
  const item = new EventEmitter();
  Object.assign(item, {
    getURLChain: () => ["https://example.test/next"],
    getTotalBytes: () => 10,
    getFilename: () => "report.txt",
    getReceivedBytes: () => 10,
    setSavePath: (p) => {
      item.path = p;
    },
    cancel: () => {
      item.cancelled = true;
    }
  });
  f.session.emit(
    "will-download",
    {
      preventDefault() {
        throw Error("unexpected rejection");
      }
    },
    item,
    web
  );
  assert.equal(item.path, "C:\\fixture\\download.txt");
  item.emit("done", {}, "completed");
  assert.equal(f.engine.state().downloads[0].status, "completed");
  assert.equal(f.engine.state().downloads[0].path, undefined);
});
test("one local task gate prevents concurrent computer/browser agent runs", async () => {
  const gate = createTaskGate(),
    release = gate.claim();
  assert.throws(() => gate.claim(), /BUSY/);
  release();
  release();
  const next = gate.claim();
  next();
  assert.equal(gate.busy, false);
});
test("stable browser approval rechecks locally without a second model proposal", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  let requests = 0,
    confirmations = 0;
  const runner = new ComputerSession({
    executionMode: "browser",
    driver: f.engine,
    identity: async () => context,
    confirm: async () => {
      confirmations++;
      return true;
    },
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async () => ({
        action:
          ++requests === 1
            ? { kind: "browser_fill", ref: "e2", text: "approved" }
            : { kind: "done", summary: "done" },
        message: "test",
        requires_confirmation: false
      })
    }
  });
  assert.equal(
    (await runner.run({ project: "project", goal: "Fill fixture" })).status,
    "completed"
  );
  assert.equal(requests, 2);
  assert.equal(confirmations, 2);
  assert.equal(f.views[0].webContents.value, "approved");
});
test("changed browser target after native approval cannot reuse that permission", async (t) => {
  const f = fixture(t);
  await f.engine.open("https://example.test");
  const runner = new ComputerSession({
    executionMode: "browser",
    driver: f.engine,
    identity: async () => context,
    confirm: async (value) => {
      if (value.kind === "action") f.nodes[1].signature = "changed after dialog";
      return true;
    },
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => {
        throw Error("must not authorize changed target");
      },
      end: async () => {},
      next: async () => ({
        action: { kind: "browser_fill", ref: "e2", text: "must not type" },
        message: "test",
        requires_confirmation: false
      })
    }
  });
  assert.equal(
    (await runner.run({ project: "project", goal: "Fill fixture", maxSteps: 1 })).status,
    "step_limit"
  );
  assert.ok(!f.calls.some((c) => c.method.startsWith("Input.")));
});
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-browser-profiles-"));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
test("browser profiles are owner/server scoped and clear storage before reusing a pending profile", async (t) => {
  const userData = temporary(t),
    calls = [];
  let fail = true;
  const session = {
    fromPath: (dir) => ({
      clearStorageData: async () => {
        calls.push(dir);
        if (fail) throw Error("offline-disk");
      },
      clearCache: async () => {}
    })
  };
  const store = createBrowserProfiles({ userData, session });
  await store.get(context);
  await store.get({ ...context, owner: "other" });
  await assert.rejects(store.clear(), /offline-disk/);
  assert.ok(fs.existsSync(path.join(userData, "koswork-browser-clear.json")));
  fail = false;
  const restarted = createBrowserProfiles({ userData, session });
  await restarted.get(context);
  assert.equal(fs.existsSync(path.join(userData, "koswork-browser-clear.json")), false);
  assert.equal(new Set(calls).size, 2);
});
test("malformed profile-clear markers fail closed and cannot name arbitrary directories", async (t) => {
  const userData = temporary(t);
  fs.writeFileSync(
    path.join(userData, "koswork-browser-clear.json"),
    JSON.stringify(["../../outside"])
  );
  const store = createBrowserProfiles({
    userData,
    session: {
      fromPath() {
        throw Error("must not access session");
      }
    }
  });
  await assert.rejects(store.get(context), /PROFILE_UNAVAILABLE/);
});
test("a hung page command times out and leaves the native tab close usable", async (t) => {
  const f = fixture(t, { commandTimeout: 25 });
  await f.engine.open("https://example.test");
  f.setHook((method) => (method === "Runtime.callFunctionOn" ? new Promise(() => {}) : undefined));
  const keepAlive = setTimeout(() => {}, 200);
  try {
    await assert.rejects(f.engine.observe(new AbortController().signal), /BROWSER_DOM_TIMEOUT/);
    await f.engine.close(f.engine.state().active, true);
    assert.equal(f.engine.state().liveTabs, 0);
  } finally {
    clearTimeout(keepAlive);
  }
});
