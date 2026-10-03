"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseVersion, validateUpdateManifest } = require("./update-policy.cjs");

const RELEASE_SCHEMA_VERSION = 1;
const DEFAULT_ARCH = "x64";
const PRODUCT_NAME = "Cosmora";
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

function expectedInstallerFilename(version, arch = DEFAULT_ARCH) {
  return `Cosmora-Setup-${version}-${arch}.exe`;
}

function sha256File(filePath) {
  const digest = crypto.createHash("sha256");
  const file = fs.readFileSync(filePath);
  digest.update(file);
  return digest.digest("hex");
}

function readPackageVersion(packageJsonPath) {
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
    throw new Error("Desktop package.json does not contain a version.");
  }
  return parsed.version.trim();
}

function createReleaseMetadata({ installerPath, packageJsonPath, arch = DEFAULT_ARCH, gitSha }) {
  const version = readPackageVersion(packageJsonPath);
  const expectedName = expectedInstallerFilename(version, arch);
  const actualName = path.basename(installerPath);

  if (actualName !== expectedName) {
    throw new Error(
      `Installer filename mismatch: expected ${expectedName}, received ${actualName}.`
    );
  }

  const stats = fs.statSync(installerPath);
  if (!stats.isFile()) {
    throw new Error("Installer path is not a regular file.");
  }
  if (stats.size <= 0 || stats.size > MAX_INSTALLER_BYTES) {
    throw new Error("Installer size is outside the allowed release range.");
  }

  if (typeof gitSha !== "string" || !/^[a-f0-9]{40}$/i.test(gitSha)) {
    throw new Error("Release metadata requires a full 40-hex Git SHA.");
  }

  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    product: PRODUCT_NAME,
    version,
    platform: "win32",
    arch,
    channel: "stable",
    filename: actualName,
    sizeBytes: stats.size,
    sha256: sha256File(installerPath),
    gitSha: gitSha.toLowerCase()
  };
}

function validateReleaseMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Release metadata must be an object.");
  }
  if (metadata.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error("Unsupported release metadata schema.");
  }
  if (
    metadata.product !== PRODUCT_NAME ||
    metadata.platform !== "win32" ||
    metadata.arch !== DEFAULT_ARCH ||
    metadata.channel !== "stable"
  ) {
    throw new Error("Release metadata does not match the Windows stable channel.");
  }
  if (!parseVersion(metadata.version)) {
    throw new Error("Release metadata contains an invalid semantic version.");
  }
  if (metadata.filename !== expectedInstallerFilename(metadata.version, metadata.arch)) {
    throw new Error("Release metadata filename does not match its version.");
  }
  if (
    !Number.isSafeInteger(metadata.sizeBytes) ||
    metadata.sizeBytes <= 0 ||
    metadata.sizeBytes > MAX_INSTALLER_BYTES
  ) {
    throw new Error("Release metadata contains an invalid installer size.");
  }
  if (typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
    throw new Error("Release metadata contains an invalid SHA-256.");
  }
  if (typeof metadata.gitSha !== "string" || !/^[a-f0-9]{40}$/i.test(metadata.gitSha)) {
    throw new Error("Release metadata contains an invalid Git SHA.");
  }

  return {
    ...metadata,
    sha256: metadata.sha256.toLowerCase(),
    gitSha: metadata.gitSha.toLowerCase()
  };
}

function verifyInstallerAgainstMetadata(installerPath, metadata) {
  const validated = validateReleaseMetadata(metadata);
  if (path.basename(installerPath) !== validated.filename) {
    throw new Error("Installer filename does not match release metadata.");
  }

  const stats = fs.statSync(installerPath);
  if (!stats.isFile() || stats.size !== validated.sizeBytes) {
    throw new Error("Installer size does not match release metadata.");
  }

  const digest = sha256File(installerPath);
  if (digest !== validated.sha256) {
    throw new Error("Installer SHA-256 does not match release metadata.");
  }

  return validated;
}

