import { Type, type Static } from "typebox";
import { CurrencySchema, IsoDateTimeSchema } from "./primitives.js";

export const ModelProtocolSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("openai-compatible"),
  Type.Literal("anthropic-compatible")
]);
export type ModelProtocol = Static<typeof ModelProtocolSchema>;

export const ModelFeatureSchema = Type.Union([
  Type.Literal("streaming"),
  Type.Literal("structured_output"),
  Type.Literal("tool_calling"),
  Type.Literal("vision")
]);
export type ModelFeature = Static<typeof ModelFeatureSchema>;

export const ModelRegistryEntrySchema = Type.Object(
  {
    provider_id: Type.String({ minLength: 1, maxLength: 128 }),
    model_id: Type.String({ minLength: 1, maxLength: 256 }),
    aliases: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1 }),
    protocol: ModelProtocolSchema,
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
    roles: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
    task_types: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
    capabilities: Type.Object(
      {
        streaming: Type.Boolean(),
        structured_output: Type.Boolean(),
        tool_calling: Type.Boolean(),
        vision: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    context_window_tokens: Type.Integer({ minimum: 1 }),
    max_output_tokens: Type.Integer({ minimum: 1 }),
    quality_tier: Type.Integer({ minimum: 1, maximum: 5 }),
    latency_tier: Type.Integer({ minimum: 1, maximum: 5 }),
    pricing: Type.Union([
      Type.Object(
        {
          currency: CurrencySchema,
          input_per_million_tokens: Type.Number({ minimum: 0 }),
          output_per_million_tokens: Type.Number({ minimum: 0 })
        },
        { additionalProperties: false }
      ),
      Type.Null()
    ]),
    privacy: Type.Object(
      {
        confidential_compatible: Type.Boolean(),
        training_usage: Type.Union([
          Type.Literal("none"),
          Type.Literal("opt_out"),
          Type.Literal("unknown")
        ]),
        retention: Type.Union([
          Type.Literal("zero"),
          Type.Literal("limited"),
          Type.Literal("unknown")
        ])
      },
      { additionalProperties: false }
    ),
    source: Type.Object(
      {
        kind: Type.Union([Type.Literal("static"), Type.Literal("authorized_discovery")]),
        verified_at: Type.Union([IsoDateTimeSchema, Type.Null()]),
        valid_until: Type.Union([IsoDateTimeSchema, Type.Null()]),
        reference: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type ModelRegistryEntry = Static<typeof ModelRegistryEntrySchema>;

export const ModelRegistryDocumentSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    registry_version: Type.String({ minLength: 1, maxLength: 64 }),
    generated_at: IsoDateTimeSchema,
    entries: Type.Array(ModelRegistryEntrySchema)
  },
  { additionalProperties: false }
);
export type ModelRegistryDocument = Static<typeof ModelRegistryDocumentSchema>;

export const ModelRouteRequestSchema = Type.Object(
  {
    role: Type.String({ minLength: 1, maxLength: 128 }),
    task_type: Type.String({ minLength: 1, maxLength: 128 }),
    preferred_provider: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    preferred_model_alias: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    required_features: Type.Array(ModelFeatureSchema, { uniqueItems: true }),
    confidential: Type.Boolean(),
    estimated_input_tokens: Type.Integer({ minimum: 0 }),
    max_output_tokens: Type.Integer({ minimum: 1 }),
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
);
export type ModelRouteRequest = Static<typeof ModelRouteRequestSchema>;
