import { Type, type Static } from "typebox";

export const ModelRuntimeStatusSchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal("mock"),
      Type.Literal("openai-compatible"),
      Type.Literal("anthropic-compatible")
    ]),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1 }),
    registry_version: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    credential_configured: Type.Boolean(),
    fallback_to_mock: Type.Boolean()
  },
  { additionalProperties: false }
);

export type ModelRuntimeStatus = Static<typeof ModelRuntimeStatusSchema>;
