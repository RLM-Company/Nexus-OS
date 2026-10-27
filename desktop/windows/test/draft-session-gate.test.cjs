"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDraftSessionGate } = require("../draft-session-gate.cjs");
const origin = "https://kosmora.example";
const ownerA = "local-owner";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const chat = "chat:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("draft writes require owner-bound hydration of the same document and scope", () => {
  const gate = createDraftSessionGate();
  const version = gate.documentVersion();
  assert.equal(gate.allowWrite(version, origin, ownerA, chat), false);
  assert.equal(gate.bindLoad(version, origin, ownerA, chat), true);
  assert.equal(gate.allowWrite(version, origin, ownerA, chat), true);
  assert.equal(gate.ownerForFlush(version, origin, chat), ownerA);
  assert.equal(gate.allowWrite(version, origin, ownerB, chat), false);
  assert.equal(gate.bindLoad(version, origin, ownerB, chat), false);
  assert.equal(gate.bindLoad(version, "https://other.example", ownerA, chat), false);
  assert.equal(gate.allowWrite(version, origin, ownerA, "new-chat"), false);
  assert.equal(gate.bindLoad(version, origin, ownerA, "new-chat"), true);
  assert.equal(gate.allowWrite(version, origin, ownerA, "new-chat"), true);
  gate.reset(); // logout, full reload, or origin change
  assert.equal(gate.allowWrite(version, origin, ownerA, chat), false);
  assert.equal(gate.ownerForFlush(version, origin, chat), null);
  assert.equal(gate.bindLoad(version, origin, ownerA, chat), false);
  assert.equal(gate.bindLoad(gate.documentVersion(), origin, ownerB, chat), true);
  assert.equal(gate.allowWrite(gate.documentVersion(), origin, ownerA, chat), false);
});
