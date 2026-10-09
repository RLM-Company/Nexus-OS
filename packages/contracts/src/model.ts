import { Type, type Static } from "typebox";
import { ModelFeatureSchema } from "./model-registry.js";
import { CurrencySchema, EntityIdSchema } from "./primitives.js";

/** Provider-native structured tool transcript; execution remains a separate policy decision. */
export const ModelToolCallSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }),
    type: Type.Literal("function"),
    function: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
        arguments: Type.String({ minLength: 2, maxLength: 65_536 })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type ModelToolCall = Static<typeof ModelToolCallSchema>;

export const ModelToolDefinitionSchema = Type.Object(
  {
    type: Type.Literal("function"),
    function: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
        description: Type.Optional(Type.String({ maxLength: 2_000 })),
        parameters: Type.Record(Type.String(), Type.Unknown())
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type ModelToolDefinition = Static<typeof ModelToolDefinitionSchema>;

export const ModelMessageSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("system"),
      Type.Literal("user"),
      Type.Literal("assistant"),
      Type.Literal("tool")
    ]),
    content: Type.String(),
    tool_calls: Type.Optional(Type.Array(ModelToolCallSchema, { minItems: 1, maxItems: 16 })),
    tool_call_id: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" })
    ),
    images: Type.Optional(
      Type.Array(
        Type.Object(
          {
            media_type: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
            data_base64: Type.String({ minLength: 1, maxLength: 1_333_336 })
          },
          { additionalProperties: false }
        ),
        { maxItems: 2 }
      )
    )
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
    role: Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\s]+$" }),
    task_type: Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\s]+$" }),
    messages: Type.Array(ModelMessageSchema, { minItems: 1 }),
    tools: Type.Optional(Type.Array(ModelToolDefinitionSchema, { minItems: 1, maxItems: 16 })),
    constraints: Type.Object(
      {
        timeout_ms: Type.Integer({ minimum: 1, maximum: 600_000 }),
        max_output_tokens: Type.Integer({ minimum: 1, maximum: 100_000 })
      },
      { additionalProperties: false }
    ),
    routing: Type.Object(
      {
        preferred_provider: Type.String({
          minLength: 1,
          maxLength: 128,
          pattern: "^[^\\s]+$"
        }),
        preferred_model_alias: Type.String({
          minLength: 1,
          maxLength: 256,
          pattern: "^[^\\s]+$"
        }),
        fallback_allowed: Type.Boolean(),
        required_features: Type.Array(ModelFeatureSchema, { uniqueItems: true }),
        confidential: Type.Boolean(),
        estimated_input_tokens: Type.Integer({ minimum: 0 }),
        max_cost: Type.Union([
          Type.Object(
            { amount: Type.Number({ minimum: 0 }), currency: CurrencySchema },
            { additionalProperties: false }
          ),
          Type.Null()
        ]),
        optimize_for: Type.Union([
          Type.Literal("balanced"),
          Type.Literal("quality"),
          Type.Literal("latency"),
          Type.Literal("cost")
        ])
      },
      { additionalProperties: false }
    ),
    idempotency_key: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern: "^[^\\s]+$"
    })
  },
  { additionalProperties: false }
);
export type ModelRequest = Static<typeof ModelRequestSchema>;

export const ModelResponseSchema = Type.Object(
  {
    request_id: EntityIdSchema,
    status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
    provider: Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\s]+$" }),
    model_requested: Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\s]+$" }),
    model_resolved: Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\s]+$" }),
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
    finish_reason: Type.String({ minLength: 1, maxLength: 128 }),
    warnings: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 50 })
  },
  { additionalProperties: false }
);
export type ModelResponse = Static<typeof ModelResponseSchema>;
