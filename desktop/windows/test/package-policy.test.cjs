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
  assert.equal(packageJson.scripts["pack:win"], "electron-builder --win nsis --x64 --publish never");
  assert.match(packageJson.build.win.artifactName, /^Cosmora-Setup-/);
});

test("NSIS lifecycle covers Windows shell integration and profile preservation", () => {
  const lifecycle = fs.readFileSync(path.join(__dirname, "..", "ci", "nsis-lifecycle.ps1"), "utf8");
  assert.match(lifecycle, /Assert-ShellIntegration/);
  assert.match(lifecycle, /Desktop.*shortcut/i);
  assert.match(lifecycle, /Start Menu.*shortcut/i);
  assert.match(lifecycle, /Uninstall.*registry/i);
  assert.match(lifecycle, /connection\.json/);
  assert.match(lifecycle, /Chromium session/);
});

test("main process keeps remote content isolated and does not bypass TLS or Basic auth", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.doesNotMatch(main, /certificate-error|ignore-certificate-errors|webSecurity:\s*false|allowRunningInsecureContent:\s*true/i);
  assert.doesNotMatch(main, /app\.on\(["']login["']|authorization\s*:\s*[`"']?Basic/i);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
});
