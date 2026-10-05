"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  clampBoundsToWorkArea,
  defaultWindowBounds,
  normalizeWindowState,
  readWindowState,
  writeWindowState
} = require("../window-state.cjs");

test("normalizes valid window state and rejects malformed values", () => {
  assert.deepEqual(
    normalizeWindowState({
      schemaVersion: 1,
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
      maximized: true
    }),
    {
      schemaVersion: 1,
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
      maximized: true
    }
  );
  assert.equal(normalizeWindowState({ schemaVersion: 2 }), null);
  assert.equal(
    normalizeWindowState({
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    }),
    null
  );
});

test("clamps restored bounds into the selected display work area", () => {
  assert.deepEqual(
    clampBoundsToWorkArea(
      { x: 5000, y: -1000, width: 1800, height: 1200 },
      { x: 1920, y: 0, width: 1920, height: 1080 }
    ),
    { x: 2040, y: 0, width: 1800, height: 1080 }
  );
});

test("centers default bounds and fits them to smaller displays", () => {
  assert.deepEqual(
    defaultWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 }),
    { x: 240, y: 90, width: 1440, height: 900 }
  );
  assert.deepEqual(
    defaultWindowBounds({ x: 100, y: 50, width: 800, height: 600 }),
    { x: 100, y: 50, width: 800, height: 600 }
  );
});

test("writes and reads window state atomically", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-window-state-"));
  const filePath = path.join(directory, "window-state.json");

  writeWindowState(filePath, {
    x: 40,
    y: 60,
    width: 1280,
    height: 720,
    maximized: false
  });

  assert.deepEqual(readWindowState(filePath), {
    schemaVersion: 1,
    x: 40,
    y: 60,
    width: 1280,
    height: 720,
    maximized: false
  });
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
});
