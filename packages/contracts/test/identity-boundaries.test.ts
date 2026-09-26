import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ActorKindSchema,
  ActorStatusSchema,
  AuthenticationAssuranceSchema,
  IdentityActorSchema,
  IdentityContextSchema,
  IdentitySessionSchema,
  OwnerSessionListResponseSchema,
  OwnerSessionViewSchema,
  RevokeSessionRequestSchema,
  SessionStatusSchema
} from "../src/index.js";

const timestamp = "2026-09-22T20:00:00.000Z";

const actor = {
  actor_id: "actor-1",
  owner_id: "owner-1",
  kind: "owner",
  status: "active",
  created_at: timestamp,
  updated_at: timestamp
} as const;

const session = {
  session_id: "session-1",
  owner_id: "owner-1",
  actor_id: "actor-1",
  assurance: "local",
  status: "active",
  issued_at: timestamp,
  expires_at: "2026-09-23T20:00:00.000Z",
  last_seen_at: timestamp,
  revoked_at: null,
  revoked_by: null,
  revoke_reason: null
} as const;

const isActor = (candidate: unknown) => Value.Check(IdentityActorSchema, candidate);
const isSession = (candidate: unknown) => Value.Check(IdentitySessionSchema, candidate);

describe("identity enum boundaries", () => {
  it("accepts every actor kind", () => {
    for (const kind of ["owner", "system", "agent"]) {
      expect(Value.Check(ActorKindSchema, kind)).toBe(true);
    }
  });

  it("accepts every actor status", () => {
    for (const status of ["active", "disabled"]) {
      expect(Value.Check(ActorStatusSchema, status)).toBe(true);
    }
  });

  it("accepts every session status", () => {
    for (const status of ["active", "revoked", "expired"]) {
      expect(Value.Check(SessionStatusSchema, status)).toBe(true);
    }
  });

  it("accepts every authentication assurance value", () => {
    for (const assurance of ["local", "single_factor", "multi_factor"]) {
      expect(Value.Check(AuthenticationAssuranceSchema, assurance)).toBe(true);
    }
  });

  it("rejects unknown enum values", () => {
    expect(Value.Check(ActorKindSchema, "user")).toBe(false);
    expect(Value.Check(ActorStatusSchema, "revoked")).toBe(false);
    expect(Value.Check(SessionStatusSchema, "disabled")).toBe(false);
    expect(Value.Check(AuthenticationAssuranceSchema, "password")).toBe(false);
  });
});

describe("identity actor boundaries", () => {
  it("accepts every actor kind and status combination", () => {
    for (const kind of ["owner", "system", "agent"]) {
      for (const status of ["active", "disabled"]) {
        expect(isActor({ ...actor, kind, status })).toBe(true);
      }
    }
  });

  it("rejects malformed ids and timestamps", () => {
    expect(isActor({ ...actor, actor_id: "actor id" })).toBe(false);
    expect(isActor({ ...actor, owner_id: "" })).toBe(false);
    expect(isActor({ ...actor, created_at: "2026-09-22" })).toBe(false);
    expect(isActor({ ...actor, updated_at: "2026-09-22T20:00:00" })).toBe(false);
  });

  it("rejects missing and additional properties", () => {
    const missing: Record<string, unknown> = { ...actor };
    delete missing.kind;
    expect(isActor(missing)).toBe(false);
    expect(isActor({ ...actor, unexpected: true })).toBe(false);
  });
});

