import { Type, type Static } from "typebox";

export const ErrorCodeSchema = Type.Union([
  Type.Literal("VALIDATION_ERROR"),
  Type.Literal("UNAUTHORIZED"),
  Type.Literal("FORBIDDEN"),
  Type.Literal("PROJECT_NOT_FOUND"),
  Type.Literal("CHAT_NOT_FOUND"),
  Type.Literal("RUN_NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("RUN_ALREADY_FINISHED"),
  Type.Literal("PROVIDER_TIMEOUT"),
  Type.Literal("PROVIDER_ERROR"),
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
