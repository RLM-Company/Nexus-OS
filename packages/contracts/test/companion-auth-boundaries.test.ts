import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AuthCallbackSchema,
  AuthCodeChallengeMethodSchema,
  AuthProviderSchema,
  AuthSessionBootstrapSchema,
  AuthStartRequestSchema,
  AuthVerificationStatusSchema,
  CompanionFrequencySchema,
  CompanionGateDecisionSchema,
  CompanionGateReasonSchema,
  CompanionMessageProposalSchema,
  CompanionPreferencesSchema,
  CompanionQuietHoursSchema,
  CompanionSurfaceSchema,
  CompanionTriggerSchema,
  EntityIdSchema,
  ExternalIdentitySchema,
  IsoDateTimeSchema,
  TimeOfDaySchema
} from "../src/index.js";

const validQuietHours = {
  start: "22:00",
  end: "08:00",
  timezone: "Europe/Moscow"
};

const validPreferences = {
  enabled: true,
  frequency: "balanced",
  max_proactive_per_day: 3,
  min_gap_minutes: 120,
  quiet_hours: validQuietHours,
  suppress_when_active: true,
  backoff_after_unanswered: 3,
  allow_push: true,
  allow_telegram: false
};

const validProposal = {
  proposal_id: "proposal-1",
  conversation_id: "conversation-1",
  trigger: "follow_up",
  message: "How did it go?",
  preferred_surface: "in_app",
  created_at: "2026-09-19T18:00:00.000Z",
  expires_at: "2026-09-19T20:00:00.000Z"
};

const validGateDecision = {
  proposal_id: "proposal-1",
  decision: "suppress",
  reason: "quiet_hours",
  surface: null,
  decided_at: "2026-09-19T18:00:00.000Z"
};

const validAuthStart = {
  provider: "google",
  state: "s".repeat(16),
  nonce: "n".repeat(16),
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256"
};

const validAuthCallback = {
  provider: "telegram",
  code: "authorization-code",
  state: "s".repeat(16)
};

const validExternalIdentity = {
  provider: "telegram",
  subject: "telegram-user-1",
  verification_status: "verified",
  email: null,
  email_verified: false,
  phone_verified: true,
  display_name: "Cosmora User",
  linked_at: "2026-09-19T18:00:00.000Z",
  last_verified_at: "2026-09-19T18:00:00.000Z"
};

const validSessionBootstrap = {
  session_id: "session-1",
  provider: "google",
  subject: "google-subject-1",
  assurance: "single_factor",
  issued_at: "2026-09-19T18:00:00.000Z",
  expires_at: "2026-09-19T19:00:00.000Z"
};

