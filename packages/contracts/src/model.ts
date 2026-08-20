import { Type, type Static } from "typebox";
import { CurrencySchema, EntityIdSchema } from "./primitives.js";

export const ModelMessageSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("system"),
      Type.Literal("user"),
      Type.Literal("assistant"),
      Type.Literal("tool")
    ]),
    content: Type.String()
  },
  { additionalProperties: false }
);
export type ModelMessage = Static<typeof ModelMessageSchema>;

export const ModelRequestSchema = Type.Object(
  {
    request_id: EntityIdSchema,
    project_id: EntityIdSchema,
    run_id: EntityIdSchema,
    agent_id: EntityIdSchema,
    role: Type.String({ minLength: 1 }),
    task_type: Type.String({ minLength: 1 }),
    messages: Type.Array(ModelMessageSchema),
    constraints: Type.Object(
      {
        timeout_ms: Type.Integer({ minimum: 1 }),
        max_output_tokens: Type.Integer({ minimum: 1 })
      },
      { additionalProperties: false }
    ),
    routing: Type.Object(
      {
        preferred_provider: Type.String({ minLength: 1 }),
        preferred_model_alias: Type.String({ minLength: 1 }),
        fallback_allowed: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    idempotency_key: Type.String({ minLength: 1, maxLength: 256 })
  },
  { additionalProperties: false }
);
export type ModelRequest = Static<typeof ModelRequestSchema>;

export const ModelResponseSchema = Type.Object(
  {
    request_id: EntityIdSchema,
    status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
    provider: Type.String({ minLength: 1 }),
    model_requested: Type.String({ minLength: 1 }),
    model_resolved: Type.String({ minLength: 1 }),
    content: Type.Array(
      Type.Object(
        {
          type: Type.Literal("text"),
          text: Type.String()
        },
        { additionalProperties: false }
      )
    ),
    usage: Type.Object(
      {
        input_tokens: Type.Integer({ minimum: 0 }),
        output_tokens: Type.Integer({ minimum: 0 }),
        calculated_cost: Type.Number({ minimum: 0 }),
        currency: CurrencySchema
      },
      { additionalProperties: false }
    ),
    timing: Type.Object(
      {
        first_token_ms: Type.Integer({ minimum: 0 }),
        total_ms: Type.Integer({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    finish_reason: Type.String(),
    warnings: Type.Array(Type.String())
  },
  { additionalProperties: false }
);
export type ModelResponse = Static<typeof ModelResponseSchema>;
