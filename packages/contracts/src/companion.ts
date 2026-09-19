import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const CompanionFrequencySchema = Type.Union([
  Type.Literal("rare"),
  Type.Literal("balanced"),
  Type.Literal("often")
]);
export type CompanionFrequency = Static<typeof CompanionFrequencySchema>;

export const CompanionTriggerSchema = Type.Union([
  Type.Literal("follow_up"),
  Type.Literal("reminder"),
  Type.Literal("new_context"),
  Type.Literal("idea"),
  Type.Literal("check_in")
]);
export type CompanionTrigger = Static<typeof CompanionTriggerSchema>;

export const CompanionSurfaceSchema = Type.Union([
  Type.Literal("in_app"),
  Type.Literal("push"),
  Type.Literal("telegram")
]);
export type CompanionSurface = Static<typeof CompanionSurfaceSchema>;

export const CompanionGateReasonSchema = Type.Union([
  Type.Literal("global_mute"),
  Type.Literal("owner_not_authenticated"),
  Type.Literal("companion_disabled"),
  Type.Literal("scope_not_allowed"),
  Type.Literal("quiet_hours"),
  Type.Literal("daily_cap"),
  Type.Literal("type_cooldown"),
  Type.Literal("active_conversation"),
  Type.Literal("non_response_backoff"),
  Type.Literal("sensitive_context"),
  Type.Literal("content_safety")
]);
export type CompanionGateReason = Static<typeof CompanionGateReasonSchema>;

export const TimeOfDaySchema = Type.String({
  pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"
});
export type TimeOfDay = Static<typeof TimeOfDaySchema>;

export const CompanionQuietHoursSchema = Type.Object(
  {
    start: TimeOfDaySchema,
    end: TimeOfDaySchema,
    timezone: Type.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
export type CompanionQuietHours = Static<typeof CompanionQuietHoursSchema>;

export const CompanionPreferencesSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    frequency: CompanionFrequencySchema,
    max_proactive_per_day: Type.Integer({ minimum: 0, maximum: 20 }),
    min_gap_minutes: Type.Integer({ minimum: 0, maximum: 1440 }),
    quiet_hours: CompanionQuietHoursSchema,
    suppress_when_active: Type.Boolean(),
    backoff_after_unanswered: Type.Integer({ minimum: 0, maximum: 10 }),
    allow_push: Type.Boolean(),
    allow_telegram: Type.Boolean()
  },
  { additionalProperties: false }
);
export type CompanionPreferences = Static<typeof CompanionPreferencesSchema>;

export const CompanionMessageProposalSchema = Type.Object(
  {
    proposal_id: EntityIdSchema,
    conversation_id: EntityIdSchema,
    trigger: CompanionTriggerSchema,
    message: Type.String({ minLength: 1, maxLength: 4000 }),
    preferred_surface: CompanionSurfaceSchema,
    created_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type CompanionMessageProposal = Static<typeof CompanionMessageProposalSchema>;

export const CompanionGateDecisionSchema = Type.Object(
  {
    proposal_id: EntityIdSchema,
    decision: Type.Union([Type.Literal("allow"), Type.Literal("suppress")]),
    reason: Type.Union([CompanionGateReasonSchema, Type.Null()]),
    surface: Type.Union([CompanionSurfaceSchema, Type.Null()]),
    decided_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type CompanionGateDecision = Static<typeof CompanionGateDecisionSchema>;
