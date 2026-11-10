"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { pathToFileURL } = require("node:url");
const { createKosworkBrowser } = require("../browser/shell.cjs");
async function fixture(options = {}) {
  let window, runnerOptions, runner;
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
    dialog: {
      showMessageBox: async (...args) =>
        options.onDialog ? options.onDialog(args.at(-1), state) : { response: 1 }
    },
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
    history: options.history ?? {
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
      return (runner = {
        active: null,
        stop() {
          calls.push("stop");
          this.active = null;
        },
        resume: () => true,
        run: async (args) => {
          calls.push({ run: args });
          return { status: "completed" };
        }
      });
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
    get runner() {
      return runner;
    },
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
test("only the native Work window can grant and revoke read-only vault access", async () => {
  const f = await fixture({ mode: "work" });
  let allowed = false,
    calls = 0;
  f.workspace.connectVault = async (context, signal, confirm) => {
    calls++;
    assert.equal(context.owner, "owner");
    assert.equal(signal.aborted, false);
    assert.equal(await confirm({ files: 2 }), true);
    allowed = true;
    return { id: "a".repeat(24), name: "Local sources" };
  };
  f.workspace.vaultState = () => allowed;
  f.workspace.revokeVault = () => {
    allowed = false;
  };
  assert.equal((await f.invoke("vault", undefined, { sender: {} })).error, "BROWSER_UNTRUSTED");
  assert.equal(calls, 0);
  assert.equal((await f.invoke("vault")).folder.name, "Local sources");
  assert.equal((await f.invoke("state")).vaultAccess, true);
  assert.equal((await f.invoke("revoke-vault")).revoked, true);
  assert.equal(allowed, false);
  const browser = await fixture();
  browser.workspace.connectVault = () => {
    throw Error("must not be reached");
  };
  assert.equal((await browser.invoke("vault")).error, "COMPUTER_ACTION_INVALID");
});
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

test("native correction writes require confirmation, exact versions and trusted ownership", async () => {
  const id = "00000000-0000-4000-8000-000000000001",
    version = "a".repeat(64);
  let revision = version,
    saved = 0,
    removed = 0,
    suggestions = 0,
    decide = async () => ({ response: 1 });
  const history = {
    list: () => [
      {
        id,
        project: "project",
        executionMode: "work",
        goal: "CSV",
        correctable: true,
        reusable: true
      }
    ],
    correction: () => ({
      taskId: id,
      project: "project",
      source_goal: "CSV",
      revision,
      correction: {
        issue: "Lost zero",
        guidance: "Keep literal text",
        applies_when: "CSV",
        confirmed_at: 1
      }
    }),
    saveCorrection(_context, task, expected, text) {
      assert.equal(task, id);
      assert.equal(expected, revision);
      assert.equal(text.guidance, "Keep 00123");
      saved++;
      return { revision: "b".repeat(64) };
    },
    removeCorrection() {
      removed++;
      return { removed: true };
    },
    suggestCorrections() {
      suggestions++;
      return [];
    }
  };
  const f = await fixture({ mode: "work", history, onDialog: (...args) => decide(...args) });
  const input = {
    taskId: id,
    revision: version,
    correction: { issue: "Lost zero", guidance: "Keep 00123", applies_when: "CSV export" }
  };
  assert.equal(
    (
      await f.invoke("save-correction", input, {
        ...f.trusted,
        senderFrame: { url: "https://evil.test" }
      })
    ).error,
    "BROWSER_UNTRUSTED"
  );
  decide = async () => ({ response: 0 });
  assert.equal((await f.invoke("save-correction", input)).error, "COMPUTER_CANCELLED");
  assert.equal(saved, 0);
  decide = async (value) => {
    assert.match(value.detail, /Keep 00123/);
    return { response: 1 };
  };
  assert.equal((await f.invoke("save-correction", input)).revision, "b".repeat(64));
  assert.equal(saved, 1);
  decide = async () => {
    revision = "c".repeat(64);
    return { response: 1 };
  };
  assert.equal((await f.invoke("save-correction", input)).error, "COMPUTER_REFERENCE_CHANGED");
  assert.equal(saved, 1);
  revision = version;
  decide = async () => {
    f.state.context = { ...f.state.context, owner: "other" };
    return { response: 1 };
  };
  assert.match((await f.invoke("save-correction", input)).error, /IDENTITY_CHANGED/);
  assert.equal(saved, 1);
  f.state.context = { owner: "owner", origin: "https://example.test" };
  assert.equal(
    (await f.invoke("suggest-corrections", { project: "foreign", goal: "CSV" })).error,
    "COMPUTER_REFERENCE_UNAVAILABLE"
  );
  assert.equal(suggestions, 0);
  decide = async () => ({ response: 1 });
  f.runner.active = { reference: { taskId: id, revision } };
  assert.equal((await f.invoke("remove-correction", { taskId: id, revision })).removed, true);
  assert.equal(removed, 1);
  assert.equal(f.runner.active, null);
  assert.ok(f.calls.includes("stop"));
  f.browser.invalidate();
});

test("stop and concurrent correction approval cannot commit a late mutation", async () => {
  const id = "00000000-0000-4000-8000-000000000001",
    revision = "a".repeat(64);
  let enter,
    release,
    saved = 0;
  const ready = new Promise((resolve) => {
    enter = resolve;
  });
  const f = await fixture({
    mode: "work",
    history: {
      list: () => [{ id, project: "project", executionMode: "work", correctable: true }],
      correction: () => ({
        taskId: id,
        project: "project",
        source_goal: "CSV",
        revision,
        correction: null
      }),
      saveCorrection() {
        saved++;
      }
    },
    onDialog: async () => {
      enter();
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  });
  const input = {
    taskId: id,
    revision,
    correction: { issue: "Wrong type", guidance: "Keep literal text", applies_when: "CSV" }
  };
  const pending = f.invoke("save-correction", input);
  await ready;
  assert.equal((await f.invoke("save-correction", input)).error, "COMPUTER_BUSY");
  await f.invoke("stop");
  release({ response: 1 });
  assert.match((await pending).error, /SESSION_STOPPED|IDENTITY_CHANGED/);
  assert.equal(saved, 0);
  assert.equal((await f.invoke("correction", { taskId: id })).revision, revision);
  f.browser.invalidate();
});
