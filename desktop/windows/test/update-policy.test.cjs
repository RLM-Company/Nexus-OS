"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_MANIFEST_BYTES,
  compareVersions,
  parseVersion,
  updateManifestUrl,
  validateUpdateManifest
} = require("../update-policy.cjs");

test("parses stable and prerelease versions", () => {
  assert.deepEqual(parseVersion("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: []
  });
  assert.deepEqual(parseVersion("1.2.3-beta.2"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: ["beta", 2]
  });
  assert.equal(parseVersion("01.2.3"), null);
  assert.equal(parseVersion("1.2"), null);
});

test("compares stable and prerelease versions safely", () => {
  assert.equal(compareVersions("0.4.0", "0.3.0"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.11"), -1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("builds the manifest URL on the connected origin", () => {
  assert.equal(
    updateManifestUrl("https://cosmora.example"),
    "https://cosmora.example/api/v1/desktop/windows/update.json"
  );
  assert.equal(
    updateManifestUrl("http://127.0.0.1:3000"),
    "http://127.0.0.1:3000/api/v1/desktop/windows/update.json"
  );
});

test("accepts a valid stable Windows update manifest", () => {
  const manifest = validateUpdateManifest(
    {
      schemaVersion: 1,
      platform: "win32",
      arch: "x64",
      channel: "stable",
      version: "0.4.1",
      publishedAt: "2026-10-03T08:00:00Z",
      releasePageUrl: "https://github.com/example/releases/tag/v0.4.1",
      downloadUrl: "https://downloads.example/Cosmora-Setup-0.4.1-x64.exe",
      sha256: "a".repeat(64),
      sizeBytes: 120_000_000,
      notes: "Lifecycle and update protocol improvements."
    },
    "0.4.0"
  );

  assert.equal(manifest.updateAvailable, true);
  assert.equal(manifest.sha256, "a".repeat(64));
  assert.equal(manifest.sizeBytes, 120_000_000);
});

test("treats equal or older versions as no update", () => {
  const base = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    channel: "stable",
    publishedAt: "2026-10-03T08:00:00Z"
  };

  assert.equal(validateUpdateManifest({ ...base, version: "0.4.0" }, "0.4.0").updateAvailable, false);
  assert.equal(validateUpdateManifest({ ...base, version: "0.3.9" }, "0.4.0").updateAvailable, false);
});

test("rejects unsafe update URLs and malformed installer metadata", () => {
  const base = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    channel: "stable",
    version: "0.5.0",
    publishedAt: "2026-10-03T08:00:00Z"
  };

  assert.throws(
    () => validateUpdateManifest({ ...base, releasePageUrl: "http://example.com/release" }, "0.4.0"),
    /HTTPS/
  );
  assert.throws(
    () =>
      validateUpdateManifest(
        {
          ...base,
          downloadUrl: "https://user:secret@example.com/Cosmora.exe",
          sha256: "a".repeat(64),
          sizeBytes: 1
        },
        "0.4.0"
      ),
    /credentials/
  );
  assert.throws(
    () =>
      validateUpdateManifest(
        {
          ...base,
          downloadUrl: "https://example.com/Cosmora.zip",
          sha256: "a".repeat(64),
          sizeBytes: 1
        },
        "0.4.0"
      ),
    /EXE/
  );
  assert.throws(
    () =>
      validateUpdateManifest(
        {
          ...base,
          downloadUrl: "https://example.com/Cosmora.exe",
          sha256: "bad",
          sizeBytes: 1
        },
        "0.4.0"
      ),
    /SHA-256/
  );
});

test("caps update manifest transport size", () => {
  assert.equal(MAX_MANIFEST_BYTES, 64 * 1024);
});
