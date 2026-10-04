"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SMOKE_ARGUMENT = "--cosmora-smoke-test";
const SMOKE_SCHEMA_VERSION = 1;

function isSmokeMode(argv) {
  return Array.isArray(argv) && argv.includes(SMOKE_ARGUMENT);
}

function smokeOutputPath(value, tempDir) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("COSMORA_SMOKE_OUTPUT is required in smoke mode.");
  }
  if (typeof tempDir !== "string" || tempDir.trim() === "") {
    throw new Error("Smoke temp directory is required.");
  }

  const root = path.resolve(tempDir);
  const target = path.resolve(value);
  const relative = path.relative(root, target);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Smoke output must be a file inside the operating-system temp directory.");
  }

  const filename = path.basename(target);
  if (!/^cosmora-smoke-[A-Za-z0-9._-]+\.json$/.test(filename)) {
    throw new Error("Smoke output filename is invalid.");
  }

  return target;
}

function createSmokePayload({
  version,
  isPackaged,
  execPath,
  appPath,
  resourcesPath,
  userDataPath,
  platform,
  arch
}) {
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("Smoke payload requires an application version.");
  }
  if (isPackaged !== true) {
    throw new Error("Smoke mode must run from a packaged application.");
  }

  for (const [label, value] of Object.entries({ execPath, appPath, resourcesPath, userDataPath })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error("Smoke payload requires an absolute " + label + ".");
    }
  }

  if (platform !== "win32") {
    throw new Error("Installer lifecycle smoke mode requires Windows.");
  }
  if (arch !== "x64") {
    throw new Error("Installer lifecycle smoke mode requires x64.");
  }

  return {
    schemaVersion: SMOKE_SCHEMA_VERSION,
    version: version.trim(),
    isPackaged: true,
    platform,
    arch,
    execPath: path.resolve(execPath),
    appPath: path.resolve(appPath),
    resourcesPath: path.resolve(resourcesPath),
    userDataPath: path.resolve(userDataPath)
  };
}

function writeSmokeMarker({ outputPath, tempDir, payload }) {
  const target = smokeOutputPath(outputPath, tempDir);
  const directory = path.dirname(target);
  const temporary = target + ".tmp";

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "w"
  });
  fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);

  return target;
}

module.exports = {
  SMOKE_ARGUMENT,
  SMOKE_SCHEMA_VERSION,
  createSmokePayload,
  isSmokeMode,
  smokeOutputPath,
  writeSmokeMarker
};
