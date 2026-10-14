import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleIdentity, newOAuthTransaction } from "../src/google-identity.js";

describe("Google sign-in validation", () => {
  it("uses code, state, nonce and S256, verifies Google's signature and rejects altered claims", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", use: "sig" };
    const transaction = newOAuthTransaction();
    const now = Date.now();
    const token = (override: Record<string, unknown> = {}) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString(
        "base64url"
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: "https://accounts.google.com",
          aud: "client.apps.googleusercontent.com",
          sub: "12345678901234567890",
          email: "google@example.com",
          email_verified: true,
          nonce: transaction.nonce,
          exp: Math.floor(now / 1000) + 600,
          iat: Math.floor(now / 1000),
          ...override
        })
      ).toString("base64url");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        privateKey
      ).toString("base64url");
      return `${header}.${payload}.${signature}`;
    };
    const requested: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      requested.push(url);
      if (url.endsWith("/certs")) return Promise.resolve(Response.json({ keys: [key] }));
      if (url.endsWith("/token")) return Promise.resolve(Response.json({ id_token: token() }));
      throw Error("Unexpected remote endpoint");
    };
    const google = new GoogleIdentity(
      "client.apps.googleusercontent.com",
      "fixture-secret",
      "https://kosmora.example/auth/google/callback",
      fakeFetch,
      () => now
    );
    const destination = new URL(google.authorizationUrl(transaction));
    expect(destination.origin).toBe("https://accounts.google.com");
    expect(destination.searchParams.get("response_type")).toBe("code");
    expect(destination.searchParams.get("state")).toBe(transaction.state);
    expect(destination.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await google.exchange("one-time-code", transaction)).toEqual({
      email: "google@example.com",
      subject: "12345678901234567890"
    });
    expect(requested).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/oauth2/v3/certs"
    ]);
    await expect(
      google.verifyIdToken(token({ aud: "another-app" }), transaction.nonce)
    ).rejects.toThrow();
    await expect(
      google.verifyIdToken(token({ email_verified: false }), transaction.nonce)
    ).rejects.toThrow();
    await expect(google.verifyIdToken(token(), "wrong-nonce")).rejects.toThrow();
    await expect(
      google.verifyIdToken(token({ exp: Math.floor(now / 1000) - 1 }), transaction.nonce)
    ).rejects.toThrow();
  });
});
