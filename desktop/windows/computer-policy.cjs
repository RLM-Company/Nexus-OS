"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const keyNames = new Set([
  "CTRL",
  "ALT",
  "SHIFT",
  "ENTER",
  "TAB",
  "ESCAPE",
  "BACKSPACE",
  "DELETE",
  "HOME",
  "END",
  "PAGEUP",
  "PAGEDOWN",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "SPACE",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)
]);
const fields = {
  browser_open: ["url"],
  browser_search: ["query"],
  browser_tabs: [],
  browser_switch: ["tab_id"],
  browser_close: ["tab_id"],
  browser_back: [],
  browser_forward: [],
  browser_reload: [],
  browser_read: [],
  browser_screenshot: [],
  browser_click: ["ref"],
  browser_fill: ["ref", "text"],
  browser_key: ["ref", "key"],
  browser_scroll: ["direction", "amount"],
  browser_click_at: ["x", "y"],
  browser_upload: ["ref", "path"],
  browser_download: ["ref"],
  workspace_list: ["path", "cursor"],
  workspace_find: ["path", "mode", "query"],
  workspace_read: ["path"],
  workspace_mkdir: ["path"],
  workspace_create: ["path", "content"],
  workspace_update: ["path", "content", "expected_version"],
  workspace_backups: ["path"],
  workspace_restore: ["backup_id", "expected_version"],
  observe: [],
  list_apps: [],
  find_apps: ["query"],
  open_app: ["app_id"],
  open_url: ["url"],
  open_file: ["path"],
  focus: ["window_id"],
  hover: ["x", "y"],
  drag: ["from_x", "from_y", "to_x", "to_y"],
  click: ["x", "y", "button", "count"],
  type_text: ["text"],
  press: ["keys"],
  scroll: ["direction", "amount"],
  wait: ["milliseconds"],
  ask_user: ["question"],
  done: ["summary"]
};
const string = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");

function validateComputerAction(action) {
  if (
    !action ||
    typeof action !== "object" ||
    Array.isArray(action) ||
    !Object.hasOwn(fields, action.kind)
  )
    throw Error("COMPUTER_ACTION_INVALID");
  const expected = ["kind", ...fields[action.kind]];
  if (
    Object.keys(action).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(action, key))
  )
    throw Error("COMPUTER_ACTION_INVALID");
  const valid = (() => {
    if (action.kind.startsWith("browser_")) {
      try {
        if (action.kind === "browser_open")
          return require("./browser/policy.cjs").safeUrl(action.url) !== null;
        if (action.kind === "browser_search") {
          require("./browser/search.cjs").query(action.query);
          return true;
        }
        if (action.kind === "browser_click_at")
          return [action.x, action.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
        if (action.kind === "browser_scroll")
          return (
            ["up", "down"].includes(action.direction) &&
            Number.isInteger(action.amount) &&
            action.amount >= 1 &&
            action.amount <= 5
          );
        if (Object.hasOwn(action, "tab_id") && !/^[a-f0-9]{12}$/.test(action.tab_id)) return false;
        if (Object.hasOwn(action, "ref") && !/^e[1-9][0-9]{0,6}$/.test(action.ref)) return false;
        if (
          action.kind === "browser_fill" &&
          (typeof action.text !== "string" ||
            action.text.length > 4000 ||
            /[\u0000]/.test(action.text))
        )
          return false;
        if (action.kind === "browser_key" && !["ENTER", "TAB", "ESCAPE"].includes(action.key))
          return false;
        if (action.kind === "browser_upload")
          require("./workspace/path-guard.cjs").validateRelativePath(action.path);
        return true;
      } catch {
        return false;
      }
    }
    if (action.kind.startsWith("workspace_")) {
      try {
        if (action.kind !== "workspace_restore")
          require("./workspace/path-guard.cjs").validateRelativePath(action.path, {
            allowEmpty: ["workspace_list", "workspace_find"].includes(action.kind)
          });
        if (
          action.kind === "workspace_list" &&
          (!Number.isInteger(action.cursor) || action.cursor < 0 || action.cursor > 2000)
        )
          return false;
        if (
          action.kind === "workspace_find" &&
          (!["name", "text"].includes(action.mode) || !string(action.query, 200))
        )
          return false;
        if (
          ["workspace_create", "workspace_update"].includes(action.kind) &&
          (typeof action.content !== "string" ||
            action.content.length > 10000 ||
            action.content.includes("\0"))
        )
          return false;
        if (
          ["workspace_update", "workspace_restore"].includes(action.kind) &&
          !/^sha256:[a-f0-9]{64}$/.test(action.expected_version)
        )
          return false;
        if (
          action.kind === "workspace_restore" &&
          !/^bkp_\d{1,16}_[a-f0-9]{12}$/.test(action.backup_id)
        )
          return false;
        return true;
      } catch {
        return false;
      }
    }
    switch (action.kind) {
      case "observe":
      case "list_apps":
        return true;
      case "find_apps":
        return string(action.query, 100);
      case "open_app":
        return string(action.app_id, 240) && /^[a-zA-Z0-9_. -]+$/.test(action.app_id);
      case "open_url": {
        if (!string(action.url, 2048)) return false;
        try {
          const u = new URL(action.url);
          return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
        } catch {
          return false;
        }
      }
      case "open_file":
        return (
          string(action.path, 1000) &&
          /^[a-zA-Z]:\\/.test(action.path) &&
          path.win32.isAbsolute(action.path) &&
          !action.path.startsWith("\\\\") &&
          !/[:]/.test(action.path.slice(2)) &&
          /\.(txt|md|csv|json|pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|html?)$/i.test(action.path)
        );
      case "focus":
        return string(action.window_id, 32) && /^\d+$/.test(action.window_id);
      case "click":
        return (
          Number.isFinite(action.x) &&
          action.x >= 0 &&
          action.x <= 1 &&
          Number.isFinite(action.y) &&
          action.y >= 0 &&
          action.y <= 1 &&
          ["left", "right"].includes(action.button) &&
          [1, 2].includes(action.count)
        );
      case "hover":
      case "drag":
        return fields[action.kind].every(
          (key) => Number.isFinite(action[key]) && action[key] >= 0 && action[key] <= 1
        );
      case "type_text":
        return string(action.text, 4000);
      case "press":
        return (
          Array.isArray(action.keys) &&
          action.keys.length >= 1 &&
          action.keys.length <= 4 &&
          new Set(action.keys).size === action.keys.length &&
          action.keys.every((key) => keyNames.has(key))
        );
      case "scroll":
        return (
          ["up", "down", "left", "right"].includes(action.direction) &&
          Number.isInteger(action.amount) &&
          action.amount >= 1 &&
          action.amount <= 10
        );
      case "wait":
        return (
          Number.isInteger(action.milliseconds) &&
          action.milliseconds >= 100 &&
          action.milliseconds <= 2000
        );
      case "ask_user":
        return string(action.question, 2000);
      case "done":
        return string(action.summary, 4000);
      default:
        return false;
    }
  })();
  if (!valid) throw Error("COMPUTER_ACTION_INVALID");
  return structuredClone(action);
}

