"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SMOKE_FLAG = "--cosmora-smoke-test";
const MARKER_PATTERN = /^cosmora-smoke-[A-Za-z0-9._-]+\.json$/;

function isSmokeMode(argv) {
  return Array.isArray(argv) && argv.includes(SMOKE_FLAG);
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
  if (!isPackaged) throw new Error("Smoke mode must run from a packaged application.");
  if (platform !== "win32" || arch !== "x64") {
    throw new Error("Smoke mode requires packaged win32 x64.");
  }
  if (typeof version !== "string" || !version) throw new Error("Smoke payload requires version.");
  for (const [label, value] of Object.entries({ execPath, appPath, resourcesPath, userDataPath })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error("Smoke payload requires an absolute " + label + ".");
    }
  }
  return {
    schemaVersion: 1,
    version,
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
  if (typeof outputPath !== "string" || !outputPath) {
    throw new Error("COSMORA_SMOKE_OUTPUT is required in smoke mode.");
  }
  const resolvedOutput = path.resolve(outputPath);
  const resolvedTemp = path.resolve(tempDir);
  const relative = path.relative(resolvedTemp, resolvedOutput);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Smoke marker must be written inside the OS temporary directory.");
  }
  if (!MARKER_PATTERN.test(path.basename(resolvedOutput))) {
    throw new Error("Smoke marker filename is not allowed.");
  }
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(payload, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
}

module.exports = { createSmokePayload, isSmokeMode, writeSmokeMarker };
