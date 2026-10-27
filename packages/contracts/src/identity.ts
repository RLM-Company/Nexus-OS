import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ActorKindSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("system"),
  Type.Literal("agent")
]);
export type ActorKind = Static<typeof ActorKindSchema>;

export const ActorStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("disabled")]);
export type ActorStatus = Static<typeof ActorStatusSchema>;

export const SessionStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("revoked"),
  Type.Literal("expired")
]);
export type SessionStatus = Static<typeof SessionStatusSchema>;

export const AuthenticationAssuranceSchema = Type.Union([
  Type.Literal("local"),
  Type.Literal("single_factor"),
  Type.Literal("multi_factor")
]);
export type AuthenticationAssurance = Static<typeof AuthenticationAssuranceSchema>;

export const IdentityActorSchema = Type.Object(
  {
    actor_id: EntityIdSchema,
    owner_id: EntityIdSchema,
    kind: ActorKindSchema,
    status: ActorStatusSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type IdentityActor = Static<typeof IdentityActorSchema>;

export const IdentitySessionSchema = Type.Object(
  {
    session_id: EntityIdSchema,
    owner_id: EntityIdSchema,
    actor_id: EntityIdSchema,
    assurance: AuthenticationAssuranceSchema,
    status: SessionStatusSchema,
    issued_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema,
    last_seen_at: IsoDateTimeSchema,
    revoked_at: Type.Union([IsoDateTimeSchema, Type.Null()]),
    revoked_by: Type.Union([EntityIdSchema, Type.Null()]),
    revoke_reason: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type IdentitySession = Static<typeof IdentitySessionSchema>;

export const OwnerSessionViewSchema = Type.Object(
  {
    ...IdentitySessionSchema.properties,
    actor_kind: ActorKindSchema,
    current: Type.Boolean()
  },
  { additionalProperties: false }
);
export type OwnerSessionView = Static<typeof OwnerSessionViewSchema>;

export const OwnerSessionListResponseSchema = Type.Object(
  { items: Type.Array(OwnerSessionViewSchema) },
  { additionalProperties: false }
);
export type OwnerSessionListResponse = Static<typeof OwnerSessionListResponseSchema>;

export const RevokeSessionRequestSchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false }
);
export type RevokeSessionRequest = Static<typeof RevokeSessionRequestSchema>;

export const IdentityContextSchema = Type.Object(
  {
    owner_id: EntityIdSchema,
    actor_id: EntityIdSchema,
    actor_kind: ActorKindSchema,
    session_id: EntityIdSchema,
    assurance: AuthenticationAssuranceSchema,
    authenticated_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type IdentityContext = Static<typeof IdentityContextSchema>;

export const IdentityAuditEventSchema = Type.Object(
  {
    event_id: EntityIdSchema,
    owner_id: EntityIdSchema,
    actor_id: EntityIdSchema,
    session_id: Type.Union([EntityIdSchema, Type.Null()]),
    event_type: Type.Union([
      Type.Literal("session.issued"),
      Type.Literal("session.revoked"),
      Type.Literal("session.expired"),
      Type.Literal("login.failed"),
      Type.Literal("actor.disabled"),
      Type.Literal("actor.enabled"),
      Type.Literal("step_up.issued"),
      Type.Literal("step_up.consumed"),
      Type.Literal("step_up.rejected")
    ]),
    outcome: Type.Union([Type.Literal("success"), Type.Literal("denied")]),
    reason_code: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type IdentityAuditEvent = Static<typeof IdentityAuditEventSchema>;

export const IdentityAuditListResponseSchema = Type.Object(
  {
    items: Type.Array(IdentityAuditEventSchema, { maxItems: 100 }),
    limit: Type.Integer({ minimum: 1, maximum: 100 })
  },
  { additionalProperties: false }
);
export type IdentityAuditListResponse = Static<typeof IdentityAuditListResponseSchema>;
