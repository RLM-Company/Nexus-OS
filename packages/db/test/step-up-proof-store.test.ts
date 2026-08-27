import type { IdentityContext, StepUpPurpose } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  hashStepUpProofToken,
  IdentityStore,
  openDatabase,
  runMigrations,
  StepUpProofStore
} from "../src/index.js";

const issueIdentity = (
  identityStore: IdentityStore,
  ownerId: string,
  actorId: string
): { token: string; identity: IdentityContext } => {
  identityStore.registerActor(ownerId, actorId, "owner");
  const session = identityStore.issueSession({
    ownerId,
    actorId,
    assurance: "single_factor",
    ttlMs: 10 * 60_000
  });
  return {
    token: session.token,
    identity: identityStore.resolveSession(session.token) as IdentityContext
  };
};

describe("StepUpProofStore", () => {
  it("stores only a token hash and consumes an exact binding once", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const now = () => Date.parse("2026-08-27T12:00:00.000Z");
      const identityStore = new IdentityStore(database.sqlite, { now });
      const { identity } = issueIdentity(identityStore, "owner-1", "actor-1");
      const store = new StepUpProofStore(database.sqlite, { now });
      const issued = store.issueProof({
        identity,
        purpose: "critical_tool_confirmation",
        challenge: "confirmation-nonce-1",
        ttlMs: 60_000
      });
      const stored = database.sqlite
        .prepare("SELECT token_hash FROM step_up_proofs WHERE proof_id = ?")
        .get(issued.proof.proof_id) as { token_hash: string };
      const consumption = {
        token: issued.token,
        identity,
        purpose: "critical_tool_confirmation" as StepUpPurpose,
        challenge: "confirmation-nonce-1"
      };

      expect(issued.token).toMatch(/^cosmora_stepup_/);
      expect(stored.token_hash).toBe(hashStepUpProofToken(issued.token));
      expect(JSON.stringify(stored)).not.toContain(issued.token);
      expect(store.consumeProof(consumption)).toBe(true);
      expect(store.consumeProof(consumption)).toBe(false);
      expect(store.getProof(issued.proof.proof_id, "owner-1")?.status).toBe("consumed");
    } finally {
      database.close();
    }
  });

  it("rejects another owner, session, purpose, or challenge without burning the proof", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const now = () => Date.parse("2026-08-27T12:00:00.000Z");
      const identityStore = new IdentityStore(database.sqlite, { now });
      const first = issueIdentity(identityStore, "owner-1", "actor-1");
      const second = issueIdentity(identityStore, "owner-2", "actor-2");
      const store = new StepUpProofStore(database.sqlite, { now });
      const issued = store.issueProof({
        identity: first.identity,
        purpose: "autonomy_profile_escalation",
        challenge: "project:p1:autonomy-profile:1",
        ttlMs: 60_000
      });
      const base = { token: issued.token, identity: first.identity };

      expect(
        store.consumeProof({
          ...base,
          identity: second.identity,
          purpose: "autonomy_profile_escalation",
          challenge: "project:p1:autonomy-profile:1"
        })
      ).toBe(false);
      expect(
        store.consumeProof({
          ...base,
          purpose: "critical_tool_confirmation",
          challenge: "project:p1:autonomy-profile:1"
        })
      ).toBe(false);
      expect(
        store.consumeProof({
          ...base,
          purpose: "autonomy_profile_escalation",
          challenge: "project:p2:autonomy-profile:1"
        })
      ).toBe(false);
      expect(
        store.consumeProof({
          ...base,
          purpose: "autonomy_profile_escalation",
          challenge: "project:p1:autonomy-profile:1"
        })
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("fails closed after proof expiry or session revocation", async () => {
    const database = openDatabase(":memory:");
    let nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    try {
      await runMigrations(database);
      const identityStore = new IdentityStore(database.sqlite, { now: () => nowMs });
      const first = issueIdentity(identityStore, "owner-1", "actor-1");
      const store = new StepUpProofStore(database.sqlite, { now: () => nowMs });
      const expired = store.issueProof({
        identity: first.identity,
        purpose: "critical_tool_confirmation",
        challenge: "nonce-expired",
        ttlMs: 30_000
      });
      nowMs += 30_000;
      expect(
        store.consumeProof({
          token: expired.token,
          identity: first.identity,
          purpose: "critical_tool_confirmation",
          challenge: "nonce-expired"
        })
      ).toBe(false);

      const activeIdentity = identityStore.resolveSession(first.token) as IdentityContext;
      const revoked = store.issueProof({
        identity: activeIdentity,
        purpose: "critical_tool_confirmation",
        challenge: "nonce-revoked",
        ttlMs: 30_000
      });
      identityStore.revokeSession(
        activeIdentity.session_id,
        activeIdentity.owner_id,
        activeIdentity.actor_id,
        "Security logout"
      );
      expect(
        store.consumeProof({
          token: revoked.token,
          identity: activeIdentity,
          purpose: "critical_tool_confirmation",
          challenge: "nonce-revoked"
        })
      ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("fails closed without violating audit foreign keys for an unpersisted development identity", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const store = new StepUpProofStore(database.sqlite, {
        now: () => Date.parse("2026-08-27T12:00:00.000Z")
      });
      const identity: IdentityContext = {
        owner_id: "local-owner",
        actor_id: "local-owner",
        actor_kind: "owner",
        session_id: "local-development-session",
        assurance: "local",
        authenticated_at: "2026-08-27T00:00:00.000Z",
        expires_at: "9999-12-31T23:59:59.999Z"
      };

      expect(
        store.consumeProof({
          token: "malformed",
          identity,
          purpose: "autonomy_profile_escalation",
          challenge: "project:p1:autonomy-profile:1"
        })
      ).toBe(false);
      const audit = database.sqlite
        .prepare(
          "SELECT session_id, event_type, outcome FROM identity_audit_events WHERE owner_id = ?"
        )
        .get("local-owner");

      expect(audit).toMatchObject({
        session_id: null,
        event_type: "step_up.rejected",
        outcome: "denied"
      });
    } finally {
      database.close();
    }
  });
});
