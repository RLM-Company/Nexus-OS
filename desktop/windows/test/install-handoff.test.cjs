"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  STAGING_MAX_AGE_MS,
  cleanupInstallStaging,
  installStagingRoot,
  isPathInside,
  stageVerifiedInstaller,
  verifyInstallerFile
} = require("../install-handoff.cjs");

function manifestFor(bytes, overrides = {}) {
  return {
    version: "0.10.0",
    platform: "win32",
    arch: "x64",
    downloadUrl: "https://downloads.example/Cosmora-Setup-0.10.0-x64.exe",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    ...overrides
  };
}

test("recognizes descendants without accepting the directory itself or siblings", () => {
  const root = path.resolve(os.tmpdir(), "cosmora-handoff-root");
  assert.equal(isPathInside(root, path.join(root, "installer.exe")), true);
  assert.equal(isPathInside(root, root), false);
  assert.equal(isPathInside(root, path.join(path.dirname(root), "installer.exe")), false);
});

test("re-verifies a downloaded installer immediately before staging", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-handoff-verify-"));
  const downloads = path.join(root, "Downloads");
  fs.mkdirSync(downloads);
  const bytes = Buffer.from("verified-installer");
  const installer = path.join(downloads, "Cosmora-Setup-0.10.0-x64.exe");
  fs.writeFileSync(installer, bytes);

  const verified = await verifyInstallerFile({
    filePath: installer,
    manifest: manifestFor(bytes),
    allowedDirectory: downloads
  });

  assert.equal(verified.sizeBytes, bytes.length);
  assert.equal(verified.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));

  fs.writeFileSync(installer, "tampered-installer");
  await assert.rejects(
    () =>
      verifyInstallerFile({
        filePath: installer,
        manifest: manifestFor(bytes),
        allowedDirectory: downloads
      }),
    /(size|SHA-256) changed/
  );
});

test("rejects installer paths outside Downloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-handoff-outside-"));
  const downloads = path.join(root, "Downloads");
  fs.mkdirSync(downloads);
  const bytes = Buffer.from("verified-installer");
  const outside = path.join(root, "outside.exe");
  fs.writeFileSync(outside, bytes);

  await assert.rejects(
    () =>
      verifyInstallerFile({
        filePath: outside,
        manifest: manifestFor(bytes),
        allowedDirectory: downloads
      }),
    /outside the allowed directory/
  );
});

test("stages into a random private directory and re-verifies the copy", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-handoff-stage-"));
  const downloads = path.join(root, "Downloads");
  const userData = path.join(root, "UserData");
  fs.mkdirSync(downloads);
  const bytes = Buffer.from("verified-installer");
  const source = path.join(downloads, "Cosmora-Setup-0.10.0-x64.exe");
  fs.writeFileSync(source, bytes);

  const staged = await stageVerifiedInstaller({
    sourcePath: source,
    manifest: manifestFor(bytes),
    downloadsDirectory: downloads,
    userDataDirectory: userData
  });

  assert.equal(isPathInside(installStagingRoot(userData), staged.path), true);
  assert.equal(path.basename(staged.path), "Cosmora-Setup-0.10.0-x64.exe");
  assert.equal(fs.readFileSync(staged.path, "utf8"), bytes.toString("utf8"));
  assert.equal(staged.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
});

test("cleans only expired install staging directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-handoff-clean-"));
  const userData = path.join(root, "UserData");
  const stagingRoot = installStagingRoot(userData);
  const oldDirectory = path.join(stagingRoot, "old");
  const freshDirectory = path.join(stagingRoot, "fresh");
  fs.mkdirSync(oldDirectory, { recursive: true });
  fs.mkdirSync(freshDirectory, { recursive: true });

  const now = Date.now();
  const oldTime = new Date(now - STAGING_MAX_AGE_MS - 1000);
  fs.utimesSync(oldDirectory, oldTime, oldTime);

  assert.equal(cleanupInstallStaging(userData, now), 1);
  assert.equal(fs.existsSync(oldDirectory), false);
  assert.equal(fs.existsSync(freshDirectory), true);
});
