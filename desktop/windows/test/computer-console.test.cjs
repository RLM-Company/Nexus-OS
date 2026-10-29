"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createComputerConsole } = require("../computer-console.cjs");

async function fixture() {
  const handlers = new Map(),
    calls = [];
  let window, runnerOptions;
  class Window {
    constructor() {
      window = this;
      this.destroyed = false;
      this.callbacks = {};
      this.webContents = { mainFrame: { url: "" }, setWindowOpenHandler() {}, on() {}, send() {} };
    }
    on(name, callback) {
      this.callbacks[name] = callback;
    }
    isDestroyed() {
      return this.destroyed;
    }
    loadFile(file) {
      this.webContents.mainFrame.url = pathToFileURL(file).toString();
      return Promise.resolve();
    }
    destroy() {
      this.destroyed = true;
      this.callbacks.closed?.();
    }
    show() {}
    focus() {}
  }
  const api = createComputerConsole({
    BrowserWindow: Window,
    ipcMain: {
      handle(name, handler) {
        handlers.set(name, handler);
      }
    },
    identity: async () => ({ owner: "owner", origin: "https://example.test" }),
    getSession() {
      throw Error("No network in IPC boundary test");
    },
    globalShortcut: { register: () => true, unregister() {} },
    createRunner(options) {
      runnerOptions = options;
      return {
        active: null,
        run: async (input) => {
          calls.push({ kind: "run", input });
          return { status: "completed" };
        },
        resume: () => {
          calls.push({ kind: "resume" });
          return true;
        },
        stop: () => calls.push({ kind: "stop" })
      };
    }
  });
  await api.show();
  return {
    api,
    calls,
    handlers,
    runnerOptions,
    trusted: { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  };
}

test("only the exact packaged main frame can resume a human checkpoint", async () => {
  const f = await fixture();
  const resume = f.handlers.get("koswork:computer-resume");
  for (const event of [
    { ...f.trusted, sender: {} },
    { ...f.trusted, senderFrame: { ...f.trusted.senderFrame } },
    { ...f.trusted, senderFrame: { url: "https://example.test" } }
  ])
    assert.deepEqual(resume(event), { resumed: false });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(resume(f.trusted), { resumed: true });
  assert.deepEqual(f.calls, [{ kind: "resume" }]);
  assert.equal(f.runnerOptions.allowHumanResume, true);
});

test("opening native consent never runs a task; an untrusted page cannot start it", async () => {
  const f = await fixture();
  assert.equal(f.calls.length, 0);
  const start = f.handlers.get("koswork:computer-start");
  assert.ok((await start({}, { project: "project", goal: "goal" })).error);
  assert.equal(f.calls.length, 0);
  await start(f.trusted, { project: "project", goal: "goal" });
  assert.deepEqual(f.calls[0], {
    kind: "run",
    input: { project: "project", goal: "goal", maxSteps: 30 }
  });
});

test("an invalidated computer window cannot resume the previous owner task", async () => {
  const f = await fixture();
  f.api.invalidate();
  const before = f.calls.length;
  assert.deepEqual(f.handlers.get("koswork:computer-resume")(f.trusted), { resumed: false });
  assert.equal(f.calls.length, before);
  assert.ok(f.calls.some((call) => call.kind === "stop"));
});
