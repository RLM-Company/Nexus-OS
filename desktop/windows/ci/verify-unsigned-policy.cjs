"use strict";

// Offline preflight: validates immutable packaging/security inputs. This is NOT
// an Authenticode, NSIS, update-host or Windows installation acceptance test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createUpdateService } = require("../update-service.cjs");
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const trust = JSON.parse(fs.readFileSync(path.join(root, "update-trust.json"), "utf8"));

function verify() {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "Expected numbered candidate version");
  assert.equal(pkg.name, "cosmora-windows-desktop");
  assert.equal(pkg.build.appId, "com.cosmora.desktop");
  assert.equal(pkg.build.productName, "Kosmora");
  assert.equal(pkg.build.electronVersion, "44.5.1");
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(pkg.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(pkg.scripts["pack:win"], "electron-builder --win nsis --x64 --publish never");
  assert.deepEqual(pkg.build.protocols[0].schemes, ["kosmora"]);
  for (const file of [
    "main.cjs",
    "browser/policy.cjs",
    "browser/document.cjs",
    "browser/profiles.cjs",
    "browser/engine.cjs",
    "browser/shell.cjs",
    "browser/preload.cjs",
    "browser/browser.html",
    "browser/browser.css",
    "browser/browser.js",
    "browser/search.cjs",
    "browser/native-acceptance.cjs",
    "browser/search.html",
    "browser/search.css",
    "computer-history.cjs",
    "computer-workspace.cjs",
    "workspace/index.cjs",
    "workspace/path-guard.cjs",
    "workspace/version-backup.cjs",
    "workspace/workspace-service.cjs",
    "workspace/errors.cjs",
    "preload.cjs",
    "downloads-preload.cjs",
    "download-history.cjs",
    "download-center.cjs",
    "smoke-mode.cjs",
    "gui-acceptance.cjs",
    "connection-policy.cjs",
    "desktop-state.cjs",
    "desktop-recovery.cjs",
    "draft-store.cjs",
    "draft-session-gate.cjs",
    "owner-session.cjs",
    "update-policy.cjs",
    "update-service.cjs",
    "update-trust.json",
    "connection.html",
    "connection.css",
    "connection.js",
    "downloads.html",
    "downloads.css",
    "downloads.js",
    "build/icon.ico"
  ]) {
    assert.ok(pkg.build.files.includes(file), `${file} is missing from NSIS package inputs`);
    assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} is missing from disk`);
  }
  assert.equal(trust.schemaVersion, 1);
  assert.equal(
    trust.publicKeyPem,
    null,
    "Unsigned candidate must not silently enable the update channel"
  );
  const updater = createUpdateService({
    fetcher: () => {
      throw Error("OFF means no network fetch");
    },
    origin: () => "https://kosmora.invalid",
    currentVersion: () => pkg.version,
    userData: path.join(root, ".nonexistent-test-profile"),
    publicKeyPem: trust.publicKeyPem
  });
  return updater.check().then((result) => {
    assert.equal(result.status, "disabled");
    process.stdout.write(
      `Unsigned policy OK: ${pkg.version}; updates OFF; NSIS x64; no auto-install.\n`
    );
  });
}

if (require.main === module)
  verify().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { verify };
