"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createReleaseMetadata,
  expectedInstallerFilename,
  stableJson,
  validateManifestAgainstRelease,
  verifyInstallerAgainstMetadata,
  writeReleaseBundle
} = require("../release-chain.cjs");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-release-"));
  const packageJsonPath = path.join(directory, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify({ version: "0.5.0" }), "utf8");

  const installerPath = path.join(directory, "Cosmora-Setup-0.5.0-x64.exe");
  const installer = Buffer.from("cosmora-release-fixture");
  fs.writeFileSync(installerPath, installer);

  return {
    directory,
    packageJsonPath,
    installerPath,
    installer,
    gitSha: "a".repeat(40)
  };
}

test("derives release metadata from the actual installer", () => {
  const value = fixture();
  const metadata = createReleaseMetadata(value);

  assert.equal(metadata.version, "0.5.0");
  assert.equal(metadata.filename, expectedInstallerFilename("0.5.0"));
  assert.equal(metadata.sizeBytes, value.installer.length);
  assert.equal(metadata.sha256, crypto.createHash("sha256").update(value.installer).digest("hex"));
  assert.equal(metadata.gitSha, value.gitSha);
});

test("rejects an installer whose filename disagrees with package version", () => {
  const value = fixture();
  const wrongPath = path.join(value.directory, "Cosmora-Setup-0.4.0-x64.exe");
  fs.renameSync(value.installerPath, wrongPath);

  assert.throws(
    () =>
      createReleaseMetadata({
        installerPath: wrongPath,
        packageJsonPath: value.packageJsonPath,
        gitSha: value.gitSha
      }),
    /filename mismatch/
  );
});

test("writes deterministic metadata and checksum files", () => {
  const value = fixture();
  const outputDir = path.join(value.directory, "release");

  const first = writeReleaseBundle({ ...value, outputDir });
  const firstMetadata = fs.readFileSync(first.metadataPath, "utf8");
  const firstChecksums = fs.readFileSync(first.checksumsPath, "utf8");

  const second = writeReleaseBundle({ ...value, outputDir });
  assert.equal(fs.readFileSync(second.metadataPath, "utf8"), firstMetadata);
  assert.equal(fs.readFileSync(second.checksumsPath, "utf8"), firstChecksums);
  assert.equal(firstMetadata, stableJson(first.metadata));
  assert.equal(firstChecksums, `${first.metadata.sha256}  ${first.metadata.filename}\n`);
});

test("detects installer mutation after metadata generation", () => {
  const value = fixture();
  const metadata = createReleaseMetadata(value);
  fs.appendFileSync(value.installerPath, "changed");

  assert.throws(
    () => verifyInstallerAgainstMetadata(value.installerPath, metadata),
    /size does not match|SHA-256 does not match/
  );
});

test("requires update manifest version, digest, size and filename to match release", () => {
  const value = fixture();
  const release = createReleaseMetadata(value);
  const base = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    channel: "stable",
    version: release.version,
    publishedAt: "2026-10-03T08:00:00Z",
    releasePageUrl: "https://releases.example/cosmora/0.5.0",
    downloadUrl: "https://downloads.example/Cosmora-Setup-0.5.0-x64.exe",
    sha256: release.sha256,
    sizeBytes: release.sizeBytes
  };

  assert.equal(validateManifestAgainstRelease(base, release).version, "0.5.0");
  assert.throws(
    () => validateManifestAgainstRelease({ ...base, version: "0.5.1" }, release),
    /version does not match/
  );
  assert.throws(
    () => validateManifestAgainstRelease({ ...base, sha256: "b".repeat(64) }, release),
    /SHA-256 does not match/
  );
  assert.throws(
    () => validateManifestAgainstRelease({ ...base, sizeBytes: release.sizeBytes + 1 }, release),
    /size does not match/
  );
  assert.throws(
    () =>
      validateManifestAgainstRelease(
        { ...base, downloadUrl: "https://downloads.example/other.exe" },
        release
      ),
    /filename does not match/
  );
});
