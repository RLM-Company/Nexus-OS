"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createComputerConsole } = require("../computer-console.cjs");

async function fixture(options = {}) {
  const handlers = new Map(),
    calls = [];
  let window, runnerOptions;
  const state = {
    context: { owner: "owner", origin: "https://example.test" },
    lifecycle: "active",
    response: 1
  };
  const history = {
    list: (context) => {
      calls.push({ kind: "list", context });
      return [];
    },
    recovery: (context, id) => {
      calls.push({ kind: "recovery", context, id });
      return {
        taskId: id,
        goal: "saved goal",
        project: "saved-project",
        previousResult: "{}",
        requiresReview: true
      };
    },
    accept: (context, id) => {
      calls.push({ kind: "accept", context, id });
      return { accepted: true };
    },
    clear: (context) => calls.push({ kind: "clear", context })
  };
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
    identity: async () => state.context,
    history,
    dialog: {
      showMessageBox: async (parent, input) => {
        calls.push({ kind: "dialog", input });
        return { response: state.response };
      }
    },
    getSession() {
      return {
        fetch: async (url) => {
          await options.onFetch?.(url, state);
          return new Response(
            JSON.stringify(
              url.endsWith("/privacy") ? { lifecycle: state.lifecycle } : { items: [] }
            ),
            { headers: { "content-type": "application/json" } }
          );
        }
      };
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
    history,
    state,
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
    input: { project: "project", goal: "goal", maxSteps: 30, expectedContext: f.state.context }
  });
});

test("history, recovery, acceptance and deletion require the exact native frame", async () => {
  const f = await fixture(),
    id = "a1ac7997-6913-45aa-a9f4-ac7225247993";
  for (const channel of ["history", "recover", "accept", "clear-history"])
    assert.ok((await f.handlers.get("koswork:computer-" + channel)({}, id)).error);
  assert.equal(f.calls.length, 0);
  await f.handlers.get("koswork:computer-recover")(f.trusted, id);
  const run = f.calls.find((c) => c.kind === "run");
  assert.equal(run.input.goal, "saved goal");
  assert.equal(run.input.project, "saved-project");
  assert.equal(run.input.recovery.taskId, id);
  assert.equal(run.input.expectedContext.owner, "owner");
  assert.ok(
    (await f.handlers.get("koswork:computer-recover")(f.trusted, { id, goal: "injected" })).error
  );
});
test("privacy deletion clears local scope; other non-active lifecycle blocks recovery without exposing saved goals", async () => {
  for (const lifecycle of ["quiescing", "deleting", "deleted", "error", undefined]) {
    const f = await fixture();
    f.state.lifecycle = lifecycle;
    const result = await f.handlers.get("koswork:computer-history")(f.trusted);
    assert.equal(result.error, "COMPUTER_PRIVACY_BLOCKED");
    assert.ok(!f.calls.some((c) => ["list", "recovery", "run"].includes(c.kind)));
    assert.equal(
      f.calls.some((c) => c.kind === "clear"),
      lifecycle === "deleted"
    );
  }
});
test("owner or native frame changes during verification cannot retrieve a private checkpoint", async () => {
  const f = await fixture({
    onFetch: (_url, state) => {
      state.context = { ...state.context, owner: "other" };
    }
  });
  const result = await f.handlers.get("koswork:computer-history")(f.trusted);
  assert.equal(result.error, "COMPUTER_IDENTITY_CHANGED");
  assert.equal(f.calls.length, 0);
  const g = await fixture({
    onFetch: () => {
      g.api.invalidate();
    }
  });
  assert.equal(
    (await g.handlers.get("koswork:computer-history")(g.trusted)).error,
    "COMPUTER_IDENTITY_CHANGED"
  );
  assert.ok(!g.calls.some((c) => c.kind === "list"));
});
test("clear history defaults to cancel, then clears only verified owner and origin", async () => {
  const f = await fixture(),
    clear = f.handlers.get("koswork:computer-clear-history");
  assert.deepEqual(await clear(f.trusted), { cleared: false });
  assert.equal(f.calls.find((c) => c.kind === "dialog").input.defaultId, 1);
  assert.ok(!f.calls.some((c) => c.kind === "clear"));
  f.state.response = 0;
  assert.deepEqual(await clear(f.trusted), { cleared: true });
  assert.deepEqual(f.calls.find((c) => c.kind === "clear").context, f.state.context);
});

test("stop while identity/privacy is pending prevents later task startup", async () => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture({ onFetch: () => ready });
  const task = f.handlers.get("koswork:computer-start")(f.trusted, {
    project: "project",
    goal: "goal"
  });
  await new Promise(setImmediate);
  assert.deepEqual(f.handlers.get("koswork:computer-stop")(f.trusted), { stopped: true });
  release();
  assert.equal((await task).error, "COMPUTER_IDENTITY_CHANGED");
  assert.ok(!f.calls.some((c) => c.kind === "run"));
});

test("an invalidated computer window cannot resume the previous owner task", async () => {
  const f = await fixture();
  f.api.invalidate();
  const before = f.calls.length;
  assert.deepEqual(f.handlers.get("koswork:computer-resume")(f.trusted), { resumed: false });
  assert.equal(f.calls.length, before);
  assert.ok(f.calls.some((call) => call.kind === "stop"));
});
