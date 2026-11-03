"use strict";
const { createHash } = require("node:crypto");

// Only definite, local pre-effect rejections. Unknown/partial effects continue
// to stop at the existing executor boundary; page text is never a signal here.
const trackable = new Set([
  "WORK_PLAN_REQUIRED",
  "WORK_ENVIRONMENT_REQUIRED",
  "WORK_STEP_REQUIRED",
  "WORK_FORMAT_UNSUPPORTED",
  "WORKSPACE_VERSION_CONFLICT",
  "WORKSPACE_ALREADY_EXISTS",
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_NOT_A_FILE",
  "WORKSPACE_NOT_A_DIRECTORY",
  "WORKSPACE_FILE_TOO_LARGE",
  "WORKSPACE_BINARY_FILE",
  "WORKSPACE_PROTECTED_PATH",
  "WORKSPACE_PATH_TRAVERSAL",
  "WORKSPACE_SYMLINK_REJECTED",
  "WORKSPACE_RESULT_TOO_LARGE",
  "WORKSPACE_RANGE_INVALID",
  "COMPUTER_TARGET_OCCLUDED",
  "BROWSER_ELEMENT_UNAVAILABLE",
  "BROWSER_TAB_LIMIT"
]);
function canonical(value, depth = 0) {
  if (depth > 8) throw Error("WORK_RETRY_KEY_INVALID");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonical(v, depth + 1)).join(",") + "]";
  if (
    value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return (
      "{" +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k], depth + 1))
        .join(",") +
      "}"
    );
  throw Error("WORK_RETRY_KEY_INVALID");
}
function keyFor(action, observation) {
  const workspace = action.kind.startsWith("workspace_");
  const browser = action.kind.startsWith("browser_");
  const args = { ...action };
  // Fresh observation IDs do not change the meaning of a Work progress update.
  // The original action is still validated/executed with its real observation ID.
  if (action.kind === "work_step") delete args.observation_id;
  const scope = workspace
    ? { workspace: observation.workspace?.id ?? null }
    : browser
      ? {
          tab: observation.browser?.tab_id ?? null,
          ...(typeof action.ref === "string"
            ? { generation: observation.browser?.generation ?? null }
            : {})
        }
      : {
          environment: observation.work?.environment ?? null,
          window: observation.active_window ?? null
        };
  const text = canonical({ action: args, scope });
  if (Buffer.byteLength(text) > 60000) throw Error("WORK_RETRY_KEY_INVALID");
  return createHash("sha256").update(text).digest("hex");
}
class WorkRetryGuard {
  constructor() {
    this.failures = new Map();
    this.last = null;
  }
  recordFailure(action, observation, reason) {
    if (!trackable.has(reason)) return null;
    const key = keyFor(action, observation);
    const prior = this.failures.get(key);
    const count = (prior?.reason === reason ? prior.failures : 0) + 1;
    this.failures.delete(key);
    this.last = { failures: count, reason, action_kind: action.kind };
    this.failures.set(key, this.last);
    if (this.failures.size > 64) this.failures.delete(this.failures.keys().next().value);
    return this.snapshot();
  }
  recordSuccess(action, observation) {
    this.failures.delete(keyFor(action, observation));
    this.last = null;
  }
  snapshot() {
    if (!this.last || this.last.failures < 2) return null;
    return {
      ...this.last,
      stop_after: 3,
      instruction:
        "This exact action was rejected before execution repeatedly. Change the approach using fresh evidence or ask the owner. Do not repeat it unchanged; the next identical rejection stops this Work run."
    };
  }
  assertCanContinue() {
    if ((this.last?.failures ?? 0) >= 3) throw Error("WORK_REPEATED_FAILURES");
  }
}
module.exports = { WorkRetryGuard };
