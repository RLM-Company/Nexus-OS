import { Type, type Static } from "typebox";
import {
  CriticPauseScopeSchema,
  RuntimeRecoveryStateSchema,
  RuntimeTaskStatusSchema
} from "./manager-runtime.js";
import { PolicyVerdictKindSchema } from "./policy.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ScenarioObservationSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("policy_verdict"),
      operation_id: EntityIdSchema,
      actual: PolicyVerdictKindSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("task_state"),
      task_id: EntityIdSchema,
      actual: RuntimeTaskStatusSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("runtime_state"),
      actual: RuntimeRecoveryStateSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("artifact_visibility"),
      artifact_id: EntityIdSchema,
      visible: Type.Boolean()
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("operation_effect_count"),
      operation_id: EntityIdSchema,
      actual: Type.Integer({ minimum: 0 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("critic_pause"),
      actual: CriticPauseScopeSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("route_group"),
      actual_group_id: EntityIdSchema
    },
    { additionalProperties: false }
  )
]);
export type ScenarioObservation = Static<typeof ScenarioObservationSchema>;

export const ScenarioGateStatusSchema = Type.Union([Type.Literal("PASS"), Type.Literal("FAIL")]);
export type ScenarioGateStatus = Static<typeof ScenarioGateStatusSchema>;

export const ScenarioAssertionCheckSchema = Type.Object(
  {
    assertion_index: Type.Integer({ minimum: 0 }),
    assertion_key: Type.String({ minLength: 1, maxLength: 512 }),
    kind: Type.String({ minLength: 1, maxLength: 64 }),
    status: ScenarioGateStatusSchema,
    expected: Type.String({ minLength: 1, maxLength: 10_000 }),
    actual: Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()]),
    reason: Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type ScenarioAssertionCheck = Static<typeof ScenarioAssertionCheckSchema>;

export const ManagerRuntimeScenarioGateResultSchema = Type.Object(
  {
    scenario_id: EntityIdSchema,
    status: ScenarioGateStatusSchema,
    checks: Type.Array(ScenarioAssertionCheckSchema, { minItems: 1, maxItems: 100 }),
    evaluated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ManagerRuntimeScenarioGateResult = Static<
  typeof ManagerRuntimeScenarioGateResultSchema
>;
