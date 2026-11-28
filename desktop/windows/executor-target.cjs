"use strict";

/**
 * Portable executor target descriptor for local and future remote runners.
 *
 * Purpose: give Harness 1 / Grok / OpenCode 2 a single, explicit interface for
 * "where does an action execute and what may it do" WITHOUT copying device
 * grants, cookies or passwords between targets. A target is data, not a live
 * connection: transport binding stays with the caller.
 *
 * No new permissions are granted here. The set of operations is the already
 * validated `computer-policy.cjs` action kinds, filtered by declared
 * capabilities. Local and remote targets are described the same way; moving a
 * checkpoint to another target never carries credentials.
 */

const LOCAL_TARGET_ID = "local-device";

const CAPABILITIES = Object.freeze({
  NATIVE_FOCUS: "native_focus", // may move the single system cursor/keyboard focus
  DOM_READ: "dom_read", // may read DOM in an isolated context
  DOM_INPUT: "dom_input", // may type/click inside an isolated renderer context
  FILES: "files", // may use the chosen workspace folder
  BROWSER: "browser", // may drive the browser engine
  DOWNLOADS: "downloads" // may reserve/verify a download
});

const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

// Operations that move the shared native focus and therefore require a device
// lease. DOM-only reads/actions may run concurrently in isolated contexts.
const NATIVE_FOCUS_OPERATIONS = Object.freeze([
  "open_app",
  "click_at",
  "key",
  "computer_click",
  "computer_key"
]);

class ExecutorTargetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** A local target uses the already-running device; it needs no credentials. */
function localTarget({ workspaceId = null, ownerId } = {}) {
  if (!ownerId) throw new ExecutorTargetError("TARGET_OWNER_REQUIRED");
  return Object.freeze({
    target_id: LOCAL_TARGET_ID,
    kind: "local",
    owner_id: ownerId,
    workspace_id: workspaceId,
    capabilities: Object.freeze([...ALL_CAPABILITIES]),
    // Explicitly empty: a target descriptor is never a credential container.
    credentials: Object.freeze({}),
    created_at: 0
  });
}

/**
 * Remote targets are declared with only the capabilities the remote runner is
 * known to support. No cookies, tokens or device grants are copied.
 */
function remoteTarget({ targetId, ownerId, capabilities = [] } = {}) {
  if (!targetId || typeof targetId !== "string" || targetId.length > 120)
    throw new ExecutorTargetError("TARGET_ID_INVALID");
  if (!ownerId) throw new ExecutorTargetError("TARGET_OWNER_REQUIRED");
  if (!Array.isArray(capabilities) || capabilities.some((c) => !ALL_CAPABILITIES.includes(c)))
    throw new ExecutorTargetError("TARGET_CAPABILITIES_INVALID");
  return Object.freeze({
    target_id: targetId,
    kind: "remote",
    owner_id: ownerId,
    workspace_id: null,
    capabilities: Object.freeze([...new Set(capabilities)]),
    credentials: Object.freeze({}),
    created_at: 0
  });
}

function supports(target, capability) {
  return !!target && Array.isArray(target.capabilities) && target.capabilities.includes(capability);
}

/** True when an operation needs the exclusive native-focus device lease. */
function requiresNativeLease(operation) {
  return NATIVE_FOCUS_OPERATIONS.includes(operation);
}

/**
 * Authorize an operation against a target descriptor. This is a capability
 * check only — the real action still passes through computer-policy and the
 * device lease. Returns a bounded receipt, never a transport handle.
 */
function authorize(target, operation, { ownerId, operationKind } = {}) {
  if (!target || !["local", "remote"].includes(target.kind))
    throw new ExecutorTargetError("TARGET_INVALID");
  if (ownerId !== target.owner_id) throw new ExecutorTargetError("TARGET_OWNER_MISMATCH");
  if (!operation || typeof operation !== "string" || operation.length > 120)
    throw new ExecutorTargetError("TARGET_OPERATION_INVALID");
  if (!ALL_CAPABILITIES.includes(operationKind ?? ""))
    throw new ExecutorTargetError("TARGET_CAPABILITY_INVALID");
  if (!supports(target, operationKind)) throw new ExecutorTargetError("TARGET_CAPABILITY_MISSING");
  return Object.freeze({
    target_id: target.target_id,
    kind: target.kind,
    operation,
    capability: operationKind,
    native_lease_required: requiresNativeLease(operation),
    credential_copied: false
  });
}

/**
 * A portable checkpoint: references opaque artifact/checkpoint IDs but carries
 * no bytes, credentials, cookies or device grants. Safe to hand to Harness 1.
 */
function portableCheckpoint({ target, taskId, checkpointIds = [], summary = "" } = {}) {
  if (!target || !target.target_id || !taskId) throw new ExecutorTargetError("CHECKPOINT_INVALID");
  if (!Array.isArray(checkpointIds) || checkpointIds.length > 64)
    throw new ExecutorTargetError("CHECKPOINT_INVALID");
  return Object.freeze({
    target_id: target.target_id,
    kind: target.kind,
    task_id: String(taskId).slice(0, 200),
    checkpoint_ids: Object.freeze(checkpointIds.map((id) => String(id).slice(0, 200))),
    summary: String(summary).slice(0, 2000),
    // Explicit: transfer never carries these.
    credentials: Object.freeze({}),
    device_grants: Object.freeze([])
  });
}

module.exports = {
  CAPABILITIES,
  ALL_CAPABILITIES,
  NATIVE_FOCUS_OPERATIONS,
  ExecutorTargetError,
  LOCAL_TARGET_ID,
  localTarget,
  remoteTarget,
  supports,
  requiresNativeLease,
  authorize,
  portableCheckpoint
};
