import { loadServerConfig } from "@cosmora/config";
import { generateKeyPairSync, sign } from "node:crypto";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { RegistrationStore } from "../src/registration-store.js";
import { GoogleIdentity } from "../src/google-identity.js";

const origin = "https://kosmora.example";
const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

describe("registration and owner identity", () => {
  it("confirms email once, issues a separate owner session and isolates another user", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const registration = new RegistrationStore(db.sqlite);
    const sent: Array<{ email: string; link: string }> = [];
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: {
        origin,
        store: registration,
        identity,
        sendVerification: async (email, link) => {
          sent.push({ email, link });
        }
      }
    });
    try {
      const post = (url: string, values: Record<string, string>, requestOrigin = origin) =>
        app.inject({
          method: "POST",
          url,
          headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" },
          payload: form(values)
        });
      expect((await app.inject({ method: "GET", url: "/register" })).statusCode).toBe(200);
      expect(
        (
          await post("/auth/register", {
            email: "Owner@Example.com",
            password: "correct-horse-123"
          })
        ).statusCode
      ).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.email).toBe("owner@example.com");
      expect(
        (await post("/auth/login", { email: "owner@example.com", password: "correct-horse-123" }))
          .statusCode
      ).toBe(401);
      expect(
        (
          await post(
            "/auth/register",
            { email: "other@example.com", password: "correct-horse-123" },
            "https://evil.example"
          )
        ).statusCode
      ).toBe(403);
      const token = new URL(sent[0]!.link).searchParams.get("token")!;
      const preview = await app.inject({ method: "GET", url: `/auth/confirm?token=${token}` });
      expect(preview.statusCode).toBe(200);
      expect((await post("/auth/confirm", { token }, "https://evil.example")).statusCode).toBe(403);
      const confirmed = await post("/auth/confirm", { token });
      expect(confirmed.statusCode).toBe(303);
      expect((await post("/auth/confirm", { token })).statusCode).toBe(400);
      const cookie = confirmed.headers["set-cookie"] as string;
      expect(cookie).toContain("Secure; HttpOnly; SameSite=Lax");
      const verify = await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie } });
      expect(verify.statusCode).toBe(204);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/auth/verify",
            headers: { cookie, "x-forwarded-method": "POST", origin: "https://evil.example" }
          })
        ).statusCode
      ).toBe(403);
      const auth = verify.headers["x-kosmora-authorization"] as string;
      expect(auth).toMatch(/^Bearer cosmora_session_/);
      const owner = await app.inject({
        method: "GET",
        url: "/api/v1/identity/sessions",
        headers: { authorization: auth }
      });
      expect(owner.statusCode).toBe(200);
      const ownerId = owner.json<{ items: Array<{ owner_id: string }> }>().items[0]?.owner_id;
      expect(ownerId).toBeTruthy();
      expect(registration.authenticateGoogle("owner@example.com", "123456789012")).toBeNull();
      expect(registration.linkGoogle(ownerId!, "123456789012")).toBe(true);
      expect(registration.authenticateGoogle("owner@example.com", "123456789012")).toBe(ownerId);
      const secondEmail = "second@example.com";
      await post("/auth/register", { email: secondEmail, password: "another-password-123" });
      const secondToken = new URL(sent[1]!.link).searchParams.get("token")!;
      const secondSession = await post("/auth/confirm", { token: secondToken });
      const secondVerify = await app.inject({
        method: "GET",
        url: "/auth/verify",
        headers: { cookie: secondSession.headers["set-cookie"] as string }
      });
      const other = await app.inject({
        method: "GET",
        url: "/api/v1/identity/sessions",
        headers: { authorization: secondVerify.headers["x-kosmora-authorization"] as string }
      });
      expect(other.json<{ items: Array<{ owner_id: string }> }>().items[0]?.owner_id).not.toBe(
        ownerId
      );
      expect(
        registration.linkGoogle(
          other.json<{ items: Array<{ owner_id: string }> }>().items[0]!.owner_id,
          "123456789012"
        )
      ).toBe(false);
      const googleOwner = registration.authenticateGoogle("new-google@example.com", "123456789013");
      expect(googleOwner).toBeTruthy();
      expect(googleOwner).not.toBe(ownerId);
      expect(
        registration.authenticateEmail("new-google@example.com", "new-password-123")
      ).toBeNull();
      expect(registration.addPassword(googleOwner!, "new-password-123")).toBe(true);
      expect(registration.authenticateEmail("new-google@example.com", "new-password-123")).toBe(
        googleOwner
      );
      expect(other.json<{ items: unknown[] }>().items).toHaveLength(1);
      const loggedOut = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { origin, cookie }
      });
      expect(loggedOut.statusCode).toBe(303);
      expect(
        (await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie } })).statusCode
      ).toBe(303);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("completes Google callback only with the matching transaction and issues its own cookie", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", use: "sig" };
    let nonce = "";
    const google = new GoogleIdentity(
      "client.apps.googleusercontent.com",
      "fixture-secret",
      `${origin}/auth/google/callback`,
      async (input) => {
        if (String(input).endsWith("/certs")) return Response.json({ keys: [key] });
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString(
          "base64url"
        );
        const payload = Buffer.from(
          JSON.stringify({
            iss: "https://accounts.google.com",
            aud: "client.apps.googleusercontent.com",
            sub: "12345678901234567891",
            email: "new-google@example.com",
            email_verified: true,
            nonce,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 600
          })
        ).toString("base64url");
        const signature = sign(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          privateKey
        ).toString("base64url");
        return Response.json({ id_token: `${header}.${payload}.${signature}` });
      }
    );
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: { origin, store: new RegistrationStore(db.sqlite), identity, google }
    });
    try {
      const start = await app.inject({ method: "GET", url: "/auth/google" });
      expect(start.statusCode).toBe(303);
      const destination = new URL(start.headers.location as string);
      const oauthCookie = start.headers["set-cookie"] as string;
      const encoded = oauthCookie.split(";", 1)[0]!.split("=")[1]!;
      nonce = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")).nonce as string;
      const state = destination.searchParams.get("state")!;
      const denied = await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=fixture&state=wrong",
        headers: { cookie: oauthCookie }
      });
      expect(denied.headers.location).toBe("/login?error=google");
      const accepted = await app.inject({
        method: "GET",
        url: `/auth/google/callback?code=fixture&state=${state}`,
        headers: { cookie: oauthCookie }
      });
      expect(accepted.statusCode).toBe(303);
      const sessionCookie = (accepted.headers["set-cookie"] as string[]).find((item) =>
        item.startsWith("__Host-kosmora-session=")
      );
      expect(sessionCookie).toBeTruthy();
      const verify = await app.inject({
        method: "GET",
        url: "/auth/verify",
        headers: { cookie: sessionCookie! }
      });
      expect(verify.statusCode).toBe(204);
      expect(verify.headers["x-kosmora-authorization"]).toMatch(/^Bearer cosmora_session_/);
    } finally {
      await app.close();
      db.close();
    }
  });
});