// prettier-ignore
describe("Live Companion contract boundaries", () => {
  it.each(["rare", "balanced", "often"])("accepts frequency %s", (frequency) => {
    expect(Value.Check(CompanionFrequencySchema, frequency)).toBe(true);
  });

  it("rejects an unknown frequency", () => {
    expect(Value.Check(CompanionFrequencySchema, "constant")).toBe(false);
  });

  it.each(["follow_up", "reminder", "new_context", "idea", "check_in"])(
    "accepts trigger %s",
    (trigger) => {
      expect(Value.Check(CompanionTriggerSchema, trigger)).toBe(true);
    }
  );

  it("rejects an unknown trigger", () => {
    expect(Value.Check(CompanionTriggerSchema, "scheduled_ping")).toBe(false);
  });

  it.each(["in_app", "push", "telegram"])("accepts surface %s", (surface) => {
    expect(Value.Check(CompanionSurfaceSchema, surface)).toBe(true);
  });

  it("rejects an unknown surface", () => {
    expect(Value.Check(CompanionSurfaceSchema, "email")).toBe(false);
  });

  it.each([
    "global_mute",
    "owner_not_authenticated",
    "companion_disabled",
    "scope_not_allowed",
    "quiet_hours",
    "daily_cap",
    "type_cooldown",
    "active_conversation",
    "non_response_backoff",
    "sensitive_context",
    "content_safety"
  ])("accepts gate reason %s", (reason) => {
    expect(Value.Check(CompanionGateReasonSchema, reason)).toBe(true);
  });

  it("rejects an unknown gate reason", () => {
    expect(Value.Check(CompanionGateReasonSchema, "unknown_reason")).toBe(false);
  });

  it.each([
    ["max_proactive_per_day", 0, true],
    ["max_proactive_per_day", 20, true],
    ["max_proactive_per_day", -1, false],
    ["max_proactive_per_day", 21, false],
    ["max_proactive_per_day", 1.5, false],
    ["min_gap_minutes", 0, true],
    ["min_gap_minutes", 1440, true],
    ["min_gap_minutes", -1, false],
    ["min_gap_minutes", 1441, false],
    ["min_gap_minutes", 1.5, false],
    ["backoff_after_unanswered", 0, true],
    ["backoff_after_unanswered", 10, true],
    ["backoff_after_unanswered", -1, false],
    ["backoff_after_unanswered", 11, false]
  ] as const)("checks preference boundary %s=%s", (field, value, expected) => {
    expect(Value.Check(CompanionPreferencesSchema, { ...validPreferences, [field]: value })).toBe(
      expected
    );
  });

  it.each([
    ["minimum", "x", true],
    ["maximum", "x".repeat(64), true],
    ["below minimum", "", false],
    ["above maximum", "x".repeat(65), false]
  ] as const)("checks quiet-hours timezone length: %s", (_label, timezone, expected) => {
    expect(
      Value.Check(CompanionPreferencesSchema, {
        ...validPreferences,
        quiet_hours: { ...validQuietHours, timezone }
      })
    ).toBe(expected);
  });

  it.each(["00:00", "23:59", "12:34"])("accepts valid time %s", (time) => {
    expect(Value.Check(TimeOfDaySchema, time)).toBe(true);
  });

  it.each(["24:00", "12:60", "", "9:00", "09:0", "00:000"])(
    "rejects invalid time %j",
    (time) => {
      expect(Value.Check(TimeOfDaySchema, time)).toBe(false);
    }
  );

  it.each([
    ["minimum", "x", true],
    ["maximum", "x".repeat(4000), true],
    ["empty", "", false],
    ["above maximum", "x".repeat(4001), false]
  ] as const)("checks proposal message length: %s", (_label, message, expected) => {
    expect(
      Value.Check(CompanionMessageProposalSchema, { ...validProposal, message })
    ).toBe(expected);
  });

  it.each(["allow", "suppress"])("accepts gate decision %s", (decision) => {
    expect(Value.Check(CompanionGateDecisionSchema, { ...validGateDecision, decision })).toBe(true);
  });

  it("rejects an unknown gate decision", () => {
    expect(
      Value.Check(CompanionGateDecisionSchema, { ...validGateDecision, decision: "defer" })
    ).toBe(false);
  });

  it.each([
    ["null reason", { decision: "allow", reason: null, surface: "in_app" }],
    ["null surface", { decision: "suppress", reason: "quiet_hours", surface: null }]
  ] as const)("accepts %s where the schema permits it", (_label, overrides) => {
    expect(Value.Check(CompanionGateDecisionSchema, { ...validGateDecision, ...overrides })).toBe(
      true
    );
  });
});

// prettier-ignore
describe("shared primitive boundaries used by Companion and auth", () => {
  it.each([
    ["minimum", "a", true],
    ["maximum", "a".repeat(128), true],
    ["empty", "", false],
    ["space only", " ", false],
    ["embedded whitespace", "entity id", false],
    ["above maximum", "a".repeat(129), false]
  ] as const)("checks entity id boundary: %s", (_label, value, expected) => {
    expect(Value.Check(EntityIdSchema, value)).toBe(expected);
  });

  it.each([
    ["without milliseconds", "2026-09-19T18:00:00Z", true],
    ["with milliseconds", "2026-09-19T18:00:00.000Z", true],
    ["space separator", "2026-09-19 18:00:00Z", false],
    ["offset instead of Z", "2026-09-19T18:00:00+00:00", false],
    ["non-padded date", "2026-9-19T18:00:00Z", false],
    ["empty", "", false]
  ] as const)("checks timestamp shape: %s", (_label, value, expected) => {
    expect(Value.Check(IsoDateTimeSchema, value)).toBe(expected);
  });

  it.each([
    ["proposal_id", "proposal 1"],
    ["conversation_id", ""]
  ] as const)("rejects invalid companion identifier %s", (field, value) => {
    expect(Value.Check(CompanionMessageProposalSchema, { ...validProposal, [field]: value })).toBe(
      false
    );
  });

  it.each([
    [
      "proposal created_at",
      CompanionMessageProposalSchema,
      validProposal,
      "created_at",
      "2026-09-19T18:00:00+00:00"
    ],
    [
      "gate decided_at",
      CompanionGateDecisionSchema,
      validGateDecision,
      "decided_at",
      "2026-09-19 18:00:00Z"
    ]
  ] as const)("rejects malformed timestamp in %s", (_label, schema, value, field, timestamp) => {
    expect(Value.Check(schema, { ...value, [field]: timestamp })).toBe(false);
  });
});

