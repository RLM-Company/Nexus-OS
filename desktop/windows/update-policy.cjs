"use strict";

const { normalizeServerOrigin } = require("./connection-policy.cjs");

const UPDATE_MANIFEST_PATH = "/api/v1/desktop/windows/update.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;

  const core = [match[1], match[2], match[3]].map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return null;

  const rawPrerelease = match[4] ? match[4].split(".") : [];
  if (rawPrerelease.some((part) => part === "" || /^0\d+$/.test(part))) return null;

  const prerelease = rawPrerelease.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  if (prerelease.some((part) => typeof part === "number" && !Number.isSafeInteger(part))) {
    return null;
  }

  return {
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumber = typeof a === "number";
    const bNumber = typeof b === "number";
    if (aNumber && bNumber) return a < b ? -1 : 1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return String(a) < String(b) ? -1 : 1;
  }

  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) {
    throw new Error("Invalid semantic version.");
  }

  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function updateManifestUrl(origin) {
  const normalized = normalizeServerOrigin(origin);
  return new URL(UPDATE_MANIFEST_PATH, normalized).toString();
}

function safeHttpsUrl(value, label) {
  if (typeof value !== "string" || value.trim() === "") return null;

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(label + " has an invalid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error(label + " must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error(label + " must not contain credentials.");
  }

  return parsed.toString();
}

function validateUpdateManifest(value, currentVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Update manifest must be an object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported update manifest schema.");
  }
  if (value.platform !== "win32" || value.arch !== "x64" || value.channel !== "stable") {
    throw new Error("Update manifest does not match this Windows client.");
  }

  const next = parseVersion(value.version);
  const current = parseVersion(currentVersion);
  if (!next || !current) {
    throw new Error("Update manifest contains an invalid version.");
  }

  if (typeof value.publishedAt !== "string" || value.publishedAt.trim() === "") {
    throw new Error("Update manifest contains an invalid publish date.");
  }
  const publishedAt = new Date(value.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    throw new Error("Update manifest contains an invalid publish date.");
  }

  const releasePageUrl = safeHttpsUrl(value.releasePageUrl, "Release page");
  if (!releasePageUrl) {
    throw new Error("Update manifest requires a release page.");
  }
  const downloadUrl = safeHttpsUrl(value.downloadUrl, "Download URL");

  if (downloadUrl && !new URL(downloadUrl).pathname.toLowerCase().endsWith(".exe")) {
    throw new Error("Windows update download must be an EXE installer.");
  }

  if (downloadUrl) {
    if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
      throw new Error("Update manifest requires a valid SHA-256 digest.");
    }
    if (
      !Number.isSafeInteger(value.sizeBytes) ||
      value.sizeBytes <= 0 ||
      value.sizeBytes > MAX_INSTALLER_BYTES
    ) {
      throw new Error("Update manifest contains an invalid installer size.");
    }
  }

  const notes =
    typeof value.notes === "string"
      ? value.notes.replace(/[\u0000-\u001f]+/g, " ").slice(0, 2000)
      : "";

  return {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    channel: "stable",
    version: value.version.trim(),
    publishedAt: publishedAt.toISOString(),
    releasePageUrl,
    downloadUrl,
    sha256: downloadUrl ? value.sha256.toLowerCase() : null,
    sizeBytes: downloadUrl ? value.sizeBytes : null,
    notes,
    updateAvailable: compareVersions(value.version, currentVersion) > 0
  };
}

module.exports = {
  MAX_INSTALLER_BYTES,
  MAX_MANIFEST_BYTES,
  compareVersions,
  parseVersion,
  updateManifestUrl,
  validateUpdateManifest
};
