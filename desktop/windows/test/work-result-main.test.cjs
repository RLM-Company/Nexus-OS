"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { randomUUID } = require("node:crypto");
const { createWorkResultRelay, deliverWorkResult } = require("../work-result.cjs");

// Execute the actual IPC registration without starting Electron or touching a desktop.
function fixture() {
  const source = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
  const start = source.indexOf('ipcMain.handle("koswork:work-open",');
  const end = source.indexOf('\nipcMain.handle("cosmora:draft-load",', start);
  assert.ok(start > 0 && end > start);
  const context = { owner: "owner-A", origin: "https://example.test" };
  const sent = [],
    relay = createWorkResultRelay();
  let handler,
    ticket,
    callback,
    options,
    owner = context.owner,
    doc = 4,
    allowed = true;
  const api = {
    ipcMain: {
      handle: (_name, fn) => {
        handler = fn;
      }
    },
    kosworkWorkCycle: {
      async show(input, fn, expected, binding) {
        assert.equal(expected.owner, owner);
        callback = fn;
        options = binding;
        ticket = relay.bind(expected, input, fn, binding);
        assert.equal(relay.claim(expected, input.project, input.goal), ticket);
      },
      canReturnResult: async () => allowed
    },
    isTrustedRemoteEvent: () => true,
    identityEpoch: 1,
    currentOrigin: context.origin,
    verifiedOwner: async () => owner,
    draftSessionGate: { documentVersion: () => doc },
    randomUUID,
    deliverWorkResult
  };
  vm.runInNewContext(source.slice(start, end), api);
  const event = { sender: { send: (_channel, value) => sent.push(value) } };
  return {
    sent,
    async open() {
      return handler(event, { project: "project-A", goal: "Exact fixture" });
    },
    options: () => options,
    finish() {
      const binding = relay.ticketFor(ticket);
      if (!binding) return false;
      return relay.finish(ticket, {
        status: "completed",
        summary: "Readback complete",
        task_id: randomUUID(),
        receipt: {
          receipt_version: 1,
          task_id: binding.taskId,
          request_id: binding.requestId,
          observation_id: randomUUID(),
          nonce: binding.nonce,
          owner: context.owner,
          origin: context.origin,
          project: "project-A",
          document: binding.document,
          environment: "none",
          generation: 2,
          steps: 2,
          checked: { count: 2, status: "checked" }
        }
      });
    },
    spoof: () => callback({ status: "completed", receipt: { receipt_version: 1 } }, {}),
    setOwner: (value) => {
      owner = value;
    },
    setDocument: (value) => {
      doc = value;
    },
    setAllowed: (value) => {
      allowed = value;
    }
  };
}
const flushed = () => new Promise((resolve) => setImmediate(resolve));

test("actual main handler returns the receipt to its original request without private binding fields", async () => {
  const f = fixture(),
    opened = await f.open();
  assert.equal(opened.ok, true);
  assert.equal(f.options().requestId, opened.request_id);
  assert.equal(f.options().document, "window:4");
  assert.equal(f.finish(), true);
  assert.equal(f.finish(), false);
  await flushed();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].request_id, opened.request_id);
  assert.equal(f.sent[0].project, "project-A");
  assert.equal(f.sent[0].result.receipt.checked.count, 2);
  assert.equal(f.sent[0].result.owner_accepted, false);
  for (const field of ["owner", "origin", "document", "nonce", "request_id", "criteria"])
    assert.equal(Object.hasOwn(f.sent[0].result.receipt, field), false);
});

test("actual main callback rejects a changed document/owner and redacts revoked result access", async () => {
  for (const changed of ["document", "owner", "privacy"]) {
    const f = fixture();
    await f.open();
    if (changed === "document") f.setDocument(5);
    if (changed === "owner") f.setOwner("owner-B");
    if (changed === "privacy") f.setAllowed(false);
    f.finish();
    await flushed();
    if (changed === "privacy") {
      assert.equal(f.sent[0].result.status, "unavailable");
      assert.equal(f.sent[0].result.receipt, undefined);
    } else assert.equal(f.sent.length, 0);
  }
});