// prettier-ignore
describe("Google/Telegram auth contract boundaries", () => {
  it.each(["google", "telegram"])("accepts provider %s", (provider) => {
    expect(Value.Check(AuthProviderSchema, provider)).toBe(true);
  });

  it("rejects an unknown auth provider", () => {
    expect(Value.Check(AuthProviderSchema, "github")).toBe(false);
  });

  it.each([
    ["minimum", "s".repeat(16), true],
    ["maximum", "s".repeat(256), true],
    ["below minimum", "s".repeat(15), false],
    ["above maximum", "s".repeat(257), false]
  ] as const)("checks state length: %s", (_label, state, expected) => {
    expect(Value.Check(AuthStartRequestSchema, { ...validAuthStart, state })).toBe(expected);
  });

  it.each([
    ["minimum", "n".repeat(16), true],
    ["maximum", "n".repeat(256), true],
    ["below minimum", "n".repeat(15), false],
    ["above maximum", "n".repeat(257), false]
  ] as const)("checks nonce length: %s", (_label, nonce, expected) => {
    expect(Value.Check(AuthStartRequestSchema, { ...validAuthStart, nonce })).toBe(expected);
  });

  it.each([
    ["minimum", "c".repeat(43), true],
    ["maximum", "c".repeat(128), true],
    ["below minimum", "c".repeat(42), false],
    ["above maximum", "c".repeat(129), false]
  ] as const)("checks code_challenge length: %s", (_label, codeChallenge, expected) => {
    expect(
      Value.Check(AuthStartRequestSchema, { ...validAuthStart, code_challenge: codeChallenge })
    ).toBe(expected);
  });

  it.each([
    ["minimum", "c", true],
    ["maximum", "c".repeat(4096), true],
    ["below minimum", "", false],
    ["above maximum", "c".repeat(4097), false]
  ] as const)("checks callback code length: %s", (_label, code, expected) => {
    expect(Value.Check(AuthCallbackSchema, { ...validAuthCallback, code })).toBe(expected);
  });

  it.each([
    ["minimum", "u", true],
    ["maximum", "u".repeat(256), true],
    ["below minimum", "", false],
    ["above maximum", "u".repeat(257), false]
  ] as const)("checks subject length: %s", (_label, subject, expected) => {
    expect(
      Value.Check(ExternalIdentitySchema, { ...validExternalIdentity, subject })
    ).toBe(expected);
  });

  it.each([
    ["S256", true],
    ["plain", false]
  ] as const)("checks code challenge method %s", (method, expected) => {
    expect(Value.Check(AuthCodeChallengeMethodSchema, method)).toBe(expected);
  });

  it.each(["pending", "verified", "failed", "revoked"])(
    "accepts verification status %s",
    (verificationStatus) => {
      expect(Value.Check(AuthVerificationStatusSchema, verificationStatus)).toBe(true);
    }
  );

  it("rejects an unknown verification status", () => {
    expect(Value.Check(AuthVerificationStatusSchema, "expired")).toBe(false);
  });

  it.each(["single_factor", "multi_factor"])("accepts assurance %s", (assurance) => {
    expect(Value.Check(AuthSessionBootstrapSchema, { ...validSessionBootstrap, assurance })).toBe(
      true
    );
  });

  it("rejects an unknown assurance level", () => {
    expect(
      Value.Check(AuthSessionBootstrapSchema, {
        ...validSessionBootstrap,
        assurance: "passwordless"
      })
    ).toBe(false);
  });

  it.each([
    ["embedded whitespace", "session 1"],
    ["empty", ""]
  ] as const)("rejects invalid session entity id: %s", (_label, sessionId) => {
    expect(
      Value.Check(AuthSessionBootstrapSchema, { ...validSessionBootstrap, session_id: sessionId })
    ).toBe(false);
  });

  it.each([
    [
      "identity linked_at",
      ExternalIdentitySchema,
      validExternalIdentity,
      "linked_at",
      "2026-09-19T18:00:00+00:00"
    ],
    [
      "identity last_verified_at",
      ExternalIdentitySchema,
      validExternalIdentity,
      "last_verified_at",
      "2026-09-19 18:00:00Z"
    ],
    [
      "session issued_at",
      AuthSessionBootstrapSchema,
      validSessionBootstrap,
      "issued_at",
      "2026-09-19T18:00Z"
    ],
    ["session expires_at", AuthSessionBootstrapSchema, validSessionBootstrap, "expires_at", ""]
  ] as const)("rejects malformed timestamp in %s", (_label, schema, value, field, timestamp) => {
    expect(Value.Check(schema, { ...value, [field]: timestamp })).toBe(false);
  });

  it("accepts null for nullable identity fields", () => {
    expect(
      Value.Check(ExternalIdentitySchema, {
        ...validExternalIdentity,
        email: null,
        display_name: null,
        last_verified_at: null
      })
    ).toBe(true);
  });
});

