import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { RegistrationStore } from "../src/registration-store.js";

const origin = "https://kosmora.example";
const email = "owner@example.com";
const post = (
  app: ReturnType<typeof buildApp>,
  url: string,
  fields: Record<string, string>,
  cookie = "",
  requestOrigin = origin
) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin: requestOrigin, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString()
  });

describe("account recovery", () => {
  it("sends indistinguishable responses, consumes tokens once and revokes sessions", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const store = new RegistrationStore(db.sqlite);
    const verifications: string[] = [];
    const resets: string[] = [];
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: {
        origin,
        identity,
        store,
        sendVerification: (_email, link) => {
          verifications.push(link);
          return Promise.resolve();
        },
        sendPasswordReset: (_email, link) => {
          resets.push(link);
          return Promise.resolve();
        }
      }
    });
    try {
      await post(app, "/auth/register", { email, password: "initial-password-123" });
      const confirmation = new URL(verifications[0]!).searchParams.get("token")!;
      const initial = await post(app, "/auth/confirm", { token: confirmation });
      const cookie = initial.headers["set-cookie"] as string;
      expect(
        (await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie } })).statusCode
      ).toBe(204);
      const unknown = await post(app, "/auth/recovery/request", { email: "unknown@example.com" });
      const known = await post(app, "/auth/recovery/request", { email });
      expect(known.statusCode).toBe(200);
      expect(known.body).toBe(unknown.body);
      expect(resets).toHaveLength(1);
      const token = new URL(resets[0]!).searchParams.get("token")!;
      expect(
        (await app.inject({ method: "GET", url: `/auth/recovery/reset?token=${token}` })).statusCode
      ).toBe(200);
      expect(
        (
          await post(
            app,
            "/auth/recovery/reset",
            { token, password: "replacement-password-123" },
            "",
            "https://evil.example"
          )
        ).statusCode
      ).toBe(403);
      expect(
        (await post(app, "/auth/recovery/reset", { token, password: "replacement-password-123" }))
          .statusCode
      ).toBe(303);
      expect(
        (await post(app, "/auth/recovery/reset", { token, password: "replacement-password-123" }))
          .statusCode
      ).toBe(400);
      expect(
        (await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie } })).statusCode
      ).toBe(303);
      expect(
        (await post(app, "/auth/login", { email, password: "initial-password-123" })).statusCode
      ).toBe(401);
      const next = await post(app, "/auth/login", { email, password: "replacement-password-123" });
      expect(next.statusCode).toBe(303);
      const nextCookie = next.headers["set-cookie"] as string;
      expect(
        (
          await post(
            app,
            "/auth/account/password",
            { current: "wrong", password: "changed-password-123" },
            nextCookie
          )
        ).statusCode
      ).toBe(401);
      expect(
        (
          await post(
            app,
            "/auth/account/password",
            { current: "replacement-password-123", password: "changed-password-123" },
            nextCookie
          )
        ).statusCode
      ).toBe(303);
      expect(
        (await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie: nextCookie } }))
          .statusCode
      ).toBe(303);
      expect(store.authenticateEmail(email, "changed-password-123")).toBeTruthy();
    } finally {
      await app.close();
      db.close();
    }
  });

  it("allows a Google account to recover with email, then refuses to remove the last method", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const store = new RegistrationStore(db.sqlite);
    const ownerId = store.authenticateGoogle(email, "google-subject-123")!;
    const session = identity.issueSession({
      ownerId,
      actorId: ownerId,
      assurance: "single_factor",
      ttlMs: 60_000
    });
    const cookie = `__Host-kosmora-session=${session.token}`;
    const resets: string[] = [];
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: {
        origin,
        identity,
        store,
        sendPasswordReset: (_email, link) => {
          resets.push(link);
          return Promise.resolve();
        }
      }
    });
    try {
      expect(
        (
          await post(
            app,
            "/auth/account/method/remove",
            { method: "google", password: "anything-long-enough" },
            cookie
          )
        ).statusCode
      ).toBe(409);
      await post(app, "/auth/recovery/request", { email });
      const token = new URL(resets[0]!).searchParams.get("token")!;
      expect(
        (await post(app, "/auth/recovery/reset", { token, password: "new-email-password-123" }))
          .statusCode
      ).toBe(303);
      expect(store.methods(ownerId)).toEqual({ email: true, google: true });
      expect(
        (await app.inject({ method: "GET", url: "/auth/verify", headers: { cookie } })).statusCode
      ).toBe(303);
      const login = await post(app, "/auth/login", { email, password: "new-email-password-123" });
      const newCookie = login.headers["set-cookie"] as string;
      expect(
        (
          await post(
            app,
            "/auth/account/method/remove",
            { method: "google", password: "wrong" },
            newCookie
          )
        ).statusCode
      ).toBe(409);
      expect(
        (
          await post(
            app,
            "/auth/account/method/remove",
            { method: "google", password: "new-email-password-123" },
            newCookie
          )
        ).statusCode
      ).toBe(303);
      expect(store.methods(ownerId)).toEqual({ email: true, google: false });
      expect(
        (
          await post(
            app,
            "/auth/account/method/remove",
            { method: "email", password: "new-email-password-123" },
            newCookie
          )
        ).statusCode
      ).toBe(401);
      expect(store.removeMethod(ownerId, "email", "new-email-password-123", () => undefined)).toBe(
        false
      );
      const secondOwner = store.authenticateGoogle("second@example.com", "another-google-subject")!;
      expect(store.addPassword(secondOwner, "second-password-123")).toBe(true);
      expect(store.removeMethod(secondOwner, "email", "second-password-123", () => undefined)).toBe(
        true
      );
      expect(store.methods(secondOwner)).toEqual({ email: false, google: true });
      expect(store.authenticateEmail("second@example.com", "second-password-123")).toBeNull();
    } finally {
      await app.close();
      db.close();
    }
  });
  it("rejects expired tokens and rolls back if revoking sessions fails", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    let now = Date.parse("2026-10-12T12:00:00Z");
    const store = new RegistrationStore(db.sqlite, () => now);
    const owner = store.authenticateGoogle(email, "google-subject-456")!;
    try {
      const expired = store.requestPasswordReset(email)!;
      now += 30 * 60 * 1000 + 1;
      expect(store.resetPassword(expired, "another-password-123", () => undefined)).toBe(false);
      const token = store.requestPasswordReset(email)!;
      expect(() =>
        store.resetPassword(token, "another-password-123", () => {
          throw Error("REVOKE_FAILED");
        })
      ).toThrow("REVOKE_FAILED");
      expect(store.methods(owner)).toEqual({ email: false, google: true });
      expect(store.resetPassword(token, "another-password-123", () => undefined)).toBe(true);
    } finally {
      db.close();
    }
  });
});
