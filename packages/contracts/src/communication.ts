import { Type, type Static } from "typebox";

export const CommunicationToneSchema = Type.Union([
  Type.Literal("natural"),
  Type.Literal("warm"),
  Type.Literal("direct"),
  Type.Literal("professional")
]);
export type CommunicationTone = Static<typeof CommunicationToneSchema>;

export const CommunicationVerbositySchema = Type.Union([
  Type.Literal("short"),
  Type.Literal("balanced"),
  Type.Literal("detailed")
]);
export type CommunicationVerbosity = Static<typeof CommunicationVerbositySchema>;

export const CommunicationInitiativeSchema = Type.Union([
  Type.Literal("reactive"),
  Type.Literal("balanced"),
  Type.Literal("proactive")
]);
export type CommunicationInitiative = Static<typeof CommunicationInitiativeSchema>;

export const CommunicationProfileSchema = Type.Object(
  {
    tone: CommunicationToneSchema,
    verbosity: CommunicationVerbositySchema,
    initiative: CommunicationInitiativeSchema,
    natural_guardrail_enabled: Type.Boolean(),
    avoid_canned_framing: Type.Boolean(),
    prefer_concrete_examples: Type.Boolean(),
    preserve_user_register: Type.Boolean()
  },
  { additionalProperties: false }
);
export type CommunicationProfile = Static<typeof CommunicationProfileSchema>;