// prettier-ignore
describe("strict object shapes", () => {
  it.each([
    ["CompanionQuietHoursSchema", CompanionQuietHoursSchema, validQuietHours],
    ["CompanionPreferencesSchema", CompanionPreferencesSchema, validPreferences],
    ["CompanionMessageProposalSchema", CompanionMessageProposalSchema, validProposal],
    ["CompanionGateDecisionSchema", CompanionGateDecisionSchema, validGateDecision],
    ["AuthStartRequestSchema", AuthStartRequestSchema, validAuthStart],
    ["AuthCallbackSchema", AuthCallbackSchema, validAuthCallback],
    ["ExternalIdentitySchema", ExternalIdentitySchema, validExternalIdentity],
    ["AuthSessionBootstrapSchema", AuthSessionBootstrapSchema, validSessionBootstrap]
  ] as const)("rejects additional fields in %s", (_name, schema, value) => {
    expect(Value.Check(schema, { ...value, unexpected: true })).toBe(false);
  });
});

// prettier-ignore
describe("auth secret-material exclusion", () => {
  it.each([
    ["AuthStartRequestSchema access_token", AuthStartRequestSchema, validAuthStart, "access_token"],
    [
      "AuthStartRequestSchema refresh_token",
      AuthStartRequestSchema,
      validAuthStart,
      "refresh_token"
    ],
    [
      "AuthStartRequestSchema client_secret",
      AuthStartRequestSchema,
      validAuthStart,
      "client_secret"
    ],
    ["AuthStartRequestSchema password", AuthStartRequestSchema, validAuthStart, "password"],
    ["AuthCallbackSchema access_token", AuthCallbackSchema, validAuthCallback, "access_token"],
    ["AuthCallbackSchema refresh_token", AuthCallbackSchema, validAuthCallback, "refresh_token"],
    ["AuthCallbackSchema client_secret", AuthCallbackSchema, validAuthCallback, "client_secret"],
    ["AuthCallbackSchema password", AuthCallbackSchema, validAuthCallback, "password"],
    [
      "ExternalIdentitySchema access_token",
      ExternalIdentitySchema,
      validExternalIdentity,
      "access_token"
    ],
    [
      "ExternalIdentitySchema refresh_token",
      ExternalIdentitySchema,
      validExternalIdentity,
      "refresh_token"
    ],
    [
      "ExternalIdentitySchema client_secret",
      ExternalIdentitySchema,
      validExternalIdentity,
      "client_secret"
    ],
    ["ExternalIdentitySchema password", ExternalIdentitySchema, validExternalIdentity, "password"],
    [
      "AuthSessionBootstrapSchema access_token",
      AuthSessionBootstrapSchema,
      validSessionBootstrap,
      "access_token"
    ],
    [
      "AuthSessionBootstrapSchema refresh_token",
      AuthSessionBootstrapSchema,
      validSessionBootstrap,
      "refresh_token"
    ],
    [
      "AuthSessionBootstrapSchema client_secret",
      AuthSessionBootstrapSchema,
      validSessionBootstrap,
      "client_secret"
    ],
    [
      "AuthSessionBootstrapSchema password",
      AuthSessionBootstrapSchema,
      validSessionBootstrap,
      "password"
    ]
  ] as const)("rejects raw credential field: %s", (_label, schema, value, field) => {
    expect(Value.Check(schema, { ...value, [field]: "raw-secret" })).toBe(false);
  });
});
