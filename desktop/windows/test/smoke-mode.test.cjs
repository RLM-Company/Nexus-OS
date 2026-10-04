"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  SMOKE_ARGUMENT,
  createSmokePayload,
  isSmokeMode,
  smokeOutputPath,
  writeSmokeMarker
} = require("../smoke-mode.cjs");

test("detects the explicit installer smoke argument only", () => {
  assert.equal(isSmokeMode(["Cosmora.exe", SMOKE_ARGUMENT]), true);
  assert.equal(isSmokeMode(["Cosmora.exe"]), false);
  assert.equal(isSmokeMode(null), false);
});

test("accepts smoke marker paths only inside the supplied temp directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-smoke-root-"));
  const target = path.join(root, "nested", "cosmora-smoke-ci.json");

  assert.equal(smokeOutputPath(target, root), path.resolve(target));
  assert.throws(
    () => smokeOutputPath(path.join(path.dirname(root), "cosmora-smoke-ci.json"), root),
    /temp directory/
  );
  assert.throws(() => smokeOutputPath(path.join(root, "marker.json"), root), /filename/);
});

test("requires packaged win32 x64 smoke payloads with absolute paths", () => {
  const absolute = path.resolve(os.tmpdir(), "Cosmora.exe");
  const payload = createSmokePayload({
    version: "0.7.0",
    isPackaged: true,
    execPath: absolute,
    appPath: path.resolve(os.tmpdir(), "resources", "app.asar"),
    resourcesPath: path.resolve(os.tmpdir(), "resources"),
    userDataPath: path.resolve(os.tmpdir(), "Cosmora"),
    platform: "win32",
    arch: "x64"
  });

  assert.equal(payload.version, "0.7.0");
  assert.equal(payload.isPackaged, true);
  assert.equal(path.isAbsolute(payload.userDataPath), true);
  assert.throws(
    () => createSmokePayload({ ...payload, isPackaged: false }),
    /packaged application/
  );
  assert.throws(() => createSmokePayload({ ...payload, platform: "linux" }), /Windows/);
});

test("writes a deterministic JSON smoke marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-smoke-write-"));
  const target = path.join(root, "cosmora-smoke-unit.json");
  const payload = {
    schemaVersion: 1,
    version: "0.7.0",
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    execPath: "C:\\Cosmora\\Cosmora.exe",
    appPath: "C:\\Cosmora\\resources\\app.asar",
    resourcesPath: "C:\\Cosmora\\resources",
    userDataPath: "C:\\Users\\runner\\AppData\\Roaming\\Cosmora"
  };

  writeSmokeMarker({ outputPath: target, tempDir: root, payload });

  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), payload);
  assert.equal(fs.existsSync(target + ".tmp"), false);
});
