"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * IETF RFC 7517 JSON Web Key Set (.jwks.json with RFC 7638 JWK Thumbprints) &
 * OpenID Connect 1.0 Discovery Metadata (.openid-configuration.json) Bundle Builder
 * for Kosmora Desktop Workspace.
 */
class JwksAndOidcDiscoveryBundleBuilder {
  static computeRfc7638Thumbprint(jwk) {
    let canonicalMembers;
    if (jwk.kty === "EC") {
      canonicalMembers = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
    } else if (jwk.kty === "OKP") {
      canonicalMembers = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
    } else {
      canonicalMembers = { e: jwk.e || "AQAB", kty: jwk.kty || "RSA", n: jwk.n || "" };
    }
    const canonicalJson = JSON.stringify(canonicalMembers);
    return crypto.createHash("sha256").update(canonicalJson).digest("base64url");
  }

  static buildBundle(spec) {
    const issuer = (spec.issuer || "https://auth.kosmora.ai").replace(/\/$/, "");
    const rawKeys = Array.isArray(spec.keys) ? spec.keys : [];

    const keys = rawKeys.map((k) => {
      const thumbprint = JwksAndOidcDiscoveryBundleBuilder.computeRfc7638Thumbprint(k);
      return {
        kty: k.kty || "OKP",
        crv: k.crv || "Ed25519",
        use: k.use || "sig",
        alg: k.alg || "EdDSA",
        kid: k.kid || thumbprint,
        x: k.x,
        ...(k.y ? { y: k.y } : {}),
        ...(k.n ? { n: k.n, e: k.e || "AQAB" } : {}),
        x5tS256: thumbprint
      };
    });

    const jwksObject = { keys };
    const oidcDiscoveryObject = {
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      userinfo_endpoint: `${issuer}/oauth2/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code", "id_token"],
      subject_types_supported: ["public", "pairwise"],
      id_token_signing_alg_values_supported: ["EdDSA", "ES256", "RS256"],
      scopes_supported: ["openid", "profile", "email", "kosmora:kernel"],
      token_endpoint_auth_methods_supported: ["private_key_jwt", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"]
    };

    const jwksText = JSON.stringify(jwksObject, null, 2) + "\n";
    const oidcText = JSON.stringify(oidcDiscoveryObject, null, 2) + "\n";

    const bundleSha256 = crypto
      .createHash("sha256")
      .update(jwksText)
      .update(oidcText)
      .digest("hex");

    return {
      jwksObject,
      oidcDiscoveryObject,
      jwksText,
      oidcText,
      bundleSha256
    };
  }

  static writeBundleFiles(outputDir, baseName, spec) {
    fs.mkdirSync(outputDir, { recursive: true });
    const built = JwksAndOidcDiscoveryBundleBuilder.buildBundle(spec);
    const jwksPath = path.join(outputDir, `${baseName}.jwks.json`);
    const oidcPath = path.join(outputDir, `${baseName}.openid-configuration.json`);
    fs.writeFileSync(jwksPath, built.jwksText, "utf8");
    fs.writeFileSync(oidcPath, built.oidcText, "utf8");
    return {
      ...built,
      jwksPath,
      oidcPath
    };
  }
}

module.exports = { JwksAndOidcDiscoveryBundleBuilder };
