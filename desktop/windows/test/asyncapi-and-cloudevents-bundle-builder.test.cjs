"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildAsyncApiAndCloudEvents,
  saveAsyncApiAndCloudEventsToWorkspace
} = require("../workspace/asyncapi-and-cloudevents-bundle-builder.cjs");

test("AsyncAPI 2.6.0 & CNCF CloudEvents 1.0 Builder emits valid channel specs and event batches", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-asyncapi-ce-"));

  const built = buildAsyncApiAndCloudEvents({
    title: "Kosmora Actor Bus",
    channels: [
      {
        topic: "kosmora/raft/commits",
        description: "Replicated state machine commit stream"
      }
    ],
    cloudEvents: [
      {
        type: "ai.kosmora.raft.committed",
        source: "urn:kosmora:raft:node-a",
        data: { term: 3, commitIndex: 42 }
      }
    ]
  });

  assert.equal(built.channelCount, 1);
  assert.equal(built.eventCount, 1);
  const asyncApi = JSON.parse(built.asyncApiJson);
  const ce = JSON.parse(built.cloudEventsJson);

  assert.equal(asyncApi.asyncapi, "2.6.0");
  assert.ok(asyncApi.channels["kosmora/raft/commits"]);
  assert.equal(ce[0].specversion, "1.0");
  assert.equal(ce[0].type, "ai.kosmora.raft.committed");

  const saved = saveAsyncApiAndCloudEventsToWorkspace(workspaceDir, "mesh-bus", {
    channels: [{ topic: "t1" }],
    cloudEvents: [{ type: "e1" }]
  });

  assert.equal(fs.existsSync(saved.asyncApiPath), true);
  assert.equal(fs.existsSync(saved.cloudEventsPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveAsyncApiAndCloudEventsToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
