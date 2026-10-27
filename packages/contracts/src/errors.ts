import { Type, type Static } from "typebox";

export const ErrorCodeSchema = Type.Union([
  Type.Literal("VALIDATION_ERROR"),
  Type.Literal("UNAUTHORIZED"),
  Type.Literal("FORBIDDEN"),
  Type.Literal("IDENTITY_SESSION_NOT_FOUND"),
  Type.Literal("IDENTITY_ACTOR_NOT_FOUND"),
  Type.Literal("PROJECT_NOT_FOUND"),
  Type.Literal("AGENT_STUDIO_OBJECT_NOT_FOUND"),
  Type.Literal("AUTONOMY_PROFILE_CONFLICT"),
  Type.Literal("USAGE_LIMIT_CONFLICT"),
  Type.Literal("CONFIRMATION_NOT_FOUND"),
  Type.Literal("CONFIRMATION_EXPIRED"),
  Type.Literal("CONFIRMATION_ALREADY_DECIDED"),
  Type.Literal("STEP_UP_REQUIRED"),
  Type.Literal("POLICY_DENIED"),
  Type.Literal("POLICY_PAUSED"),
  Type.Literal("CHAT_NOT_FOUND"),
  Type.Literal("RUN_NOT_FOUND"),
  Type.Literal("IDEMPOTENCY_CONFLICT"),
  Type.Literal("ROUTE_NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("RUN_ALREADY_FINISHED"),
  Type.Literal("PROVIDER_TIMEOUT"),
  Type.Literal("PROVIDER_ERROR"),
  Type.Literal("CONTEXT_TOO_LARGE"),
  Type.Literal("EMERGENCY_STOP"),
  Type.Literal("EMERGENCY_STOP_CONFLICT"),
  Type.Literal("ENVIRONMENT_EMERGENCY_STOP_LOCKED"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("INTERNAL_ERROR")
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

export const ApiErrorSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: ErrorCodeSchema,
        message: Type.String(),
        request_id: Type.String({ minLength: 1 }),
        retryable: Type.Boolean()
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type ApiError = Static<typeof ApiErrorSchema>;
