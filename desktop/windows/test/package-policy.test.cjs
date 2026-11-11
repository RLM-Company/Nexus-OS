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
  assert.match(packageJson.build.win.artifactName, /^Kosmora-Setup-/);
});

test("an update keeps the user profile across installs and uninstall keeps user data", () => {
  // The appId/product id and the profile directory name are the update
  // identity: changing either silently relocates connection.json, drafts and
  // the Koswork vault. This test pins them against accidental edits.
  assert.equal(packageJson.build.appId, "com.cosmora.desktop");
  assert.equal(packageJson.name, "cosmora-windows-desktop");
  assert.equal(packageJson.build.productName, "Kosmora");
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.nsis.uninstallDisplayName, "Kosmora");
  assert.equal(packageJson.build.nsis.shortcutName, "Kosmora");
  // Shortcuts survive reinstallation: desktop + Start menu are always created.
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
  // The profile "<AppData>/cosmora-windows-desktop" is established by main.cjs
  // and profile-environment.cjs; both modules must keep the same naming.
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  assert.match(mainSource, /cosmora-windows-desktop/);
  const profileSource = fs.readFileSync(
    path.join(__dirname, "..", "profile-environment.cjs"),
    "utf8"
  );
  assert.match(profileSource, /never/);
  assert.match(profileSource, /migrates/);
});

test("the shipped bundle contains the profile and connection recovery modules", () => {
  for (const file of [
    "profile-environment.cjs",
    "connection-policy.cjs",
    "desktop-recovery.cjs",
    "computer-console.cjs",
    "computer-helper.ps1"
  ])
    assert.ok(packageJson.build.files.includes(file), `missing from build files: ${file}`);
  // Local control scripts never enter the packaged installer.
  assert.equal(packageJson.build.files.includes("check-computer-helper.ps1"), false);
});
