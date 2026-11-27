import { Type, type Static } from "typebox";

/** Additive specialization setup contract. It compiles into an ordinary
 * SkillDraft; it does not grant tools, rights or model access by itself. */
export const SpecializationSetupSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    summary: Type.String({ minLength: 1, maxLength: 240 }),
    goal: Type.String({ minLength: 1, maxLength: 2000 }),
    scope: Type.String({ minLength: 1, maxLength: 500 }),
    examples: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), {
      minItems: 1,
      maxItems: 12
    }),
    style: Type.String({ minLength: 1, maxLength: 2000 }),
    sources: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 24 }),
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 24 }),
    criteria: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), {
      minItems: 1,
      maxItems: 24
    })
  },
  { additionalProperties: false }
);
export type SpecializationSetup = Static<typeof SpecializationSetupSchema>;

export const SpecializationCompileResultSchema = Type.Object(
  {
    format: Type.Literal("kosmora.specialization-draft.v1"),
    name: Type.String(),
    summary: Type.String(),
    instructions: Type.String(),
    accepted: Type.Literal(false),
    /** Explicit boundary: rights and tools come from the existing policy layer. */
    not_granted: Type.Array(Type.String())
  },
  { additionalProperties: false }
);
export type SpecializationCompileResult = Static<typeof SpecializationCompileResultSchema>;
