"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { pathToFileURL } = require("node:url");
const { createKosworkBrowser } = require("../browser/shell.cjs");
const context = { owner: "A", origin: "https://example.test" },
  input = { project: "project-A", goal: "Exact task" },
  requestId = "44444444-4444-4444-8444-444444444444",
  document = "brief-prices-csv-v7",
  binding = { requestId, document },
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
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
    show: (options = binding) => shell.show(input, (v) => delivered.push(v), context, options),
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
function boundedReceipt(ticket, overrides = {}) {
  return {
    receipt_version: 1,
    task_id: ticket.task_id,
    request_id: ticket.request_id,
    observation_id: "22222222-2222-4222-8222-222222222222",
    nonce: ticket.nonce,
    owner: context.owner,
    origin: context.origin,
    project: ticket.project,
    document: ticket.document,
    environment: "none",
    generation: 7,
    steps: 2,
    checked: { count: 2, status: "checked" },
    ...overrides
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
test("real start supplies the originating ticket and delivers a bounded checked-plan receipt", async (t) => {
  const f = fixture(t),
    tickets = [];
  f.setRun(async (value) => {
    const ticket = value.resultTicket;
    tickets.push(ticket);
    assert.equal(value.executionMode, undefined);
    assert.equal(value.expectedContext, context);
    assert.equal(value.maxSteps, 90);
    assert.equal(ticket.project, input.project);
    assert.equal(ticket.request_id, requestId);
    assert.equal(ticket.document, document);
    assert.match(ticket.task_id, uuid);
    assert.match(ticket.nonce, uuid);
    assert.notEqual(ticket.request_id, ticket.task_id);
    assert.notEqual(ticket.request_id, ticket.nonce);
    return {
      status: "completed",
      summary: "Exact result 00123",
      steps: 3,
      receipt: {
        ...boundedReceipt(ticket),
        local_path: "C:\\private\\brief.csv",
        screenshot: "base64",
        owner_accepted: true,
        verified: true,
        source: "server_attestation"
      }
    };
  });
  await f.show();
  assert.equal((await f.command("start", input)).status, "completed");
  assert.equal(tickets.length, 1);
  const outcome = f.delivered[0];
  assert.equal(outcome.source, "local_agent_report");
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.owner_accepted, false);
  assert.equal(outcome.receipt_omitted, undefined);
  assert.equal(outcome.receipt.receipt_version, 1);
  assert.equal(outcome.receipt.kind, "native_work_plan_observed");
  assert.equal(outcome.receipt.task_id, tickets[0].task_id);
  assert.equal(outcome.receipt.nonce, tickets[0].nonce);
  assert.equal(outcome.receipt.project, input.project);
  assert.equal(outcome.receipt.document, document);
  assert.equal(outcome.receipt.owner, context.owner);
  assert.equal(outcome.receipt.origin, context.origin);
  assert.equal(outcome.receipt.generation, 7);
  assert.deepEqual(outcome.receipt.checked, { count: 2, status: "checked" });
  assert.equal(outcome.receipt.checked.criteria, undefined);
  assert.equal(outcome.receipt.owner_accepted, false);
  assert.equal(outcome.receipt.local_path, undefined);
  assert.equal(outcome.receipt.screenshot, undefined);
  assert.equal(outcome.receipt.verified, undefined);
  assert.equal(outcome.receipt.source, "local_agent_report");
  assert.ok(JSON.stringify(outcome.receipt).length <= 2400);
  for (const forbidden of [
    "private",
    "brief.csv",
    "base64",
    "server_attestation",
    "CSV readback",
    "Exact total"
  ])
    assert.equal(JSON.stringify(outcome.receipt).includes(forbidden), false);
});
test("a receipt cannot be bound to a different originating request or document", async (t) => {
  for (const options of [
    { requestId: "55555555-5555-4555-8555-555555555555", document },
    { requestId, document: "different-source-document" },
    {}
  ]) {
    const f = fixture(t);
    const open = f.show(options);
    if (options && options.requestId && options.document) await open;
    else await assert.rejects(open, /COMPUTER_PROPOSAL_INVALID/);
    if (!options || !options.requestId || !options.document) continue;
    f.setRun(async (value) => ({
      status: "completed",
      summary: "Done",
      receipt: boundedReceipt(value.resultTicket, { request_id: requestId, document })
    }));
    await f.command("start", input);
    const outcome = f.delivered.at(-1);
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.receipt, undefined);
    assert.equal(outcome.receipt_omitted, true);
    assert.equal(outcome.owner_accepted, false);
  }
});
test("legacy show without receipt binding still delivers its bounded summary", async (t) => {
  const f = fixture(t);
  await f.show(null);
  await f.command("start", input);
  assert.equal(f.delivered[0].status, "completed");
  assert.equal(f.delivered[0].summary, "Exact result 🌙");
  assert.equal(f.delivered[0].receipt, undefined);
});
test("raw checked criteria are rejected even when the trusted one-shot ticket is real", async (t) => {
  const f = fixture(t);
  f.setRun(async (value) => ({
    status: "completed",
    summary: "Done",
    receipt: boundedReceipt(value.resultTicket, {
      checked: { count: 2, criteria: ["CSV readback matches 00123", "Exact total 42"] }
    })
  }));
  await f.show();
  await f.command("start", input);
  const outcome = f.delivered[0];
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.receipt, undefined);
  assert.equal(outcome.receipt_omitted, true);
  assert.equal(outcome.owner_accepted, false);
  assert.equal(JSON.stringify(outcome).includes("CSV readback"), false);
});
test("incomplete, unknown-version and mismatched receipts cannot raise a completed local report", async (t) => {
  for (const mutate of [
    () => undefined,
    () => ({}),
    () => ({ receipt_version: 2 }),
    () => ({ receipt_version: 1, task_id: "not-a-uuid" }),
    (ticket) =>
      boundedReceipt(ticket, {
        task_id: "11111111-1111-4111-8111-111111111111",
        project: "different-project",
        checked: { count: 1, status: "checked" }
      }),
    (ticket) =>
      boundedReceipt(ticket, {
        document: "C:\\private\\brief.csv",
        environment: "shell",
        checked: { count: 2, status: "verified" }
      }),
    (ticket) =>
      boundedReceipt(ticket, {
        checked: { count: 2, status: "checked", criteria: ["Private plan text"] }
      })
  ]) {
    const f = fixture(t);
    let rawReceipt;
    f.setRun(async (value) => {
      rawReceipt = mutate(value.resultTicket);
      return { status: "completed", summary: "Done", receipt: rawReceipt };
    });
    await f.show();
    await f.command("start", input);
    const outcome = f.delivered[0];
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.receipt, undefined);
    assert.equal(outcome.owner_accepted, false);
    assert.equal(outcome.source, "local_agent_report");
    assert.equal(outcome.receipt_omitted, rawReceipt === undefined ? undefined : true);
    assert.equal(JSON.stringify(outcome).includes("Private plan text"), false);
  }
});
test("stop and emergency takeover discard late successful result reports and their receipts", async (t) => {
  for (const method of ["stop", "hotkey"]) {
    const f = fixture(t);
    await f.show();
    let enter, release;
    const ready = new Promise((r) => {
      enter = r;
    });
    f.setRun(async (value) => {
      enter();
      await new Promise((r) => {
        release = r;
      });
      return {
        status: "completed",
        summary: "Late private",
        receipt: boundedReceipt(value.resultTicket, {
          steps: 1,
          checked: { count: 1, status: "checked" }
        })
      };
    });
    const pending = f.command("start", input);
    await ready;
    if (method === "stop") f.shell.stop();
    else f.hotkey();
    assert.equal(f.delivered[0].status, "cancelled");
    assert.equal(f.delivered[0].receipt, undefined);
    assert.equal(f.delivered[0].owner_accepted, false);
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
  assert.equal(f.delivered[0].receipt, undefined);
  f.onIdentity(null);
  await f.command("start", input);
  assert.equal(f.delivered.length, 1);
});