function validateManifestAgainstRelease(manifest, metadata) {
  const release = validateReleaseMetadata(metadata);
  const validatedManifest = validateUpdateManifest(manifest, "0.0.0");

  if (validatedManifest.version !== release.version) {
    throw new Error("Update manifest version does not match release metadata.");
  }
  if (!validatedManifest.downloadUrl) {
    throw new Error("Release update manifest must include installer metadata.");
  }
  if (validatedManifest.sha256 !== release.sha256) {
    throw new Error("Update manifest SHA-256 does not match release metadata.");
  }
  if (validatedManifest.sizeBytes !== release.sizeBytes) {
    throw new Error("Update manifest installer size does not match release metadata.");
  }
  if (path.basename(new URL(validatedManifest.downloadUrl).pathname) !== release.filename) {
    throw new Error("Update manifest download filename does not match release metadata.");
  }

  return validatedManifest;
}

function buildUpdateManifest({ metadata, releasePageUrl, downloadUrl, publishedAt, notes = "" }) {
  const release = validateReleaseMetadata(metadata);
  const manifest = {
    schemaVersion: 1,
    platform: release.platform,
    arch: release.arch,
    channel: release.channel,
    version: release.version,
    publishedAt,
    releasePageUrl,
    downloadUrl,
    sha256: release.sha256,
    sizeBytes: release.sizeBytes,
    notes
  };

  validateManifestAgainstRelease(manifest, release);
  return manifest;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function writeReleaseBundle({ installerPath, packageJsonPath, outputDir, arch, gitSha }) {
  const metadata = createReleaseMetadata({
    installerPath,
    packageJsonPath,
    arch,
    gitSha
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const metadataPath = path.join(outputDir, "release-metadata.json");
  const checksumsPath = path.join(outputDir, "SHA256SUMS.txt");

  fs.writeFileSync(metadataPath, stableJson(metadata), "utf8");
  fs.writeFileSync(checksumsPath, `${metadata.sha256}  ${metadata.filename}\n`, "utf8");

  return { metadata, metadataPath, checksumsPath };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const values = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function requireArg(values, key) {
  if (!values[key]) throw new Error(`Missing required --${key} argument.`);
  return values[key];
}

function runCli(argv) {
  const { command, values } = parseArgs(argv);

  if (command === "bundle") {
    const result = writeReleaseBundle({
      installerPath: requireArg(values, "installer"),
      packageJsonPath: requireArg(values, "package"),
      outputDir: requireArg(values, "output"),
      arch: values.arch || DEFAULT_ARCH,
      gitSha: requireArg(values, "git-sha")
    });
    process.stdout.write(stableJson(result.metadata));
    return;
  }

  if (command === "manifest") {
    const metadataPath = requireArg(values, "metadata");
    const outputPath = requireArg(values, "output");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const manifest = buildUpdateManifest({
      metadata,
      releasePageUrl: requireArg(values, "release-page-url"),
      downloadUrl: requireArg(values, "download-url"),
      publishedAt: requireArg(values, "published-at"),
      notes: values.notes || ""
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, stableJson(manifest), "utf8");
    process.stdout.write(stableJson(manifest));
    return;
  }

  if (command === "verify") {
    const installerPath = requireArg(values, "installer");
    const metadataPath = requireArg(values, "metadata");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const release = verifyInstallerAgainstMetadata(installerPath, metadata);

    if (values.manifest) {
      const manifest = JSON.parse(fs.readFileSync(values.manifest, "utf8"));
      validateManifestAgainstRelease(manifest, release);
    }

    process.stdout.write(stableJson(release));
    return;
  }

  throw new Error("Usage: release-chain.cjs <bundle|manifest|verify> [options]");
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (cause) {
    process.stderr.write((cause instanceof Error ? cause.message : String(cause)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_SCHEMA_VERSION,
  buildUpdateManifest,
  createReleaseMetadata,
  expectedInstallerFilename,
  readPackageVersion,
  sha256File,
  stableJson,
  validateManifestAgainstRelease,
  validateReleaseMetadata,
  verifyInstallerAgainstMetadata,
  writeReleaseBundle
};
