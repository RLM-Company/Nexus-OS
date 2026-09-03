import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const StepUpPurposeSchema = Type.Union([
  Type.Literal("autonomy_profile_escalation"),
  Type.Literal("critical_tool_confirmation"),
  Type.Literal("emergency_stop_clearance"),
  Type.Literal("project_usage_limit_expansion")
]);
export type StepUpPurpose = Static<typeof StepUpPurposeSchema>;

export const StepUpProofStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("consumed"),
  Type.Literal("expired")
]);
export type StepUpProofStatus = Static<typeof StepUpProofStatusSchema>;

export const StepUpProofSchema = Type.Object(
  {
    proof_id: EntityIdSchema,
    owner_id: EntityIdSchema,
    actor_id: EntityIdSchema,
    session_id: EntityIdSchema,
    purpose: StepUpPurposeSchema,
    challenge_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    status: StepUpProofStatusSchema,
    issued_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema,
    consumed_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type StepUpProof = Static<typeof StepUpProofSchema>;
