import { Type, type Static } from "typebox";
import {
  ManagerRuntimeScenarioGateResultSchema,
  ScenarioObservationSchema
} from "./manager-runtime-gates.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ScenarioObservationSetSchema = Type.Object(
  {
    scenario_id: EntityIdSchema,
    observations: Type.Array(ScenarioObservationSchema, { maxItems: 1_000 })
  },
  { additionalProperties: false }
);
export type ScenarioObservationSet = Static<typeof ScenarioObservationSetSchema>;

export const ManagerRuntimeSuiteGateResultSchema = Type.Object(
  {
    target_increment: Type.String({ minLength: 1, maxLength: 120 }),
    status: Type.Union([Type.Literal("PASS"), Type.Literal("FAIL")]),
    catalog_issues: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 10_000
    }),
    required_scenario_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    missing_scenario_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    duplicate_observation_set_ids: Type.Array(EntityIdSchema, {
      maxItems: 10_000,
      uniqueItems: true
    }),
    unused_observation_set_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    results: Type.Array(ManagerRuntimeScenarioGateResultSchema, { maxItems: 10_000 }),
    evaluated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ManagerRuntimeSuiteGateResult = Static<typeof ManagerRuntimeSuiteGateResultSchema>;
