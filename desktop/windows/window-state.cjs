"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WINDOW_STATE_SCHEMA_VERSION = 1;
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

function finiteInteger(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeWindowState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== WINDOW_STATE_SCHEMA_VERSION) return null;

  const x = finiteInteger(value.x);
  const y = finiteInteger(value.y);
  const width = finiteInteger(value.width);
  const height = finiteInteger(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 320 || height < 240 || width > 16384 || height > 16384) return null;

  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    x,
    y,
    width,
    height,
    maximized: value.maximized === true
  };
}

function readWindowState(filePath) {
  try {
    return normalizeWindowState(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function writeWindowState(filePath, state) {
  const normalized = normalizeWindowState({
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    ...state
  });
  if (!normalized) throw new Error("Window state is invalid.");

  const directory = path.dirname(filePath);
  const temporary = filePath + ".tmp";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporary, filePath);
  return normalized;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const safeBounds = normalizeWindowState({
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    ...bounds,
    maximized: false
  });
  if (!safeBounds) return null;

  const areaX = finiteInteger(workArea?.x);
  const areaY = finiteInteger(workArea?.y);
  const areaWidth = finiteInteger(workArea?.width);
  const areaHeight = finiteInteger(workArea?.height);
  if (
    areaX === null ||
    areaY === null ||
    areaWidth === null ||
    areaHeight === null ||
    areaWidth <= 0 ||
    areaHeight <= 0
  ) {
    return null;
  }

  const width = Math.min(Math.max(safeBounds.width, Math.min(MIN_WIDTH, areaWidth)), areaWidth);
  const height = Math.min(
    Math.max(safeBounds.height, Math.min(MIN_HEIGHT, areaHeight)),
    areaHeight
  );
  const maxX = areaX + areaWidth - width;
  const maxY = areaY + areaHeight - height;

  return {
    x: Math.min(Math.max(safeBounds.x, areaX), maxX),
    y: Math.min(Math.max(safeBounds.y, areaY), maxY),
    width,
    height
  };
}

function defaultWindowBounds(workArea) {
  const width = Math.min(DEFAULT_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_HEIGHT, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

module.exports = {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  WINDOW_STATE_SCHEMA_VERSION,
  clampBoundsToWorkArea,
  defaultWindowBounds,
  normalizeWindowState,
  readWindowState,
  writeWindowState
};
