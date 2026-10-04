"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { nextAvailableDownloadPath } = require("./connection-policy.cjs");
const { MAX_INSTALLER_BYTES, parseVersion } = require("./update-policy.cjs");

function requireInstallerMetadata(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Installer manifest is required.");
  }
  if (!parseVersion(manifest.version)) {
    throw new Error("Installer manifest version is invalid.");
  }
  if (manifest.platform !== "win32" || manifest.arch !== "x64") {
    throw new Error("Installer manifest does not match Windows x64.");
  }
  if (typeof manifest.downloadUrl !== "string" || manifest.downloadUrl.trim() === "") {
    throw new Error("Installer manifest does not contain a download URL.");
  }

  let url;
  try {
    url = new URL(manifest.downloadUrl);
  } catch {
    throw new Error("Installer download URL is invalid.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Installer download URL must be credential-free HTTPS.");
  }
  if (!url.pathname.toLowerCase().endsWith(".exe")) {
    throw new Error("Installer download must be an EXE.");
  }
  if (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    throw new Error("Installer SHA-256 is invalid.");
  }
  if (
    !Number.isSafeInteger(manifest.sizeBytes) ||
    manifest.sizeBytes <= 0 ||
    manifest.sizeBytes > MAX_INSTALLER_BYTES
  ) {
    throw new Error("Installer size is invalid.");
  }

  return {
    version: manifest.version,
    downloadUrl: url.toString(),
    sha256: manifest.sha256.toLowerCase(),
    sizeBytes: manifest.sizeBytes
  };
}

function installerFilename(manifest) {
  const metadata = requireInstallerMetadata(manifest);
  return `Cosmora-Setup-${metadata.version}-x64.exe`;
}

function validateInstallerResponse(response, manifest) {
  const metadata = requireInstallerMetadata(manifest);

  if (!response || typeof response !== "object") {
    throw new Error("Installer response is invalid.");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Installer download redirects are not allowed.");
  }
  if (!response.ok) {
    throw new Error("Installer download failed with HTTP " + response.status + ".");
  }

  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error("Installer Content-Length is invalid.");
    }
    if (parsed !== metadata.sizeBytes) {
      throw new Error("Installer Content-Length does not match the manifest.");
    }
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("Installer response body is unavailable.");
  }

  return metadata;
}

function temporaryInstallerPath(downloadsDirectory, filename) {
  return path.join(
    downloadsDirectory,
    "." + filename + "." + crypto.randomUUID().replace(/-/g, "") + ".part"
  );
}

function finalizeVerifiedInstaller(tempPath, downloadsDirectory, filename, existsSync = fs.existsSync) {
  fs.mkdirSync(downloadsDirectory, { recursive: true });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = nextAvailableDownloadPath(downloadsDirectory, filename, existsSync);
    try {
      fs.copyFileSync(tempPath, target, fs.constants.COPYFILE_EXCL);
      fs.rmSync(tempPath, { force: true });
      return target;
    } catch (cause) {
      if (cause && cause.code === "EEXIST") continue;
      throw cause;
    }
  }

  throw new Error("Could not allocate a unique installer filename.");
}

async function streamVerifiedInstaller({
  response,
  manifest,
  downloadsDirectory,
  existsSync = fs.existsSync
}) {
  const metadata = validateInstallerResponse(response, manifest);
  const filename = installerFilename(manifest);
  const tempPath = temporaryInstallerPath(downloadsDirectory, filename);
  const digest = crypto.createHash("sha256");
  const reader = response.body.getReader();
  let handle = null;
  let totalBytes = 0;

  try {
    fs.mkdirSync(downloadsDirectory, { recursive: true });
    handle = fs.openSync(tempPath, "wx", 0o600);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > metadata.sizeBytes || totalBytes > MAX_INSTALLER_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Best effort cancellation after the verified size boundary is exceeded.
        }
        throw new Error("Installer download exceeded the manifest size.");
      }

      digest.update(chunk);
      fs.writeSync(handle, chunk);
    }

    fs.closeSync(handle);
    handle = null;

    if (totalBytes !== metadata.sizeBytes) {
      throw new Error("Installer size does not match the manifest.");
    }

    const sha256 = digest.digest("hex");
    if (sha256 !== metadata.sha256) {
      throw new Error("Installer SHA-256 does not match the manifest.");
    }

    const targetPath = finalizeVerifiedInstaller(
      tempPath,
      downloadsDirectory,
      filename,
      existsSync
    );

    return {
      path: targetPath,
      filename: path.basename(targetPath),
      bytes: totalBytes,
      sha256
    };
  } catch (cause) {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Best effort close before cleanup.
      }
    }
    fs.rmSync(tempPath, { force: true });
    throw cause;
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }
}

module.exports = {
  finalizeVerifiedInstaller,
  installerFilename,
  requireInstallerMetadata,
  streamVerifiedInstaller,
  validateInstallerResponse
};