describe("identity session boundaries", () => {
  it("accepts every assurance and session status", () => {
    for (const assurance of ["local", "single_factor", "multi_factor"]) {
      for (const status of ["active", "revoked", "expired"]) {
        expect(isSession({ ...session, assurance, status })).toBe(true);
      }
    }
  });

  it("accepts nullable and populated revocation metadata", () => {
    expect(isSession(session)).toBe(true);

    const revoked = {
      ...session,
      status: "revoked",
      revoked_at: timestamp,
      revoked_by: "actor-2",
      revoke_reason: "Owner revoked session"
    };
    expect(isSession(revoked)).toBe(true);
  });

  it("enforces revoke reason length boundaries", () => {
    const oneCharacter = {
      ...session,
      revoke_reason: "x"
    };
    expect(isSession(oneCharacter)).toBe(true);

    const maxLength = {
      ...session,
      revoke_reason: "x".repeat(256)
    };
    expect(isSession(maxLength)).toBe(true);

    expect(isSession({ ...session, revoke_reason: "" })).toBe(false);
    expect(isSession({ ...session, revoke_reason: "x".repeat(257) })).toBe(false);
  });

  it("rejects malformed session identifiers", () => {
    expect(isSession({ ...session, session_id: "session id" })).toBe(false);
    expect(isSession({ ...session, owner_id: "owner id" })).toBe(false);
    expect(isSession({ ...session, actor_id: "actor id" })).toBe(false);
    expect(isSession({ ...session, revoked_by: "actor id" })).toBe(false);
  });

  it("rejects malformed session timestamps", () => {
    expect(isSession({ ...session, issued_at: "2026-09-22" })).toBe(false);
    expect(isSession({ ...session, expires_at: "2026-09-23" })).toBe(false);
    expect(isSession({ ...session, last_seen_at: "2026-09-22" })).toBe(false);
    expect(isSession({ ...session, revoked_at: "2026-09-22" })).toBe(false);
  });

  it("rejects missing and additional properties", () => {
    const missing: Record<string, unknown> = { ...session };
    delete missing.assurance;
    expect(isSession(missing)).toBe(false);
    expect(isSession({ ...session, unexpected: true })).toBe(false);
  });
});

describe("owner session view boundaries", () => {
  const view = {
    ...session,
    actor_kind: "owner",
    current: true
  } as const;

  it("accepts every actor kind and boolean current value", () => {
    for (const actorKind of ["owner", "system", "agent"]) {
      expect(Value.Check(OwnerSessionViewSchema, { ...view, actor_kind: actorKind })).toBe(true);
    }

    expect(Value.Check(OwnerSessionViewSchema, { ...view, current: true })).toBe(true);
    expect(Value.Check(OwnerSessionViewSchema, { ...view, current: false })).toBe(true);
  });

  it("rejects non-boolean current and unknown actor kind", () => {
    expect(Value.Check(OwnerSessionViewSchema, { ...view, current: 1 })).toBe(false);
    expect(Value.Check(OwnerSessionViewSchema, { ...view, actor_kind: "user" })).toBe(false);
  });

  it("enforces owner session list strict shape", () => {
    expect(Value.Check(OwnerSessionListResponseSchema, { items: [view] })).toBe(true);
    expect(Value.Check(OwnerSessionListResponseSchema, { items: [] })).toBe(true);

    const extra = {
      items: [view],
      unexpected: true
    };
    expect(Value.Check(OwnerSessionListResponseSchema, extra)).toBe(false);
  });
});

describe("revoke session request boundaries", () => {
  it("accepts reason length one through 256", () => {
    expect(Value.Check(RevokeSessionRequestSchema, { reason: "x" })).toBe(true);
    const maxReason = { reason: "x".repeat(256) };
    expect(Value.Check(RevokeSessionRequestSchema, maxReason)).toBe(true);
  });

  it("rejects empty, overlong and extra fields", () => {
    expect(Value.Check(RevokeSessionRequestSchema, { reason: "" })).toBe(false);
    const overlong = { reason: "x".repeat(257) };
    expect(Value.Check(RevokeSessionRequestSchema, overlong)).toBe(false);
    const extra = { reason: "x", unexpected: true };
    expect(Value.Check(RevokeSessionRequestSchema, extra)).toBe(false);
  });
});

describe("identity context boundaries", () => {
  const context = {
    owner_id: "owner-1",
    actor_id: "actor-1",
    actor_kind: "owner",
    session_id: "session-1",
    assurance: "local",
    authenticated_at: timestamp,
    expires_at: "2026-09-23T20:00:00.000Z"
  } as const;

  it("accepts every actor kind and assurance combination", () => {
    for (const actorKind of ["owner", "system", "agent"]) {
      for (const assurance of ["local", "single_factor", "multi_factor"]) {
        const candidate = {
          ...context,
          actor_kind: actorKind,
          assurance
        };
        expect(Value.Check(IdentityContextSchema, candidate)).toBe(true);
      }
    }
  });

  it("rejects malformed ids, timestamps and extras", () => {
    expect(Value.Check(IdentityContextSchema, { ...context, owner_id: "owner id" })).toBe(false);
    const badTime = { ...context, authenticated_at: "2026-09-22" };
    expect(Value.Check(IdentityContextSchema, badTime)).toBe(false);
    expect(Value.Check(IdentityContextSchema, { ...context, unexpected: true })).toBe(false);
  });
});
