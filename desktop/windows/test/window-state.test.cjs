"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  createStoredWindowState,
  restoreWindowState,
  validateStoredWindowState
} = require("../window-state.cjs");

const display = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
};

test("restores valid visible bounds and maximized state", () => {
  const stored = {
    schemaVersion: 1,
    bounds: { x: 120, y: 80, width: 1280, height: 800 },
    maximized: true
  };

  assert.deepEqual(restoreWindowState(stored, [display]), stored);
});

test("recenters a previously valid window that is now off-screen", () => {
  const restored = restoreWindowState(
    {
      schemaVersion: 1,
      bounds: { x: 9000, y: 9000, width: 1200, height: 700 },
      maximized: false
    },
    [display]
  );

  assert.equal(restored.bounds.width, 1200);
  assert.equal(restored.bounds.height, 700);
  assert.equal(restored.bounds.x, 360);
  assert.equal(restored.bounds.y, 170);
});

test("fits a visible but oversized window to the current display", () => {
  const restored = restoreWindowState(
    {
      schemaVersion: 1,
      bounds: { x: 0, y: 0, width: 3000, height: 1800 },
      maximized: false
    },
    [display]
  );

  assert.equal(restored.bounds.width, 1920);
  assert.equal(restored.bounds.height, 1040);
  assert.equal(restored.bounds.x, 0);
  assert.equal(restored.bounds.y, 0);
});

test("uses safe defaults for malformed or incompatible state", () => {
  const restored = restoreWindowState(
    {
      schemaVersion: 99,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      maximized: true
    },
    [display]
  );

  assert.equal(restored.bounds.width, DEFAULT_WIDTH);
  assert.equal(restored.bounds.height, DEFAULT_HEIGHT);
  assert.equal(restored.maximized, false);
});

test("rejects unreasonable dimensions", () => {
  assert.equal(
    validateStoredWindowState({
      schemaVersion: 1,
      bounds: { x: 0, y: 0, width: 899, height: 700 },
      maximized: false
    }),
    null
  );
  assert.equal(
    validateStoredWindowState({
      schemaVersion: 1,
      bounds: { x: 0, y: 0, width: 1200, height: 10001 },
      maximized: false
    }),
    null
  );
});

test("creates a normalized persisted state from normal bounds", () => {
  assert.deepEqual(createStoredWindowState({ x: 10, y: 20, width: 1440, height: 900 }, true), {
    schemaVersion: 1,
    bounds: { x: 10, y: 20, width: 1440, height: 900 },
    maximized: true
  });
});
