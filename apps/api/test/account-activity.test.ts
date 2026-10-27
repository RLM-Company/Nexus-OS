import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { RegistrationStore } from "../src/registration-store.js";

describe("account access activity", () => {
  it("shows only the owner's session events without tokens or another account's activity", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const registration = new RegistrationStore(db.sqlite);
    const a = registration.authenticateGoogle("a@example.com", "subject-a-123")!;
    const b = registration.authenticateGoogle("b@example.com", "subject-b-123")!;
    expect(registration.addPassword(a, "owner-password-123")).toBe(true);
    expect(registration.addPassword(b, "other-password-123")).toBe(true);
    const issue = (ownerId: string) =>
      identity.issueSession({
        ownerId,
        actorId: ownerId,
        assurance: "single_factor",
        ttlMs: 60_000
      });
    const current = issue(a),
      old = issue(a),
      foreign = issue(b);
    identity.revokeSession(old.session.session_id, a, a, "owner_session_management");
    identity.registerActor(a, "agent-a", "agent");
    for (let i = 0; i < 120; i++)
      identity.issueSession({ ownerId: a, actorId: "agent-a", assurance: "local", ttlMs: 60_000 });
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: { origin: "https://kosmora.example", store: registration, identity }
    });
    try {
      const failed = (email: string) =>
        app.inject({
          method: "POST",
          url: "/auth/login",
          headers: {
            origin: "https://kosmora.example",
            "content-type": "application/x-www-form-urlencoded"
          },
          payload: new URLSearchParams({ email, password: "wrong-password-123" }).toString()
        });
      const known = await failed("a@example.com");
      expect(known.statusCode).toBe(401);
      expect((await failed("a@example.com")).statusCode).toBe(401);
      expect((await failed("b@example.com")).statusCode).toBe(401);
      const unknown = await failed("unknown@example.com");
      expect(unknown.body).toBe(known.body);
      expect(
        identity
          .listRecentOwnerSessionEvents(a, a, 50)
          .filter((event) => event.event_type === "login.failed")
      ).toHaveLength(1);
      expect(
        identity
          .listRecentOwnerSessionEvents(b, b, 50)
          .filter((event) => event.event_type === "login.failed")
      ).toHaveLength(1);
      const guest = await app.inject({ method: "GET", url: "/auth/account/activity" });
      expect(guest.headers.location).toBe("/login");
      const page = await app.inject({
        method: "GET",
        url: "/auth/account/activity",
        headers: { cookie: `__Host-kosmora-session=${current.token}` }
      });
      expect(page.statusCode).toBe(200);
      expect(page.headers["cache-control"]).toBe("no-store");
      expect(page.body).toContain("Вход выполнен");
      expect(page.body).toContain("Сеанс завершён");
      expect(page.body).toContain("Неудачная попытка входа");
      expect(page.body).not.toContain("wrong-password-123");
      expect(page.body).not.toContain("a@example.com");
      expect(page.body).not.toContain(current.token);
      expect(page.body).not.toContain(old.session.session_id);
      expect(page.body).not.toContain(foreign.session.session_id);
      expect(page.body).not.toContain("subject-b-123");
    } finally {
      await app.close();
      db.close();
    }
  });
});
