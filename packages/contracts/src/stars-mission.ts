import { Type, type Static } from "typebox";
import { EntityIdSchema } from "./primitives.js";

/** Additive Stars mission contract. No existing contract shape is changed. */
const versioned = { expected_version: Type.Integer({ minimum: 0 }) };

export const StarsMissionEventSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("brief"),
      goal: Type.String({ minLength: 1, maxLength: 4000 }),
      author: Type.Optional(EntityIdSchema),
      responsible: Type.Optional(EntityIdSchema),
      input_versions: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 32 })
      ),
      criteria: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 400 }), { maxItems: 16 })
      ),
      acceptance_rules: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 400 }), { maxItems: 16 })
      ),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("clarify"),
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("plan"),
      agents: Type.Array(
        Type.Object({
          id: EntityIdSchema,
          role: Type.Union([
            Type.Literal("manager"),
            Type.Literal("executor"),
            Type.Literal("senior")
          ]),
          task: Type.String({ minLength: 1, maxLength: 2000 }),
          context_scopes: Type.Array(EntityIdSchema, { maxItems: 32 })
        }),
        { minItems: 3, maxItems: 9 }
      ),
      dependencies: Type.Optional(
        Type.Record(Type.String(), Type.Array(EntityIdSchema, { maxItems: 16 }))
      ),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("assign"),
      agent_id: EntityIdSchema,
      task: Type.String({ minLength: 1, maxLength: 2000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("message"),
      from: EntityIdSchema,
      to: EntityIdSchema,
      text: Type.String({ minLength: 1, maxLength: 4000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("result"),
      agent_id: EntityIdSchema,
      summary: Type.String({ minLength: 1, maxLength: 8000 }),
      artifact_ref: Type.Optional(Type.Union([Type.Null(), EntityIdSchema])),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("verify"),
      agent_id: EntityIdSchema,
      verdict: Type.Union([Type.Literal("verified"), Type.Literal("rejected")]),
      verified_by: EntityIdSchema,
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("fail"),
      agent_id: EntityIdSchema,
      reason: Type.String({ minLength: 1, maxLength: 500 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("replace"),
      failed_agent_id: EntityIdSchema,
      replacement_id: EntityIdSchema,
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("handoff"),
      from: EntityIdSchema,
      to: EntityIdSchema,
      task: Type.String({ minLength: 1, maxLength: 2000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("combine"),
      summary: Type.String({ minLength: 1, maxLength: 8000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("conflict"),
      from: EntityIdSchema,
      text: Type.String({ minLength: 1, maxLength: 2000 }),
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("accept"),
      actor: EntityIdSchema,
      ...versioned
    },
    { additionalProperties: false }
  ),
  Type.Object({ type: Type.Literal("pause"), ...versioned }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("resume"), ...versioned }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("cancel"), ...versioned }, { additionalProperties: false })
]);
export type StarsMissionEvent = Static<typeof StarsMissionEventSchema>;

export const CreateStarsMissionSchema = Type.Object(
  {
    client_request_id: EntityIdSchema,
    team_scope: EntityIdSchema,
    goal: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 }))
  },
  { additionalProperties: false }
);
export type CreateStarsMission = Static<typeof CreateStarsMissionSchema>;