/** A local, time-limited grant. Nothing here is restored on restart or received from a web page. */
class ComputerSessionGate {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.grant = null;
    this.used = new Set();
  }
  enable({ origin, owner, project, goal, durationMs = 30 * 60_000 }) {
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      !string(owner, 160) ||
      !string(project, 160) ||
      !string(goal, 8000) ||
      !Number.isInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 30 * 60_000
    )
      throw Error("COMPUTER_GRANT_INVALID");
    this.used.clear();
    this.grant = {
      id: crypto.randomUUID(),
      origin,
      owner,
      project,
      goal,
      expires: this.now() + durationMs
    };
    return { ...this.grant };
  }
  assert(context) {
    const g = this.grant;
    if (
      !g ||
      this.now() >= g.expires ||
      ["id", "origin", "owner", "project", "goal"].some((key) => context[key] !== g[key])
    )
      throw Error("COMPUTER_SESSION_STOPPED");
  }
  consume(context, actionId, action) {
    this.assert(context);
    const result = validateComputerAction(action);
    if (!string(actionId, 160) || this.used.has(actionId))
      throw Error("COMPUTER_ACTION_ALREADY_USED");
    this.used.add(actionId); // Unknown outcomes are never silently repeated.
    return result;
  }
  stop() {
    this.grant = null;
    this.used.clear();
  }
}

const computerActionKinds = Object.freeze(Object.keys(fields));
const recoveryWriteActions = new Set([
  "browser_open",
  "browser_close",
  "browser_click",
  "browser_fill",
  "browser_key",
  "browser_upload",
  "browser_download",
  "browser_click_at",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "workspace_create",
  "workspace_update",
  "workspace_restore",
  "workspace_mkdir",
  "open_app",
  "open_url",
  "open_file",
  "click",
  "drag",
  "type_text",
  "press"
]);
module.exports = {
  validateComputerAction,
  ComputerSessionGate,
  keyNames,
  computerActionKinds,
  recoveryWriteActions
};
