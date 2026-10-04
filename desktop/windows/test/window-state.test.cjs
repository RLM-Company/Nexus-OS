"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  WINDOW_STATE_SCHEMA_VERSION,
  loadWindowState,
  sanitizeWindowState,
  saveWindowState
} = require("../window-state.cjs");

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary = { x: 1920, y: 0, width: 2560, height: 1440 };

test("restores a valid window on the display it intersects", () => {
  const state = sanitizeWindowState(
    {
      schemaVersion: 1,
      bounds: { x: 2200, y: 120, width: 1500, height: 950 },
      maximized: true
    },
    [primary, secondary]
  );

  assert.deepEqual(state.bounds, { x: 2200, y: 120, width: 1500, height: 950 });
  assert.equal(state.maximized, true);
});

test("returns a centered primary-display window when saved bounds are off-screen", () => {
  const state = sanitizeWindowState(
    {
      schemaVersion: 1,
      bounds: { x: 9000, y: 9000, width: 1400, height: 900 },
      maximized: true
    },
    [primary]
  );

  assert.deepEqual(state.bounds, { x: 240, y: 90, width: 1440, height: 900 });
  assert.equal(state.maximized, false);
});

test("clamps oversized windows while keeping a visible edge", () => {
  const state = sanitizeWindowState(
    {
      schemaVersion: 1,
      bounds: { x: -700, y: -200, width: 5000, height: 4000 },
      maximized: false
    },
    [primary]
  );

  assert.equal(state.bounds.width, 1920);
  assert.equal(state.bounds.height, 1080);
  assert.equal(state.bounds.y, 0);
  assert.ok(state.bounds.x >= -1824);
});

test("recovers from corrupt state files and saves atomically", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-window-state-"));
  const target = path.join(directory, "window-state.json");
  fs.writeFileSync(target, "{not-json", "utf8");

  const recovered = loadWindowState(target, [primary]);
  assert.deepEqual(recovered.bounds, { x: 240, y: 90, width: 1440, height: 900 });

  const next = {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: { x: 100, y: 80, width: 1200, height: 800 },
    maximized: true
  };
  saveWindowState(target, next);

  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), next);
  assert.equal(fs.existsSync(target + ".tmp"), false);
});

test("ignores unknown schema versions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-window-schema-"));
  const target = path.join(directory, "window-state.json");
  fs.writeFileSync(
    target,
    JSON.stringify({
      schemaVersion: 99,
      bounds: { x: 100, y: 100, width: 1000, height: 700 },
      maximized: true
    }),
    "utf8"
  );

  const state = loadWindowState(target, [primary]);
  assert.equal(state.maximized, false);
  assert.deepEqual(state.bounds, { x: 240, y: 90, width: 1440, height: 900 });
});
