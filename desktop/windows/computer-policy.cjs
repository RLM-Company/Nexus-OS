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

module.exports = { validateComputerAction, ComputerSessionGate, keyNames };
