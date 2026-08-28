import { describe, expect, it } from "vitest";
import {
  IdentityStore,
  IdentityStoreConflictError,
  hashIdentitySessionToken,
  openDatabase,
  runMigrations
} from "../src/index.js";

describe("IdentityStore", () => {
  it("stores only a session-token hash and resolves an active session", async () => {
    const database = openDatabase(":memory:");
    let now = Date.parse("2026-08-27T12:00:00.000Z");

    try {
      await runMigrations(database);
      const store = new IdentityStore(database.sqlite, { now: () => now });
      store.registerActor("owner-1", "owner-actor-1", "owner");
      const issued = store.issueSession({
        ownerId: "owner-1",
        actorId: "owner-actor-1",
        assurance: "single_factor",
        ttlMs: 60_000
      });
      const stored = database.sqlite
        .prepare("SELECT token_hash FROM identity_sessions WHERE session_id = ?")
        .get(issued.session.session_id) as { token_hash: string };

      expect(issued.token).toMatch(/^cosmora_session_/);
      expect(stored.token_hash).toBe(hashIdentitySessionToken(issued.token));
      expect(JSON.stringify(stored)).not.toContain(issued.token);
      expect(store.resolveSession(issued.token)).toMatchObject({
        owner_id: "owner-1",
        actor_id: "owner-actor-1",
        actor_kind: "owner",
        session_id: issued.session.session_id,
        assurance: "single_factor"
      });

      now += 1_000;
      expect(store.getSession(issued.session.session_id, "owner-1")?.last_seen_at).toBe(
        "2026-08-27T12:00:00.000Z"
      );
      expect(store.resolveSession(issued.token)).not.toBeNull();
      expect(store.getSession(issued.session.session_id, "owner-1")?.last_seen_at).toBe(
        "2026-08-27T12:00:01.000Z"
      );
    } finally {
      database.close();
    }
  });

  it("fails closed for expired and revoked sessions", async () => {
    const database = openDatabase(":memory:");
    let now = Date.parse("2026-08-27T12:00:00.000Z");

    try {
      await runMigrations(database);
      const store = new IdentityStore(database.sqlite, { now: () => now });
      store.registerActor("owner-1", "owner-actor-1", "owner");
      const expired = store.issueSession({
        ownerId: "owner-1",
        actorId: "owner-actor-1",
        assurance: "local",
        ttlMs: 60_000
      });

      now += 60_000;
      expect(store.resolveSession(expired.token)).toBeNull();
      expect(store.getSession(expired.session.session_id, "owner-1")?.status).toBe("expired");

      const revoked = store.issueSession({
        ownerId: "owner-1",
        actorId: "owner-actor-1",
        assurance: "multi_factor",
        ttlMs: 60_000
      });
      expect(
        store.revokeSession(revoked.session.session_id, "owner-1", "owner-actor-1", "Owner logout")
      ).toBe(true);
      expect(store.resolveSession(revoked.token)).toBeNull();
      expect(store.listAuditEvents("owner-1").map((event) => event.event_type)).toEqual([
        "session.issued",
        "session.expired",
        "session.issued",
        "session.revoked"
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps actors and session control inside the owner boundary", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const store = new IdentityStore(database.sqlite, {
        now: () => Date.parse("2026-08-27T12:00:00.000Z")
      });
      store.registerActor("owner-1", "shared-actor-id", "owner");
      expect(() => store.registerActor("owner-2", "shared-actor-id", "owner")).toThrow(
        IdentityStoreConflictError
      );
      const issued = store.issueSession({
        ownerId: "owner-1",
        actorId: "shared-actor-id",
        assurance: "local",
        ttlMs: 60_000
      });

      expect(store.getSession(issued.session.session_id, "owner-2")).toBeNull();
      expect(
        store.revokeSession(issued.session.session_id, "owner-2", "owner-2", "Unauthorized")
      ).toBe(false);
      expect(store.resolveSession(issued.token)).not.toBeNull();
      expect(store.disableActor("shared-actor-id", "owner-1", "owner-1", "Compromised")).toBe(true);
      expect(store.resolveSession(issued.token)).toBeNull();
      expect(store.getSession(issued.session.session_id, "owner-1")?.status).toBe("revoked");
    } finally {
      database.close();
    }
  });

  it("reconciles expired sessions when the owner lists session inventory", async () => {
    const database = openDatabase(":memory:");
    let now = Date.parse("2026-08-27T12:00:00.000Z");

    try {
      await runMigrations(database);
      const store = new IdentityStore(database.sqlite, { now: () => now });
      store.registerActor("owner-1", "actor-1", "owner");
      const issued = store.issueSession({
        ownerId: "owner-1",
        actorId: "actor-1",
        assurance: "single_factor",
        ttlMs: 60_000
      });

      now += 60_000;
      expect(store.listSessions("owner-1")).toEqual([
        expect.objectContaining({
          session_id: issued.session.session_id,
          status: "expired"
        })
      ]);
      expect(store.listAuditEvents("owner-1").map((event) => event.event_type)).toEqual([
        "session.issued",
        "session.expired"
      ]);
      expect(store.listSessions("owner-1")[0]?.status).toBe("expired");
      expect(store.listAuditEvents("owner-1")).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("revokes every active owner session without affecting another owner", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const store = new IdentityStore(database.sqlite, {
        now: () => Date.parse("2026-08-27T12:00:00.000Z")
      });
      store.registerActor("owner-1", "actor-1", "owner");
      store.registerActor("owner-2", "actor-2", "owner");
      const first = store.issueSession({
        ownerId: "owner-1",
        actorId: "actor-1",
        assurance: "local",
        ttlMs: 60_000
      });
      const second = store.issueSession({
        ownerId: "owner-1",
        actorId: "actor-1",
        assurance: "local",
        ttlMs: 60_000
      });
      const other = store.issueSession({
        ownerId: "owner-2",
        actorId: "actor-2",
        assurance: "local",
        ttlMs: 60_000
      });

      expect(store.revokeAllOwnerSessions("owner-1", "actor-1", "Security reset")).toBe(2);
      expect(store.resolveSession(first.token)).toBeNull();
      expect(store.resolveSession(second.token)).toBeNull();
      expect(store.resolveSession(other.token)).not.toBeNull();
    } finally {
      database.close();
    }
  });
});
