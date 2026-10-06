"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSmokePayload, isSmokeMode, writeSmokeMarker } = require("../smoke-mode.cjs");

test("smoke mode is explicit and packaged-only", () => {
  assert.equal(isSmokeMode(["Cosmora.exe", "--cosmora-smoke-test"]), true);
  assert.equal(isSmokeMode(["Cosmora.exe"]), false);
  assert.throws(() => createSmokePayload({ isPackaged: false }), /packaged/);
});

test("smoke payload includes the actual user-data path", () => {
  const root = path.resolve(os.tmpdir(), "cosmora-smoke-unit");
  const payload = createSmokePayload({
    version: "0.3.0",
    isPackaged: true,
    execPath: path.join(root, "Cosmora.exe"),
    appPath: path.join(root, "resources", "app.asar"),
    resourcesPath: path.join(root, "resources"),
    userDataPath: path.join(root, "user-data"),
    platform: "win32",
    arch: "x64"
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(path.isAbsolute(payload.userDataPath), true);
});

test("smoke marker is constrained to the OS temporary directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-smoke-test-"));
  const target = path.join(root, "cosmora-smoke-unit.json");
  const payload = { schemaVersion: 1 };
  writeSmokeMarker({ outputPath: target, tempDir: os.tmpdir(), payload });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), payload);
  assert.throws(
    () =>
      writeSmokeMarker({ outputPath: path.join(root, "bad.json"), tempDir: os.tmpdir(), payload }),
    /filename/
  );
  fs.rmSync(root, { recursive: true, force: true });
});
