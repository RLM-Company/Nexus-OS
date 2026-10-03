"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const lifecyclePath = path.join(desktopRoot, "scripts", "installer-lifecycle.ps1");

test("NSIS package enables Cosmora Desktop and Start Menu shortcuts", () => {
  const nsis = packageJson.build?.nsis;

  assert.equal(nsis?.createDesktopShortcut, true);
  assert.equal(nsis?.createStartMenuShortcut, true);
  assert.equal(nsis?.shortcutName, "Cosmora");
  assert.equal(nsis?.uninstallDisplayName, "Cosmora");
});

test("shared lifecycle verifier checks installed shell integration and cleanup", () => {
  const source = fs.readFileSync(lifecyclePath, "utf8");

  assert.match(source, /Desktop.*Cosmora\.lnk/s);
  assert.match(source, /Programs.*Cosmora\.lnk/s);
  assert.match(source, /CurrentVersion\\Uninstall/);
  assert.match(source, /DisplayVersion/);
  assert.match(source, /UninstallString/);
  assert.match(source, /InstallLocation/);
  assert.match(source, /ProductName/);
  assert.match(source, /ProductVersion/);
  assert.match(source, /FileVersion/);
  assert.match(source, /left the Desktop shortcut behind/);
  assert.match(source, /left the Start Menu shortcut behind/);
  assert.match(source, /left the Cosmora registry entry behind/);
});

test("both Windows workflows use the shared lifecycle verifier", () => {
  const root = path.resolve(desktopRoot, "..", "..");
  const desktopWorkflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "windows-desktop.yml"),
    "utf8"
  );
  const signedWorkflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "windows-release.yml"),
    "utf8"
  );

  for (const workflow of [desktopWorkflow, signedWorkflow]) {
    assert.match(workflow, /desktop\/windows\/scripts\/installer-lifecycle\.ps1/);
  }

  assert.match(desktopWorkflow, /InstallPrefix "cosmora-installed"/);
  assert.match(signedWorkflow, /InstallPrefix "cosmora-signed-installed"/);
});
