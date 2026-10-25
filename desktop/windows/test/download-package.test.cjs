"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("all isolated download-center modules and local renderer assets are packaged", () => {
  const pkg = require("../package.json");
  for (const relative of [
    "download-history.cjs", "download-center.cjs", "downloads-preload.cjs",
    "downloads.html", "downloads.css", "downloads.js"
  ]) {
    assert.ok(pkg.build.files.includes(relative), relative);
    assert.ok(fs.statSync(path.join(root, relative)).isFile(), relative);
    if (/\.(?:cjs|js)$/.test(relative))
      assert.match(pkg.scripts.check, new RegExp(relative.replaceAll(".", "\\.")));
  }
});

test("unsafe update channel remains disabled, without an auto-updater dependency", () => {
  const trust = require("../update-trust.json");
  const pkg = require("../package.json");
  assert.equal(trust.publicKeyPem, null);
  assert.equal(pkg.scripts["pack:win"], "electron-builder --win nsis --x64 --publish never");
  assert.ok(!pkg.build.files.some(name => /autoUpdater/.test(name)));
  const localPreload = fs.readFileSync(path.join(root, "downloads-preload.cjs"), "utf8");
  assert.ok(!localPreload.includes("openPath"));
  assert.ok(!localPreload.includes("require(\"node:fs\")"));
});
