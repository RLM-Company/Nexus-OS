import { Type, type Static } from "typebox";
import { CapabilityIdSchema } from "./policy.js";
import { CurrencySchema, EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const AgentDefinitionScopeSchema = Type.Union([
  Type.Literal("product"),
  Type.Literal("owner"),
  Type.Literal("project")
]);
export type AgentDefinitionScope = Static<typeof AgentDefinitionScopeSchema>;

export const VersionedAgentReferenceSchema = Type.Object(
  {
    id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type VersionedAgentReference = Static<typeof VersionedAgentReferenceSchema>;

export const AgentFunctionDefinitionSchema = Type.Object(
  {
    function_id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 }),
    scope: AgentDefinitionScopeSchema,
    owner_id: Type.Union([EntityIdSchema, Type.Null()]),
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 2_000 }),
    result_contract: Type.String({ minLength: 1, maxLength: 20_000 }),
    created_by_actor_id: EntityIdSchema,
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AgentFunctionDefinition = Static<typeof AgentFunctionDefinitionSchema>;

export const BehaviorPatternTestStatusSchema = Type.Union([
  Type.Literal("untested"),
  Type.Literal("verified"),
  Type.Literal("restricted"),
  Type.Literal("rejected")
]);
export type BehaviorPatternTestStatus = Static<typeof BehaviorPatternTestStatusSchema>;

export const BehaviorPatternSchema = Type.Object(
  {
    pattern_id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 }),
    scope: AgentDefinitionScopeSchema,
    owner_id: Type.Union([EntityIdSchema, Type.Null()]),
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 2_000 }),
    instructions: Type.String({ minLength: 1, maxLength: 100_000 }),
    allowed_function_ids: Type.Array(EntityIdSchema, {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true
    }),
    known_limitations: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      maxItems: 50
    }),
    test_status: BehaviorPatternTestStatusSchema,
    created_by_actor_id: EntityIdSchema,
    created_at: IsoDateTimeSchema,
    archived_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type BehaviorPattern = Static<typeof BehaviorPatternSchema>;

export const AgentMemoryScopeSchema = Type.Object(
  {
    read_mode: Type.Union([
      Type.Literal("none"),
      Type.Literal("task"),
      Type.Literal("project_segments"),
      Type.Literal("handoff")
    ]),
    source_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    write_back: Type.Union([
      Type.Literal("none"),
      Type.Literal("result_only"),
      Type.Literal("result_and_evidence")
    ])
  },
  { additionalProperties: false }
);
export type AgentMemoryScope = Static<typeof AgentMemoryScopeSchema>;

