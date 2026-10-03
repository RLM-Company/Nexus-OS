"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const iconPath = path.join(desktopRoot, "build", "icon.svg");

test("Windows packaging explicitly uses the Cosmora SVG icon", () => {
  assert.equal(packageJson.build?.win?.icon, "build/icon.svg");
  assert.equal(fs.existsSync(iconPath), true);
});

test("native icon source preserves the Cosmora icon-art contract", () => {
  const svg = fs.readFileSync(iconPath, "utf8");

  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /#0b0c0f/i);
  assert.match(svg, /#161329/i);
  assert.match(svg, /#312768/i);
  assert.match(svg, /#c3b9ff/i);
  assert.match(svg, /#f6f4ff/i);
  assert.match(svg, /apps\/web\/src\/app\/app-icon-art\.tsx/);
  assert.match(svg, /<path[\s\S]*stroke="#f6f4ff"/i);
});

test("native icon source is vector-only and has no external resource references", () => {
  const svg = fs.readFileSync(iconPath, "utf8");

  assert.doesNotMatch(svg, /<image\b/i);
  assert.doesNotMatch(svg, /(?:href|xlink:href)=["']https?:/i);
  assert.doesNotMatch(svg, /<script\b/i);
});
