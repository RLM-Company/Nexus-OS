"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function writeAtomicJson(targetPath, data) {
  const resolved = path.resolve(String(targetPath));
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`);
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, resolved);
  return resolved;
}

function readJsonFileSafe(targetPath, fallback = null) {
  try {
    const raw = fs.readFileSync(path.resolve(String(targetPath)), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

module.exports = {
  readJsonFileSafe,
  writeAtomicJson
};
