"use strict";

// Operator-only helper. Never bundle or publish the private key with Kosmora.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, compareVersions, MAX_INSTALLER_BYTES } = require("../update-policy.cjs");

async function createSignedUpdate({ installer, version, assetPath, expiresAt, privateKeyFile }) {
  compareVersions(version, "0.0.0");
  if (typeof assetPath !== "string" || !/^\/[A-Za-z0-9/_-]+\.exe$/.test(assetPath))
    throw new Error("Expected safe absolute same-origin .exe asset path");
  if (
    typeof expiresAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expiresAt) ||
    Date.parse(expiresAt) <= Date.now()
  )
    throw new Error("Expected future UTC expiry");
  const file = path.resolve(installer);
  const stats = await fs.promises.stat(file);
  if (!stats.isFile() || stats.size < 1 || stats.size > MAX_INSTALLER_BYTES)
    throw new Error("Installer size is outside policy limits");
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  const payload = {
    schemaVersion: 1,
    version,
    platform: "win32",
    arch: "x64",
    assetPath,
    sha256: digest.digest("hex"),
    size: stats.size,
    expiresAt
  };
  const key = crypto.createPrivateKey(fs.readFileSync(privateKeyFile));
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Only Ed25519 signing keys are permitted");
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload)), key).toString("base64");
  return { ...payload, signature };
}

if (require.main === module) {
  const [installer, version, assetPath, expiresAt, privateKeyFile] = process.argv.slice(2);
  if (!installer || !version || !assetPath || !expiresAt || !privateKeyFile) {
    console.error(
      "Usage: node ci/create-signed-update.cjs INSTALLER VERSION /releases/FILE.exe 2030-01-01T00:00:00Z PRIVATE_KEY.pem"
    );
    process.exitCode = 2;
  } else {
    createSignedUpdate({ installer, version, assetPath, expiresAt, privateKeyFile })
      .then((manifest) => process.stdout.write(JSON.stringify(manifest, null, 2) + "\n"))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { createSignedUpdate };
