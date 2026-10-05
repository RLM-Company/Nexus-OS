"use strict";

const WINDOW_STATE_SCHEMA_VERSION = 1;
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;
const MAX_DIMENSION = 10000;
const MIN_VISIBLE_WIDTH = 160;
const MIN_VISIBLE_HEIGHT = 120;

function integerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateBounds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!integerInRange(value.width, MIN_WIDTH, MAX_DIMENSION)) return null;
  if (!integerInRange(value.height, MIN_HEIGHT, MAX_DIMENSION)) return null;

  const result = {
    width: value.width,
    height: value.height
  };

  if (
    integerInRange(value.x, -100000, 100000) &&
    integerInRange(value.y, -100000, 100000)
  ) {
    result.x = value.x;
    result.y = value.y;
  }

  return result;
}

function validateStoredWindowState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== WINDOW_STATE_SCHEMA_VERSION) return null;

  const bounds = validateBounds(value.bounds);
  if (!bounds) return null;

  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds,
    maximized: value.maximized === true
  };
}

function overlapSize(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return { width, height };
}

function isSufficientlyVisible(bounds, workAreas) {
  if (!Number.isInteger(bounds.x) || !Number.isInteger(bounds.y)) return false;

  return workAreas.some((area) => {
    const overlap = overlapSize(bounds, area);
    return overlap.width >= MIN_VISIBLE_WIDTH && overlap.height >= MIN_VISIBLE_HEIGHT;
  });
}

function normalizeWorkAreas(displays) {
  if (!Array.isArray(displays)) return [];
  return displays
    .map((display) => display?.workArea)
    .filter(
      (area) =>
        area &&
        Number.isInteger(area.x) &&
        Number.isInteger(area.y) &&
        Number.isInteger(area.width) &&
        Number.isInteger(area.height) &&
        area.width > 0 &&
        area.height > 0
    );
}

function centeredBounds(width, height, area) {
  const safeWidth = Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, area.width));
  const safeHeight = Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, area.height));

  return {
    x: area.x + Math.max(0, Math.floor((area.width - safeWidth) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - safeHeight) / 2)),
    width: safeWidth,
    height: safeHeight
  };
}

function restoreWindowState(storedState, displays) {
  const state = validateStoredWindowState(storedState);
  const workAreas = normalizeWorkAreas(displays);

  if (state && isSufficientlyVisible(state.bounds, workAreas)) {
    return state;
  }

  const preferred = state?.bounds || {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT
  };

  if (workAreas.length === 0) {
    return {
      schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
      bounds: {
        width: preferred.width,
        height: preferred.height
      },
      maximized: state?.maximized === true
    };
  }

  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: centeredBounds(preferred.width, preferred.height, workAreas[0]),
    maximized: state?.maximized === true
  };
}

function createStoredWindowState(bounds, maximized) {
  const normalized = validateBounds(bounds);
  if (!normalized) {
    throw new Error("Window bounds are invalid.");
  }
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: normalized,
    maximized: maximized === true
  };
}

module.exports = {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_DIMENSION,
  MIN_HEIGHT,
  MIN_VISIBLE_HEIGHT,
  MIN_VISIBLE_WIDTH,
  MIN_WIDTH,
  WINDOW_STATE_SCHEMA_VERSION,
  createStoredWindowState,
  isSufficientlyVisible,
  restoreWindowState,
  validateStoredWindowState
};
