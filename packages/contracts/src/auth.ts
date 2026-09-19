import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const AuthProviderSchema = Type.Union([Type.Literal("google"), Type.Literal("telegram")]);
export type AuthProvider = Static<typeof AuthProviderSchema>;

export const AuthVerificationStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("verified"),
  Type.Literal("failed"),
  Type.Literal("revoked")
]);
export type AuthVerificationStatus = Static<typeof AuthVerificationStatusSchema>;

export const AuthCodeChallengeMethodSchema = Type.Literal("S256");
export type AuthCodeChallengeMethod = Static<typeof AuthCodeChallengeMethodSchema>;

export const AuthStartRequestSchema = Type.Object(
  {
    provider: AuthProviderSchema,
    state: Type.String({ minLength: 16, maxLength: 256 }),
    nonce: Type.String({ minLength: 16, maxLength: 256 }),
    code_challenge: Type.String({ minLength: 43, maxLength: 128 }),
    code_challenge_method: AuthCodeChallengeMethodSchema
  },
  { additionalProperties: false }
);
export type AuthStartRequest = Static<typeof AuthStartRequestSchema>;

export const AuthCallbackSchema = Type.Object(
  {
    provider: AuthProviderSchema,
    code: Type.String({ minLength: 1, maxLength: 4096 }),
    state: Type.String({ minLength: 16, maxLength: 256 })
  },
  { additionalProperties: false }
);
export type AuthCallback = Static<typeof AuthCallbackSchema>;

export const ExternalIdentitySchema = Type.Object(
  {
    provider: AuthProviderSchema,
    subject: Type.String({ minLength: 1, maxLength: 256 }),
    verification_status: AuthVerificationStatusSchema,
    email: Type.Union([Type.String({ minLength: 3, maxLength: 320 }), Type.Null()]),
    email_verified: Type.Boolean(),
    phone_verified: Type.Boolean(),
    display_name: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
    linked_at: IsoDateTimeSchema,
    last_verified_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type ExternalIdentity = Static<typeof ExternalIdentitySchema>;

export const AuthSessionBootstrapSchema = Type.Object(
  {
    session_id: EntityIdSchema,
    provider: AuthProviderSchema,
    subject: Type.String({ minLength: 1, maxLength: 256 }),
    assurance: Type.Union([Type.Literal("single_factor"), Type.Literal("multi_factor")]),
    issued_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AuthSessionBootstrap = Static<typeof AuthSessionBootstrapSchema>;
