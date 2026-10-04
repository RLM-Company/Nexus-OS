"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WINDOW_STATE_SCHEMA_VERSION = 1;
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;
const MIN_VISIBLE_EDGE = 96;

function integer(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function normalizeWorkArea(value) {
  if (!value || typeof value !== "object") return null;
  const x = integer(value.x);
  const y = integer(value.y);
  const width = integer(value.width);
  const height = integer(value.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0)
    return null;
  return { x, y, width, height };
}

function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function centeredBounds(workArea) {
  const width = Math.min(DEFAULT_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_HEIGHT, workArea.height);
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height
  };
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(Math.max(bounds.width, Math.min(MIN_WIDTH, workArea.width)), workArea.width);
  const height = Math.min(
    Math.max(bounds.height, Math.min(MIN_HEIGHT, workArea.height)),
    workArea.height
  );
  const maxX = workArea.x + workArea.width - Math.min(width, MIN_VISIBLE_EDGE);
  const minX = workArea.x - width + Math.min(width, MIN_VISIBLE_EDGE);
  const maxY = workArea.y + workArea.height - Math.min(height, MIN_VISIBLE_EDGE);
  const minY = workArea.y;
  return {
    x: Math.min(Math.max(bounds.x, minX), maxX),
    y: Math.min(Math.max(bounds.y, minY), maxY),
    width,
    height
  };
}

function sanitizeWindowState(value, workAreas) {
  const areas = Array.isArray(workAreas) ? workAreas.map(normalizeWorkArea).filter(Boolean) : [];
  if (areas.length === 0) {
    return {
      schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
      bounds: { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      maximized: false
    };
  }

  const fallback = {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: centeredBounds(areas[0]),
    maximized: false
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value.bounds;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  const x = integer(raw.x);
  const y = integer(raw.y);
  const width = integer(raw.width);
  const height = integer(raw.height);
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0 ||
    width > 20000 ||
    height > 20000
  ) {
    return fallback;
  }

  const bounds = { x, y, width, height };
  const ranked = areas
    .map((area) => ({ area, overlap: overlapArea(bounds, area) }))
    .sort((a, b) => b.overlap - a.overlap);
  const best = ranked[0];
  if (!best || best.overlap === 0) return fallback;

  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: clampBoundsToWorkArea(bounds, best.area),
    maximized: value.maximized === true
  };
}

function loadWindowState(filePath, workAreas) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed.schemaVersion !== WINDOW_STATE_SCHEMA_VERSION) {
      return sanitizeWindowState(null, workAreas);
    }
    return sanitizeWindowState(parsed, workAreas);
  } catch {
    return sanitizeWindowState(null, workAreas);
  }
}

function saveWindowState(filePath, state) {
  const parent = path.dirname(filePath);
  const temporary = filePath + ".tmp";
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporary, filePath);
}

module.exports = {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_VISIBLE_EDGE,
  MIN_WIDTH,
  WINDOW_STATE_SCHEMA_VERSION,
  clampBoundsToWorkArea,
  loadWindowState,
  overlapArea,
  sanitizeWindowState,
  saveWindowState
};
