"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSignedUpdate } = require("../ci/create-signed-update.cjs");
const { validateSignedManifest } = require("../update-policy.cjs");

test("operator signs an actual local installer hash and the client can verify it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-sign-"));
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const installer = path.join(dir, "local.exe");
    const privateKeyFile = path.join(dir, "offline-key.pem");
    fs.writeFileSync(installer, "fixture contents");
    fs.writeFileSync(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600
    });
    const signed = await createSignedUpdate({
      installer,
      version: "0.12.0",
      assetPath: "/releases/Installer.exe",
      expiresAt: "2035-01-01T00:00:00Z",
      privateKeyFile
    });
    assert.equal(
      validateSignedManifest(signed, {
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        origin: "https://cosmora.example"
      }).version,
      "0.12.0"
    );
    assert.equal(
      signed.sha256,
      crypto.createHash("sha256").update("fixture contents").digest("hex")
    );
    assert.equal(JSON.stringify(signed).includes("PRIVATE KEY"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
