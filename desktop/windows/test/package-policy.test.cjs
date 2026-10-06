"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

test("desktop package keeps the hardened Electron boundary", () => {
  assert.equal(packageJson.build.asar, true);
  assert.deepEqual(packageJson.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
});

test("installer remains an explicit unsigned local build", () => {
  assert.equal(
    packageJson.scripts["pack:win"],
    "electron-builder --win nsis --x64 --publish never"
  );
  assert.match(packageJson.build.win.artifactName, /^Cosmora-Setup-/);
});
