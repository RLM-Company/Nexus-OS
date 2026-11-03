"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapNormalizedVisionToScreen,
  SetOfMarkCoordinateCatalog
} = require("../ci/dpi-coordinate-calibrator.cjs");

test("mapNormalizedVisionToScreen calibrates coordinates across 150% DPI scaling and negative secondary monitor offsets", () => {
  // Secondary left monitor at negative origin (-1920, 0) with 150% (1.5x) DPI scaling
  const secondaryDisplay = {
    id: "display-left-4k",
    scaleFactor: 1.5,
    dipBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    physicalBounds: { x: -2880, y: 0, width: 2880, height: 1620 }
  };

  // Center of screen (500, 500)
  const center = mapNormalizedVisionToScreen(500, 500, secondaryDisplay);
  assert.equal(center.dip.x, -960);
  assert.equal(center.dip.y, 540);
  assert.equal(center.physical.x, -1440);
  assert.equal(center.physical.y, 810);

  // Out-of-bounds normalized input (-50, 1200) is safely clamped inside viewport inset
  const clamped = mapNormalizedVisionToScreen(-50, 1200, secondaryDisplay);
  assert.equal(clamped.dip.x, -1918);
  assert.equal(clamped.dip.y, 1078);
});

test("SetOfMarkCoordinateCatalog assigns #1..#N tags and computes DPI-scaled physical click targets", () => {
  const display = {
    id: "display-primary-125",
    scaleFactor: 1.25,
    dipBounds: { x: 0, y: 0, width: 1920, height: 1080 }
  };

  const som = new SetOfMarkCoordinateCatalog(display);
  const catalog = som.buildCatalog([
    {
      id: "btn-approve-budget",
      label: "Approve Budget",
      role: "button",
      dipBbox: { x: 400, y: 300, width: 200, height: 40 }
    },
    {
      id: "input-search",
      label: "Search Vault",
      role: "textbox",
      dipBbox: { x: 800, y: 100, width: 400, height: 32 }
    }
  ]);

  assert.equal(catalog.length, 2);
  const target1 = som.resolveMarkTarget("#1");
  assert.ok(target1);
  assert.equal(target1.elementId, "btn-approve-budget");
  // Center DIP: (400 + 100 = 500, 300 + 20 = 320)
  assert.deepEqual(target1.safeClickDip, { x: 500, y: 320 });
  // Physical at 1.25x: (500 * 1.25 = 625, 320 * 1.25 = 400)
  assert.deepEqual(target1.safeClickPhysical, { x: 625, y: 400 });
});
