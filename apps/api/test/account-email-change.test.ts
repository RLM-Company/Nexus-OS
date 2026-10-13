import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { RegistrationStore } from "../src/registration-store.js";
import { EmailChangePrivacyAdapter } from "../src/email-change-privacy.js";

const origin = "https://kosmora.example";
describe("account email change", () => {
  it("requires the password and new mailbox, then revokes sessions and invalidates the link", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    const store = new RegistrationStore(db.sqlite);
    const owner = store.authenticateGoogle("old@example.com", "google-old-123")!;
    expect(store.addPassword(owner, "current-password-123")).toBe(true);
    store.authenticateGoogle("taken@example.com", "google-taken-123");
    const first = identity.issueSession({
      ownerId: owner,
      actorId: owner,
      assurance: "single_factor",
      ttlMs: 60_000
    });
    const second = identity.issueSession({
      ownerId: owner,
      actorId: owner,
      assurance: "single_factor",
      ttlMs: 60_000
    });
    const cookie = `__Host-kosmora-session=${first.token}`;
    const links: string[] = [];
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      registration: {
        origin,
        store,
        identity,
        sendEmailChange: (_email, link) => {
          links.push(link);
          return Promise.resolve();
        }
      }
    });
    const post = (
      url: string,
      fields: Record<string, string>,
      headers: Record<string, string> = {}
    ) =>
      Promise.resolve(
        app.inject({
          method: "POST",
          url,
          headers: {
            origin,
            cookie,
            "content-type": "application/x-www-form-urlencoded",
            ...headers
          },
          payload: new URLSearchParams(fields).toString()
        })
      );
    try {
      expect(
        (
          await post(
            "/auth/account/email-change/request",
            { email: "new@example.com", password: "current-password-123" },
            { origin: "https://evil.example" }
          )
        ).statusCode
      ).toBe(403);
      expect(
        (
          await post("/auth/account/email-change/request", {
            email: "new@example.com",
            password: "wrong"
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await post("/auth/account/email-change/request", {
            email: "taken@example.com",
            password: "current-password-123"
          })
        ).statusCode
      ).toBe(200);
      expect(links).toHaveLength(0);
      expect(
        (
          await post("/auth/account/email-change/request", {
            email: "new@example.com",
            password: "current-password-123"
          })
        ).statusCode
      ).toBe(200);
      expect(links).toHaveLength(1);
      expect(store.authenticateEmail("old@example.com", "current-password-123")).toBe(owner);
      expect(store.authenticateEmail("new@example.com", "current-password-123")).toBeNull();
      const token = new URL(links[0]!).searchParams.get("token")!;
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/auth/account/email-change/confirm?token=${token}`
          })
        ).statusCode
      ).toBe(200);
      const privacy = new EmailChangePrivacyAdapter(db.sqlite);
      expect((await privacy.export(owner)).records.pending_email_changes).toHaveLength(1);
      expect(JSON.stringify((await privacy.export(owner)).records)).not.toContain("token_hash");
      expect(
        (
          await post(
            "/auth/account/email-change/confirm",
            { token },
            { origin: "https://evil.example" }
          )
        ).statusCode
      ).toBe(403);
      expect((await post("/auth/account/email-change/confirm", { token })).statusCode).toBe(303);
      expect((await post("/auth/account/email-change/confirm", { token })).statusCode).toBe(400);
      expect(identity.resolveSession(first.token)).toBeNull();
      expect(identity.resolveSession(second.token)).toBeNull();
      expect(store.authenticateEmail("old@example.com", "current-password-123")).toBeNull();
      expect(store.authenticateEmail("new@example.com", "current-password-123")).toBe(owner);
      expect((await privacy.export(owner)).records.pending_email_changes).toHaveLength(0);
      expect(
        store.requestEmailChange(owner, "current-password-123", "next@example.com")
      ).toBeTruthy();
      const at = "2026-10-13T13:00:00.000Z";
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'quiescing','op',?,?)"
        )
        .run(owner, at, at);
      expect(() =>
        store.requestEmailChange(owner, "current-password-123", "later@example.com")
      ).toThrow("OWNER_DATA_FENCED");
      db.sqlite
        .prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id=?")
        .run(owner);
      expect((await privacy.delete(owner, 1)).deleted_records).toBe(1);
      expect((await privacy.export(owner)).records.pending_email_changes).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
    }
  });
});
