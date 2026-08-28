import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  IdentityAuditListResponseSchema,
  IdentityContextSchema,
  IdentitySessionSchema,
  OwnerSessionViewSchema
} from "../src/index.js";

describe("identity contracts", () => {
  it("accepts a provider-neutral verified identity context", () => {
    expect(
      Value.Check(IdentityContextSchema, {
        owner_id: "owner-1",
        actor_id: "owner-actor-1",
        actor_kind: "owner",
        session_id: "session-1",
        assurance: "multi_factor",
        authenticated_at: "2026-08-27T12:00:00.000Z",
        expires_at: "2026-08-27T13:00:00.000Z"
      })
    ).toBe(true);
  });

  it("bounds the public identity audit response", () => {
    const event = {
      event_id: "event-1",
      owner_id: "owner-1",
      actor_id: "owner-actor-1",
      session_id: "session-1",
      event_type: "session.issued",
      outcome: "success",
      reason_code: null,
      created_at: "2026-08-27T12:00:00.000Z"
    };

    expect(Value.Check(IdentityAuditListResponseSchema, { items: [event], limit: 50 })).toBe(true);
    expect(Value.Check(IdentityAuditListResponseSchema, { items: [event], limit: 101 })).toBe(
      false
    );
    expect(
      Value.Check(IdentityAuditListResponseSchema, {
        items: [{ ...event, token: "secret" }],
        limit: 50
      })
    ).toBe(false);
  });

  it("never includes a raw token in the public session contract", () => {
    const session = {
      session_id: "session-1",
      owner_id: "owner-1",
      actor_id: "owner-actor-1",
      assurance: "single_factor",
      status: "active",
      issued_at: "2026-08-27T12:00:00.000Z",
      expires_at: "2026-08-27T13:00:00.000Z",
      last_seen_at: "2026-08-27T12:00:00.000Z",
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null
    };

    expect(Value.Check(IdentitySessionSchema, session)).toBe(true);
    expect(Value.Check(IdentitySessionSchema, { ...session, token: "secret" })).toBe(false);
    expect(
      Value.Check(OwnerSessionViewSchema, {
        ...session,
        actor_kind: "owner",
        current: true
      })
    ).toBe(true);
    expect(
      Value.Check(OwnerSessionViewSchema, {
        ...session,
        actor_kind: "owner",
        current: true,
        token: "secret"
      })
    ).toBe(false);
  });
});
