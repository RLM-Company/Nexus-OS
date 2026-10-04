"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  installerFilename,
  isSameOriginInstallerDownload,
  requireInstallerMetadata,
  streamVerifiedInstaller,
  validateInstallerResponse
} = require("../update-download.cjs");

function manifestFor(bytes, overrides = {}) {
  return {
    version: "0.9.0",
    platform: "win32",
    arch: "x64",
    downloadUrl: "https://downloads.example/Cosmora-Setup-0.9.0-x64.exe",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    ...overrides
  };
}

function responseFor(bytes, overrides = {}) {
  return new Response(bytes, {
    status: overrides.status || 200,
    headers: {
      "content-length":
        overrides.contentLength === undefined ? String(bytes.length) : String(overrides.contentLength)
    }
  });
}

test("shares credentials only with the connected origin", () => {
  assert.equal(
    isSameOriginInstallerDownload(
      "https://cosmora.example/releases/Cosmora.exe",
      "https://cosmora.example"
    ),
    true
  );
  assert.equal(
    isSameOriginInstallerDownload(
      "https://downloads.example/Cosmora.exe",
      "https://cosmora.example"
    ),
    false
  );
  assert.equal(
    isSameOriginInstallerDownload(
      "https://cosmora.example.evil.test/Cosmora.exe",
      "https://cosmora.example"
    ),
    false
  );
  assert.equal(isSameOriginInstallerDownload("not-a-url", "https://cosmora.example"), false);
});

test("requires credential-free HTTPS EXE metadata", () => {
  const bytes = Buffer.from("installer");
  const manifest = manifestFor(bytes);

  assert.equal(installerFilename(manifest), "Cosmora-Setup-0.9.0-x64.exe");
  assert.equal(requireInstallerMetadata(manifest).sizeBytes, bytes.length);

  assert.throws(
    () => requireInstallerMetadata({ ...manifest, downloadUrl: "http://downloads.example/Cosmora.exe" }),
    /HTTPS/
  );
  assert.throws(
    () =>
      requireInstallerMetadata({
        ...manifest,
        downloadUrl: "https://user:secret@downloads.example/Cosmora.exe"
      }),
    /credential-free/
  );
  assert.throws(
    () => requireInstallerMetadata({ ...manifest, downloadUrl: "https://downloads.example/Cosmora.zip" }),
    /EXE/
  );
});

test("rejects redirects and mismatched Content-Length before writing", () => {
  const bytes = Buffer.from("installer");
  const manifest = manifestFor(bytes);

  assert.throws(
    () => validateInstallerResponse(responseFor(bytes, { status: 302 }), manifest),
    /redirects/
  );
  assert.throws(
    () => validateInstallerResponse(responseFor(bytes, { contentLength: bytes.length + 1 }), manifest),
    /Content-Length/
  );
});

test("streams, hashes and finalizes a verified installer", async () => {
  const bytes = Buffer.from("verified-cosmora-installer");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-update-download-"));
  const result = await streamVerifiedInstaller({
    response: responseFor(bytes),
    manifest: manifestFor(bytes),
    downloadsDirectory: directory
  });

  assert.equal(result.filename, "Cosmora-Setup-0.9.0-x64.exe");
  assert.equal(result.bytes, bytes.length);
  assert.equal(fs.readFileSync(result.path).toString("utf8"), bytes.toString("utf8"));
  assert.equal(
    result.sha256,
    crypto.createHash("sha256").update(bytes).digest("hex")
  );
  assert.equal(
    fs.readdirSync(directory).some((name) => name.endsWith(".part")),
    false
  );
});

test("does not overwrite an existing installer", async () => {
  const bytes = Buffer.from("verified-cosmora-installer");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-update-collision-"));
  fs.writeFileSync(path.join(directory, "Cosmora-Setup-0.9.0-x64.exe"), "existing", "utf8");

  const result = await streamVerifiedInstaller({
    response: responseFor(bytes),
    manifest: manifestFor(bytes),
    downloadsDirectory: directory
  });

  assert.equal(result.filename, "Cosmora-Setup-0.9.0-x64 (1).exe");
  assert.equal(
    fs.readFileSync(path.join(directory, "Cosmora-Setup-0.9.0-x64.exe"), "utf8"),
    "existing"
  );
});

test("removes partial files when size or SHA-256 verification fails", async () => {
  const bytes = Buffer.from("verified-cosmora-installer");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-update-reject-"));

  await assert.rejects(
    () =>
      streamVerifiedInstaller({
        response: responseFor(bytes),
        manifest: manifestFor(bytes, { sha256: "a".repeat(64) }),
        downloadsDirectory: directory
      }),
    /SHA-256/
  );

  assert.deepEqual(fs.readdirSync(directory), []);
});