export const AgentGrantSchema = Type.Object(
  {
    project_id: EntityIdSchema,
    capability_ids: Type.Array(CapabilityIdSchema, {
      maxItems: 19,
      uniqueItems: true
    }),
    tool_ids: Type.Array(EntityIdSchema, { maxItems: 100, uniqueItems: true }),
    data_scope_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    object_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    budget: Type.Object(
      {
        currency: CurrencySchema,
        money_minor: Type.Integer({ minimum: 0 }),
        tokens: Type.Integer({ minimum: 0 }),
        operations: Type.Integer({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    delegation_depth: Type.Integer({ minimum: 0, maximum: 16 }),
    valid_until: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AgentGrant = Static<typeof AgentGrantSchema>;

export const AgentBlueprintSchema = Type.Object(
  {
    blueprint_id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 }),
    owner_id: EntityIdSchema,
    project_id: EntityIdSchema,
    function_ref: VersionedAgentReferenceSchema,
    behavior_pattern_ref: VersionedAgentReferenceSchema,
    model_profile_ref: VersionedAgentReferenceSchema,
    grant: AgentGrantSchema,
    memory_scope: AgentMemoryScopeSchema,
    task_contract: Type.String({ minLength: 1, maxLength: 20_000 }),
    start_condition: Type.String({ minLength: 1, maxLength: 2_000 }),
    close_conditions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      minItems: 1,
      maxItems: 50
    }),
    created_by_actor_id: EntityIdSchema,
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AgentBlueprint = Static<typeof AgentBlueprintSchema>;

export const VersionedInstructionTextSourceSchema = Type.Object(
  {
    source_ref: VersionedAgentReferenceSchema,
    instructions: Type.String({ minLength: 1, maxLength: 100_000 })
  },
  { additionalProperties: false }
);
export type VersionedInstructionTextSource = Static<typeof VersionedInstructionTextSourceSchema>;

export const AgentInstructionPrecedenceSchema = Type.Tuple([
  Type.Literal("constitution"),
  Type.Literal("policy"),
  Type.Literal("function"),
  Type.Literal("behavior"),
  Type.Literal("task")
]);
export type AgentInstructionPrecedence = Static<typeof AgentInstructionPrecedenceSchema>;

export const AgentInstructionPlanSchema = Type.Object(
  {
    plan_version: Type.Literal(1),
    executable: Type.Literal(false),
    blueprint_ref: VersionedAgentReferenceSchema,
    owner_id: EntityIdSchema,
    project_id: EntityIdSchema,
    model_profile_ref: VersionedAgentReferenceSchema,
    precedence: AgentInstructionPrecedenceSchema,
    layers: Type.Object(
      {
        constitution: Type.Object(
          {
            authority: Type.Literal("constitution"),
            source: VersionedInstructionTextSourceSchema
          },
          { additionalProperties: false }
        ),
        policy: Type.Object(
          {
            authority: Type.Literal("policy"),
            source: VersionedInstructionTextSourceSchema
          },
          { additionalProperties: false }
        ),
        function: Type.Object(
          {
            authority: Type.Literal("function"),
            definition: AgentFunctionDefinitionSchema,
            declared_grant: AgentGrantSchema,
            memory_scope: AgentMemoryScopeSchema,
            task_contract: Type.String({ minLength: 1, maxLength: 20_000 }),
            start_condition: Type.String({ minLength: 1, maxLength: 2_000 }),
            close_conditions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
              minItems: 1,
              maxItems: 50
            })
          },
          { additionalProperties: false }
        ),
        behavior: Type.Object(
          {
            authority: Type.Literal("behavior"),
            pattern: BehaviorPatternSchema
          },
          { additionalProperties: false }
        ),
        task: Type.Object(
          {
            authority: Type.Literal("task"),
            task_id: EntityIdSchema,
            instructions: Type.String({ minLength: 1, maxLength: 20_000 })
          },
          { additionalProperties: false }
        )
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type AgentInstructionPlan = Static<typeof AgentInstructionPlanSchema>;

export const AgentInstanceStatusSchema = Type.Union([
  Type.Literal("proposed"),
  Type.Literal("active"),
  Type.Literal("paused"),
  Type.Literal("completed"),
  Type.Literal("replaced"),
  Type.Literal("closed"),
  Type.Literal("failed")
]);
export type AgentInstanceStatus = Static<typeof AgentInstanceStatusSchema>;

export const AgentInstanceSchema = Type.Object(
  {
    instance_id: EntityIdSchema,
    blueprint: AgentBlueprintSchema,
    parent_instance_id: Type.Union([EntityIdSchema, Type.Null()]),
    status: AgentInstanceStatusSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
    closed_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type AgentInstance = Static<typeof AgentInstanceSchema>;

export const AgentFunctionListResponseSchema = Type.Object(
  { items: Type.Array(AgentFunctionDefinitionSchema) },
  { additionalProperties: false }
);
export type AgentFunctionListResponse = Static<typeof AgentFunctionListResponseSchema>;

export const BehaviorPatternListResponseSchema = Type.Object(
  { items: Type.Array(BehaviorPatternSchema) },
  { additionalProperties: false }
);
export type BehaviorPatternListResponse = Static<typeof BehaviorPatternListResponseSchema>;

export const AgentBlueprintListResponseSchema = Type.Object(
  { items: Type.Array(AgentBlueprintSchema) },
  { additionalProperties: false }
);
export type AgentBlueprintListResponse = Static<typeof AgentBlueprintListResponseSchema>;

export const AgentInstanceListResponseSchema = Type.Object(
  { items: Type.Array(AgentInstanceSchema) },
  { additionalProperties: false }
);
export type AgentInstanceListResponse = Static<typeof AgentInstanceListResponseSchema>;

export const AgentHandoffSchema = Type.Object(
  {
    handoff_id: EntityIdSchema,
    project_id: EntityIdSchema,
    from_instance_id: EntityIdSchema,
    to_instance_id: Type.Union([EntityIdSchema, Type.Null()]),
    summary: Type.String({ minLength: 1, maxLength: 20_000 }),
    artifact_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    open_questions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 100
    }),
    known_errors: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AgentHandoff = Static<typeof AgentHandoffSchema>;
