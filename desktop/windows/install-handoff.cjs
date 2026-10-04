"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { requireInstallerMetadata } = require("./update-download.cjs");

const STAGING_DIRECTORY = "update-install-staging";
const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function canonicalForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(directory, target) {
  const root = canonicalForComparison(directory);
  const candidate = canonicalForComparison(target);
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function hashFileSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

async function verifyInstallerFile({ filePath, manifest, allowedDirectory }) {
  const metadata = requireInstallerMetadata(manifest);
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("Installer path must be absolute.");
  }
  if (!isPathInside(allowedDirectory, filePath)) {
    throw new Error("Installer is outside the allowed directory.");
  }

  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Installer must be a regular file.");
  }
  if (stats.size !== metadata.sizeBytes) {
    throw new Error("Installer size changed after download.");
  }

  const sha256 = await hashFileSha256(filePath);
  if (sha256 !== metadata.sha256) {
    throw new Error("Installer SHA-256 changed after download.");
  }

  return {
    path: path.resolve(filePath),
    sizeBytes: stats.size,
    sha256
  };
}

function installStagingRoot(userDataDirectory) {
  if (typeof userDataDirectory !== "string" || userDataDirectory.trim() === "") {
    throw new Error("User-data directory is required.");
  }
  return path.join(path.resolve(userDataDirectory), STAGING_DIRECTORY);
}

function cleanupInstallStaging(userDataDirectory, nowMs = Date.now()) {
  const root = installStagingRoot(userDataDirectory);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (cause) {
    if (cause && cause.code === "ENOENT") return 0;
    throw cause;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(root, entry.name);
    try {
      const stats = fs.statSync(target);
      if (nowMs - stats.mtimeMs >= STAGING_MAX_AGE_MS) {
        fs.rmSync(target, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Cleanup is best effort and must not make application startup fail.
    }
  }
  return removed;
}

async function stageVerifiedInstaller({
  sourcePath,
  manifest,
  downloadsDirectory,
  userDataDirectory
}) {
  const metadata = requireInstallerMetadata(manifest);
  await verifyInstallerFile({
    filePath: sourcePath,
    manifest,
    allowedDirectory: downloadsDirectory
  });

  const root = installStagingRoot(userDataDirectory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const token = crypto.randomUUID().replace(/-/g, "");
  const stageDirectory = path.join(root, token);
  fs.mkdirSync(stageDirectory, { recursive: false, mode: 0o700 });

  const stagedPath = path.join(stageDirectory, `Cosmora-Setup-${metadata.version}-x64.exe`);

  try {
    fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    const verified = await verifyInstallerFile({
      filePath: stagedPath,
      manifest,
      allowedDirectory: stageDirectory
    });

    return {
      ...verified,
      stageDirectory
    };
  } catch (cause) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
    throw cause;
  }
}

module.exports = {
  STAGING_DIRECTORY,
  STAGING_MAX_AGE_MS,
  cleanupInstallStaging,
  hashFileSha256,
  installStagingRoot,
  isPathInside,
  stageVerifiedInstaller,
  verifyInstallerFile
};
