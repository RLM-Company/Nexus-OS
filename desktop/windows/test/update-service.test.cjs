"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { canonicalJson, compareVersions, validateSignedManifest } = require("../update-policy.cjs");
const { createUpdateService, fileMatches } = require("../update-service.cjs");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" });
const origin = "https://kosmora.example";
const bytes = Buffer.from("TEST EXECUTABLE BYTES, NOT A REAL INSTALLER");
function signed(
  version = "0.12.0",
  digest = crypto.createHash("sha256").update(bytes).digest("hex")
) {
  const payload = {
    schemaVersion: 1,
    version,
    platform: "win32",
    arch: "x64",
    assetPath: `/releases/Kosmora-${version}.exe`,
    sha256: digest,
    size: bytes.length,
    expiresAt: "2035-01-01T00:00:00Z"
  };
  return {
    ...payload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
  };
}
const respond = (url, value, status = 200) =>
  new Response(value, { status, headers: { "content-length": String(Buffer.byteLength(value)) } });

// Response.url is assigned by Chromium's fetch; emulate it in these transport tests.
function responseFor(url, data) {
  const response = respond(url, data);
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

test("manifest signature, schema, expiry and same-origin are cryptographically enforced", () => {
  const release = signed();
  assert.equal(validateSignedManifest(release, { publicKeyPem: pem, origin }).version, "0.12.0");
  assert.equal(compareVersions("0.12.0", "0.11.9"), 1);
  assert.throws(
    () => validateSignedManifest({ ...release, size: 1 }, { publicKeyPem: pem, origin }),
    /Подпись/
  );
  assert.throws(
    () => validateSignedManifest({ ...release, signature: "" }, { publicKeyPem: pem, origin }),
    /подпись/
  );
  assert.throws(() => validateSignedManifest(release, { publicKeyPem: null, origin }), /Ключ/);
  assert.throws(
    () =>
      validateSignedManifest(release, {
        publicKeyPem: pem,
        origin,
        now: Date.parse("2036-01-01T00:00:00Z")
      }),
    /просрочен/
  );
  const outside = signed();
  outside.assetPath = "https://evil.example/Kosmora.exe";
  assert.throws(
    () => validateSignedManifest(outside, { publicKeyPem: pem, origin }),
    /том же сервере/
  );
});

test("signed manifests stage exact SHA-256 bytes; tampered downloads leave no executable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-updates-"));
  try {
    let corrupt = false;
    const service = createUpdateService({
      fetcher: async (url) =>
        responseFor(
          url,
          url.endsWith(".json")
            ? JSON.stringify(signed())
            : corrupt
              ? Buffer.from("corrupt")
              : bytes
        ),
      origin: () => origin,
      currentVersion: () => "0.11.0",
      userData: dir,
      publicKeyPem: pem
    });
    assert.deepEqual(await service.check(), {
      status: "available",
      version: "0.12.0",
      size: bytes.length
    });
    corrupt = true;
    await assert.rejects(service.stage(), /Размер|SHA-256/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "verified-releases")), []);
    corrupt = false;
    const staged = await service.stage();
    assert.equal(fs.readFileSync(staged.file).equals(bytes), true);
    assert.equal(await fileMatches(staged.file, signed().sha256, bytes.length), true);
    assert.equal(await service.stage().then((result) => result.reused), true);
    assert.equal(await service.previousVerified(), null);
    const oldService = createUpdateService({
      fetcher: async () => {
        throw new Error("No network");
      },
      origin: () => origin,
      currentVersion: () => "0.13.0",
      userData: dir,
      publicKeyPem: pem
    });
    assert.equal((await oldService.previousVerified()).version, "0.12.0");
    const indexFile = path.join(dir, "verified-releases", "index.json");
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    fs.writeFileSync(staged.file, "modified after verification");
    const maliciousBytes = fs.readFileSync(staged.file);
    fs.writeFileSync(
      indexFile,
      JSON.stringify([
        {
          ...index[0],
          size: maliciousBytes.length,
          sha256: crypto.createHash("sha256").update(maliciousBytes).digest("hex")
        }
      ])
    );
    assert.equal(
      await oldService.previousVerified(),
      null,
      "mutable index hashes cannot replace signed release evidence"
    );
    fs.writeFileSync(indexFile, JSON.stringify(index));
    fs.writeFileSync(staged.file, "modified after verification");
    assert.equal(await oldService.previousVerified(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("without a pinned key there is no fetch, update or automatic execution", async () => {
  let requests = 0;
  const service = createUpdateService({
    fetcher: () => {
      requests += 1;
      throw Error("unexpected");
    },
    origin: () => origin,
    currentVersion: () => "0.11.0",
    userData: "/invalid",
    publicKeyPem: null
  });
  assert.equal((await service.check()).status, "disabled");
  await assert.rejects(service.stage(), /подписанного/);
  assert.equal(requests, 0);
});

test("a server switch during download cannot stage an installer from the previous origin", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-switch-origin-"));
  try {
    let activeOrigin = origin;
    const service = createUpdateService({
      fetcher: async (url) => {
        if (url.endsWith(".json")) return responseFor(url, JSON.stringify(signed()));
        activeOrigin = "https://other-kosmora.example";
        return responseFor(url, bytes);
      },
      origin: () => activeOrigin,
      currentVersion: () => "0.11.0",
      userData: dir,
      publicKeyPem: pem
    });
    await assert.rejects(service.stage(), /сервер изменился/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "verified-releases")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("redirects and mismatched manifest origins are rejected before download", async () => {
  const service = createUpdateService({
    fetcher: async (url) => {
      const response = responseFor(url, JSON.stringify(signed()));
      Object.defineProperty(response, "url", { value: origin + "/login", configurable: true });
      return response;
    },
    origin: () => origin,
    currentVersion: () => "0.11.0",
    userData: "/invalid",
    publicKeyPem: pem
  });
  await assert.rejects(service.check(), /отклонён/);
});
