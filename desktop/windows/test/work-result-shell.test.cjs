"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { pathToFileURL } = require("node:url");
const { createKosworkBrowser } = require("../browser/shell.cjs");
const context = { owner: "A", origin: "https://example.test" },
  input = { project: "project-A", goal: "Exact task" };
function fixture(t) {
  const windows = [],
    handlers = new Map(),
    delivered = [];
  let current = context,
    privacy = "active",
    projects = [{ id: input.project, title: "Project", status: "ACTIVE" }],
    onIdentity = null,
    run = async () => ({ status: "completed", summary: "Exact result 🌙", steps: 3 }),
    hotkey;
  class Window extends EventEmitter {
    constructor() {
      super();
      windows.push(this);
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "" };
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() {
      return this.destroyed;
    }
    show() {}
    focus() {}
    minimize() {}
    restore() {}
    async loadFile(file) {
      this.webContents.mainFrame.url = pathToFileURL(file).toString();
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }
  const session = {
    fetch: async (url) =>
      new Response(
        JSON.stringify(url.endsWith("/projects") ? { items: projects } : { lifecycle: privacy }),
        { headers: { "content-type": "application/json" } }
      )
  };
  const workspace = { snapshot: () => null, invalidate: async () => {}, forget() {} };
  const runner = {
    active: null,
    stop() {},
    resume: () => false,
    run: async (value) => {
      runner.active = {};
      try {
        return await run(value);
      } finally {
        runner.active = null;
      }
    }
  };
  const engine = {
    state: () => ({ tabs: [], downloads: [], liveTabs: 0 }),
    open: async () => {},
    stop() {},
    dispose() {},
    resize() {}
  };
  const shell = createKosworkBrowser({
    BrowserWindow: Window,
    WebContentsView: class {},
    ipcMain: { handle: (key, value) => handlers.set(key, value) },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    globalShortcut: {
      register: (_key, fn) => {
        hotkey = fn;
        return true;
      },
      unregister() {}
    },
    identity: async () => {
      if (onIdentity) await onIdentity();
      return current;
    },
    getSession: () => session,
    profiles: { get: async () => session, clear: async () => {} },
    workspace,
    history: { list: () => [] },
    executionMode: "work",
    createComputer: () => ({ stop() {} }),
    createEngine: () => engine,
    createRunner: () => runner
  });
  t.after(() => shell.invalidate());
  return {
    shell,
    windows,
    delivered,
    show: () => shell.show(input, (v) => delivered.push(v), context),
    command: (command, value) => {
      const web = windows.at(-1).webContents;
      return handlers.get("koswork:work-command")(
        { sender: web, senderFrame: web.mainFrame },
        command,
        value
      );
    },
    setOwner: (v) => {
      current = v;
    },
    setPrivacy: (v) => {
      privacy = v;
    },
    setProjects: (v) => {
      projects = v;
    },
    setRun: (v) => {
      run = v;
    },
    onIdentity: (v) => {
      onIdentity = v;
    },
    hotkey: () => hotkey()
  };
}
test("the real shell returns a matching task once and rejects unrelated result attribution", async (t) => {
  const f = fixture(t);
  await f.show();
  assert.equal(await f.shell.canReturnResult(context, input.project), true);
  assert.equal((await f.command("start", input)).status, "completed");
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].summary, "Exact result 🌙");
  await f.command("start", input);
  assert.equal(f.delivered.length, 1);
  await f.show();
  await f.command("start", { ...input, goal: "Different local task" });
  assert.equal(f.delivered.length, 2);
  assert.equal(f.delivered[1].status, "cancelled");
  assert.equal(f.delivered[1].summary, undefined);
  await f.show();
  f.setRun(async () => ({ status: "needs_user", summary: "Private question" }));
  await f.command("start", input);
  assert.equal(f.delivered[2].status, "paused");
  assert.equal(f.delivered[2].summary, undefined);
});
test("stop and emergency takeover discard late successful result reports", async (t) => {
  for (const method of ["stop", "hotkey"]) {
    const f = fixture(t);
    await f.show();
    let enter, release;
    const ready = new Promise((r) => {
      enter = r;
    });
    f.setRun(async () => {
      enter();
      await new Promise((r) => {
        release = r;
      });
      return { status: "completed", summary: "Late private" };
    });
    const pending = f.command("start", input);
    await ready;
    if (method === "stop") f.shell.stop();
    else f.hotkey();
    assert.equal(f.delivered[0].status, "cancelled");
    release();
    await pending;
    assert.equal(f.delivered.length, 1);
  }
});
test("summary checks fail closed for erased privacy, deleted projects and owner/epoch changes", async (t) => {
  const f = fixture(t);
  await f.show();
  f.setPrivacy("erasing");
  assert.equal(await f.shell.canReturnResult(context, input.project), false);
  f.setPrivacy("active");
  f.setProjects([]);
  assert.equal(await f.shell.canReturnResult(context, input.project), false);
  f.setProjects([{ id: input.project, status: "ACTIVE" }]);
  f.setOwner({ ...context, owner: "B" });
  assert.equal(await f.shell.canReturnResult(context, input.project), false);
  f.setOwner(context);
  let calls = 0;
  f.onIdentity(() => {
    if (++calls === 6) f.shell.invalidate();
  });
  assert.equal(await f.shell.canReturnResult(context, input.project), false);
});
test("queued open requests cannot reopen a stopped or invalidated window", async (t) => {
  const f = fixture(t),
    first = f.show(),
    second = f.show();
  f.shell.stop();
  await assert.rejects(first, /CANCELLED/);
  await assert.rejects(second, /CANCELLED/);
  assert.equal(f.windows.length, 0);
  assert.equal(f.delivered.length, 0);
  f.setOwner({ ...context, owner: "B" });
  await assert.rejects(f.show(), /IDENTITY_CHANGED/);
});

test("stopping during the final identity await never binds a stale result recipient", async (t) => {
  const f = fixture(t);
  await f.show();
  let calls = 0;
  f.onIdentity(() => {
    if (++calls === 3) f.shell.stop();
  });
  await assert.rejects(f.show(), /IDENTITY_CHANGED/);
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].status, "cancelled");
  f.onIdentity(null);
  await f.command("start", input);
  assert.equal(f.delivered.length, 1);
});
