"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CAPABILITIES,
  ExecutorTargetError,
  localTarget,
  remoteTarget,
  supports,
  requiresNativeLease,
  authorize,
  portableCheckpoint
} = require("../executor-target.cjs");

test("local target declares capabilities and carries no credentials", () => {
  const target = localTarget({ workspaceId: "w1", ownerId: "owner" });
  assert.equal(target.kind, "local");
  assert.equal(target.workspace_id, "w1");
  assert.deepEqual(target.credentials, {});
  assert.equal(supports(target, CAPABILITIES.NATIVE_FOCUS), true);
});

test("remote target only declares the capabilities it supports", () => {
  const target = remoteTarget({
    targetId: "runner-1",
    ownerId: "owner",
    capabilities: [CAPABILITIES.DOM_READ, CAPABILITIES.DOM_INPUT]
  });
  assert.equal(supports(target, CAPABILITIES.NATIVE_FOCUS), false);
  assert.throws(
    () => remoteTarget({ targetId: "x", ownerId: "o", capabilities: ["unknown"] }),
    (e) => e instanceof ExecutorTargetError && e.code === "TARGET_CAPABILITIES_INVALID"
  );
  assert.throws(() => remoteTarget({ ownerId: "o" }), /TARGET_ID_INVALID/);
});

test("authorization binds owner, operation and capability, and reports lease need", () => {
  const target = localTarget({ ownerId: "owner" });
  const receipt = authorize(target, "open_app", {
    ownerId: "owner",
    operationKind: CAPABILITIES.NATIVE_FOCUS
  });
  assert.equal(receipt.native_lease_required, true);
  assert.equal(receipt.credential_copied, false);
  assert.equal(
    authorize(target, "browser_read", {
      ownerId: "owner",
      operationKind: CAPABILITIES.DOM_READ
    }).native_lease_required,
    false
  );
  assert.throws(
    () =>
      authorize(target, "open_app", {
        ownerId: "other",
        operationKind: CAPABILITIES.NATIVE_FOCUS
      }),
    (e) => e.code === "TARGET_OWNER_MISMATCH"
  );
  assert.throws(
    () =>
      authorize(remoteTarget({ targetId: "r", ownerId: "owner", capabilities: [] }), "open_app", {
        ownerId: "owner",
        operationKind: CAPABILITIES.NATIVE_FOCUS
      }),
    (e) => e.code === "TARGET_CAPABILITY_MISSING"
  );
});

test("portable checkpoint carries references, never credentials or grants", () => {
  const target = remoteTarget({
    targetId: "runner-1",
    ownerId: "owner",
    capabilities: [CAPABILITIES.DOM_READ]
  });
  const checkpoint = portableCheckpoint({
    target,
    taskId: "task-1",
    checkpointIds: ["cp-a", "cp-b"],
    summary: "Step done"
  });
  assert.equal(checkpoint.target_id, "runner-1");
  assert.deepEqual(checkpoint.checkpoint_ids, ["cp-a", "cp-b"]);
  assert.deepEqual(checkpoint.credentials, {});
  assert.deepEqual(checkpoint.device_grants, []);
  assert.throws(() => portableCheckpoint({ taskId: "x" }), /CHECKPOINT_INVALID/);
});

test("native-focus operations are explicitly listed", () => {
  assert.equal(requiresNativeLease("browser_click_at"), false);
  assert.equal(requiresNativeLease("click_at"), true);
  assert.equal(requiresNativeLease("open_app"), true);
});
