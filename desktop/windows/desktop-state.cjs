"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { safeWorkspaceRoute } = require("./desktop-recovery.cjs");

const DEFAULTS = Object.freeze({
  restorePage: true,
  askWhereToSave: false,
  downloadDirectory: null,
  trayEnabled: false,
  notifyUpdates: false,
  checkUpdatesOnStart: false,
  lastPath: "/",
  bounds: null,
  maximized: false
});
const KNOWN_ROUTES = new Set([
  "/",
  "/github",
  "/github/preview",
  "/code-agent",
  "/control-center",
  "/agent-studio",
  "/model-status",
  "/skills"
]);

function cleanRoute(value) {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return null;
  // Only public, known UI routes; never persist login URLs, tokens, query strings or hashes.
  if (
    value.includes("%") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("..")
  )
    return null;
  return KNOWN_ROUTES.has(value) ? value : null;
}

function deepLinkRoute(value) {
  if (typeof value !== "string" || value.length > 400) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "kosmora:" ||
      parsed.hostname !== "open" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.pathname !== ""
    )
      return null;
    if ([...parsed.searchParams.keys()].join() !== "path") return null;
    return safeWorkspaceRoute(parsed.searchParams.get("path"));
  } catch {
    return null;
  }
}

function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg === "string" && arg.toLowerCase().startsWith("kosmora:")) {
      const route = deepLinkRoute(arg);
      if (route !== null) return route;
    }
  }
  return null;
}

function safeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const keys = ["x", "y", "width", "height"];
  if (!keys.every((key) => Number.isSafeInteger(bounds[key]) && Math.abs(bounds[key]) < 100000))
    return null;
  if (bounds.width < 900 || bounds.height < 640 || bounds.width > 8192 || bounds.height > 8192)
    return null;
  return Object.fromEntries(keys.map((key) => [key, bounds[key]]));
}

function restoredBounds(bounds, displays) {
  const valid = safeBounds(bounds);
  if (!valid || !Array.isArray(displays)) return null;
  const areas = displays
    .map((d) => d && d.workArea)
    .filter((area) => area && area.width >= 900 && area.height >= 640);
  const matching = areas.find((area) => {
    const horizontal = Math.max(
      0,
      Math.min(area.x + area.width, valid.x + valid.width) - Math.max(area.x, valid.x)
    );
    const vertical = Math.max(
      0,
      Math.min(area.y + area.height, valid.y + valid.height) - Math.max(area.y, valid.y)
    );
    return horizontal >= 200 && vertical >= 120;
  });
  if (!matching) return null;
  const width = Math.min(valid.width, matching.width);
  const height = Math.min(valid.height, matching.height);
  return {
    width,
    height,
    x: Math.max(matching.x, Math.min(valid.x, matching.x + matching.width - width)),
    y: Math.max(matching.y, Math.min(valid.y, matching.y + matching.height - height))
  };
}

function validatePreferences(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULTS };
  for (const key of [
    "restorePage",
    "askWhereToSave",
    "trayEnabled",
    "notifyUpdates",
    "checkUpdatesOnStart",
    "maximized"
  ]) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  if (
    typeof input.downloadDirectory === "string" &&
    input.downloadDirectory.length <= 1024 &&
    path.isAbsolute(input.downloadDirectory)
  ) {
    result.downloadDirectory = path.resolve(input.downloadDirectory);
  }
  result.lastPath = safeWorkspaceRoute(input.lastPath) || "/";
  result.bounds = safeBounds(input.bounds);
  return result;
}

function writeAtomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      encoding: "utf8"
    });
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* already renamed */
    }
  }
}

function createPreferenceStore(userData) {
  const target = path.join(userData, "desktop-preferences.json");
  let state;
  try {
    state = validatePreferences(JSON.parse(fs.readFileSync(target, "utf8")));
  } catch {
    state = validatePreferences();
  }
  return {
    get: () => ({ ...state, bounds: state.bounds && { ...state.bounds } }),
    update: (partial) => {
      state = validatePreferences({ ...state, ...partial });
      writeAtomicJson(target, state);
      return { ...state };
    }
  };
}

module.exports = {
  DEFAULTS,
  cleanRoute,
  createPreferenceStore,
  deepLinkFromArgv,
  deepLinkRoute,
  restoredBounds,
  validatePreferences,
  writeAtomicJson
};
