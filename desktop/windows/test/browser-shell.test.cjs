"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { pathToFileURL } = require("node:url");
const { createKosworkBrowser } = require("../browser/shell.cjs");
async function fixture(options = {}) {
  let window, runnerOptions;
  const handlers = new Map(),
    calls = [];
  const state = {
    context: { owner: "owner", origin: "https://example.test" },
    lifecycle: "active",
    globalRegistered: options.register ?? true
  };
  class Window extends EventEmitter {
    constructor() {
      super();
      window = this;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "" };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, payload) => calls.push({ channel, payload });
      this.destroyed = false;
    }
    async loadFile(file) {
      this.webContents.mainFrame.url = pathToFileURL(file).toString();
    }
    isDestroyed() {
      return this.destroyed;
    }
    show() {}
    focus() {}
    minimize() {
      calls.push("minimize");
    }
    restore() {
      calls.push("restore");
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }
  const workspace = {
    snapshot: () => null,
    invalidate: async () => {
      calls.push("revoke");
    },
    forget: () => calls.push("forget"),
    connect: async () => ({ id: "a".repeat(24), name: "Work" })
  };
  const engine = {
    state: () => ({ tabs: [], active: null, downloads: [] }),
    open: async () => {
      calls.push("open");
    },
    activate: async () => {},
    close: async () => {},
    navigate: async (url) => {
      calls.push({ navigate: url });
    },
    search: async (query) => {
      calls.push({ search: query });
    },
    manual: () => {},
    dispose: () => calls.push("dispose"),
    resize() {}
  };
  const browser = createKosworkBrowser({
    BrowserWindow: Window,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    globalShortcut: {
      register: () => state.globalRegistered,
      unregister: () => calls.push("unregister")
    },
    identity: async () => state.context,
    getSession: () => ({
      fetch: async (url) => {
        await options.onFetch?.(url, state);
        return new Response(
          JSON.stringify(
            url.endsWith("/privacy")
              ? { lifecycle: state.lifecycle }
              : { items: [{ id: "project", title: "Project", status: "ACTIVE" }] }
          ),
          { headers: { "content-type": "application/json" } }
        );
      }
    }),
    profiles: { get: async () => ({}), clear: async () => calls.push("clear") },
    workspace,
    history: {
      list: () => [
        { executionMode: "computer", id: "pc" },
        { executionMode: "browser", id: "browser" }
      ],
      accept: () => ({ accepted: true }),
      recovery: () => ({
        executionMode: options.recoveryMode ?? "browser",
        project: "project",
        goal: "saved goal",
        taskId: "saved"
      })
    },
    taskGate: options.taskGate,
    executionMode: options.mode ?? "browser",
    createComputer: () => ({
      observe: async () => {
        calls.push("desktop-capture");
        return {};
      },
      stop() {}
    }),
    createEngine: () => engine,
    createRunner: (input) => {
      runnerOptions = input;
      return {
        active: null,
        stop: () => calls.push("stop"),
        resume: () => true,
        run: async (args) => {
          calls.push({ run: args });
          return { status: "completed" };
        }
      };
    }
  });
  await browser.show();
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    browser,
    calls,
    state,
    window,
    runnerOptions,
    workspace,
    invoke: (command, input, event = trusted) =>
      handlers.get(options.mode === "work" ? "koswork:work-command" : "koswork:browser-command")(
        event,
        command,
        input
      ),
    trusted
  };
}
test("only exact native browser main frame can navigate, launch, recover or read history", async () => {
  const f = await fixture();
  f.calls.length = 0;
  for (const command of ["state", "navigate", "start", "recover", "history", "folder", "stop"])
    assert.ok((await f.invoke(command, {}, {})).error);
  assert.equal(f.calls.length, 0);
  assert.equal(f.runnerOptions.executionMode, "browser");
  await f.invoke("navigate", "example.com");
  assert.ok(f.calls.some((c) => c.navigate === "https://example.com/"));
  await f.invoke("navigate", "Космические разработки");
  assert.ok(f.calls.some((c) => c.search === "Космические разработки"));
  assert.equal(
    f.calls.some((c) => c.navigate?.includes("duckduckgo")),
    false
  );
  assert.ok((await f.invoke("navigate", "file:///C:/secret")).error);
});

test("work console uses its own IPC, shared-folder scope and extended bounded task without desktop capture", async () => {
  const f = await fixture({ mode: "work" });
  assert.equal(f.runnerOptions.executionMode, "work");
  assert.equal((await f.invoke("state")).taskMode, "work");
  assert.deepEqual(f.runnerOptions.driver.state().permissions, []);
  await f.invoke("start", { project: "project", goal: "Read and save a report" });
  assert.equal(f.calls.find((c) => c.run).run.maxSteps, 90);
  assert.equal(f.calls.includes("desktop-capture"), false);
  assert.ok((await f.invoke("start", {}, {})).error);
  assert.ok((await f.invoke("recover", "browser-task")).error);
  await f.browser.show({ project: "project", goal: "A new transferred goal" });
  assert.ok(f.calls.some((c) => c.payload?.prefill?.goal === "A new transferred goal"));
  await assert.rejects(
    f.browser.show({ project: "not-owned", goal: "Must not use the wrong project" }),
    /PROJECT_UNAVAILABLE/
  );
  assert.equal(
    f.calls.some((c) => c.payload?.prefill?.goal === "Must not use the wrong project"),
    false
  );
});
test("browser recovery accepts only browser records and history never mixes desktop tasks", async () => {
  const f = await fixture();
  assert.deepEqual(
    (await f.invoke("history")).items.map((x) => x.id),
    ["browser"]
  );
  await f.invoke("recover", "saved");
  assert.equal(f.calls.find((c) => c.run).run.goal, "saved goal");
  const g = await fixture({ recoveryMode: "computer" });
  assert.equal((await g.invoke("recover", "pc")).error, "COMPUTER_RECOVERY_UNAVAILABLE");
  assert.ok(!g.calls.some((c) => c.run));
});
test("late identity change cannot start a model task and rejected shortcut registration cannot remove another task's stop key", async () => {
  const f = await fixture({ register: false });
  f.calls.length = 0;
  assert.equal(
    (await f.invoke("start", { project: "project", goal: "goal" })).error,
    "COMPUTER_STOP_SHORTCUT_UNAVAILABLE"
  );
  assert.ok(!f.calls.includes("unregister"));
  const g = await fixture();
  g.state.context = { ...g.state.context, owner: "other" };
  assert.equal(
    (await g.invoke("start", { project: "project", goal: "goal" })).error,
    "COMPUTER_IDENTITY_CHANGED"
  );
  assert.ok(!g.calls.some((c) => c.run));
});
test("window invalidation revokes browser access and blocks stale UI without altering other task's shortcut", async () => {
  const f = await fixture();
  f.calls.length = 0;
  f.browser.invalidate();
  assert.ok(f.calls.includes("stop"));
  assert.ok(f.calls.includes("dispose"));
  assert.ok(f.calls.includes("revoke"));
  assert.ok(!f.calls.includes("unregister"));
  assert.ok((await f.invoke("state")).error);
});
test("browser profile deletion queues explicit storage clearing and keeps file revocation immediate", async () => {
  const f = await fixture();
  await f.browser.forget();
  assert.ok(f.calls.includes("forget"));
  assert.ok(f.calls.includes("clear"));
  assert.equal(f.window.destroyed, true);
});
