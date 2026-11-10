"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  JwksAndOidcDiscoveryBundleBuilder
} = require("../workspace/jwks-and-oidc-discovery-bundle-builder.cjs");

test("RFC 7517 JWKS & OIDC 1.0 Discovery Builder computes RFC 7638 JWK thumbprints and writes discovery bundles", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-jwks-oidc-"));
  try {
    const res = JwksAndOidcDiscoveryBundleBuilder.writeBundleFiles(tmpDir, "kosmora-idp", {
      issuer: "https://id.kosmora.ai",
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          alg: "EdDSA",
          use: "sig",
          x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
        }
      ]
    });

    assert.equal(res.jwksObject.keys.length, 1);
    assert.ok(res.jwksObject.keys[0].kid.length > 10);
    assert.equal(
      res.oidcDiscoveryObject.jwks_uri,
      "https://id.kosmora.ai/.well-known/jwks.json"
    );
    assert.equal(fs.existsSync(res.jwksPath), true);
    assert.equal(fs.existsSync(res.oidcPath), true);
    assert.equal(res.bundleSha256.length, 64);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
