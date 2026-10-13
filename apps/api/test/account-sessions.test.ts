import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { RegistrationStore } from "../src/registration-store.js";

const origin = "https://kosmora.example";

describe("owner session management", () => {
  it("lists only owner sign-ins and revokes other sessions without ending the current one", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const registration = new RegistrationStore(db.sqlite);
    const owner = registration.authenticateGoogle("owner@example.com", "google-owner-123")!;
    const otherOwner = registration.authenticateGoogle("other@example.com", "google-other-123")!;
    const issue = (id: string) =>
      identity.issueSession({
        ownerId: id,
        actorId: id,
        assurance: "single_factor",
        ttlMs: 60_000
      });
    const current = issue(owner),
      another = issue(owner),
      third = issue(owner),
      foreign = issue(otherOwner);
    const cookie = `__Host-kosmora-session=${current.token}`;
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: { origin, store: registration, identity }
    });
    const post = (fields: Record<string, string>, requestOrigin = origin) =>
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/auth/account/sessions/revoke",
          headers: {
            cookie,
            origin: requestOrigin,
            "content-type": "application/x-www-form-urlencoded"
          },
          payload: new URLSearchParams(fields).toString()
        })
      );
    try {
      expect(
        (await app.inject({ method: "GET", url: "/auth/account/sessions" })).headers.location
      ).toBe("/login");
      const page = await app.inject({
        method: "GET",
        url: "/auth/account/sessions",
        headers: { cookie }
      });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("Завершить все другие сеансы");
      expect(page.body).toContain(another.session.session_id);
      expect(page.body).not.toContain(foreign.session.session_id);
      expect((await post({ all_others: "1" }, "https://evil.example")).statusCode).toBe(403);
      expect((await post({ session_id: foreign.session.session_id })).statusCode).toBe(404);
      expect((await post({ session_id: current.session.session_id })).statusCode).toBe(404);
      expect((await post({ session_id: another.session.session_id })).statusCode).toBe(303);
      expect(identity.resolveSession(another.token)).toBeNull();
      expect(identity.resolveSession(third.token)).not.toBeNull();
      expect((await post({ all_others: "1" })).statusCode).toBe(303);
      expect(identity.resolveSession(third.token)).toBeNull();
      expect(identity.resolveSession(current.token)).not.toBeNull();
      expect(identity.resolveSession(foreign.token)).not.toBeNull();
    } finally {
      await app.close();
      db.close();
    }
  });
});
