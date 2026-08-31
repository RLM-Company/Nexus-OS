import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ManagerRuntimeSuiteGateResultSchema,
  ScenarioObservationSetSchema
} from "../src/index.js";

describe("manager runtime suite gate contracts", () => {
  it("accepts bounded observation sets without execution authority", () => {
    const value = {
      scenario_id: "runtime-critic-serious-v1",
      observations: [{ kind: "critic_pause", actual: "task" }]
    };

    expect(Value.Check(ScenarioObservationSetSchema, value)).toBe(true);
    expect(
      Value.Check(ScenarioObservationSetSchema, {
        ...value,
        execute_after_pass: true
      })
    ).toBe(false);
  });

  it("keeps aggregate results machine-readable and reasoning-free", () => {
    const value = {
      target_increment: "critic-runtime-v1",
      status: "PASS",
      catalog_issues: [],
      required_scenario_ids: ["runtime-critic-serious-v1"],
      missing_scenario_ids: [],
      duplicate_observation_set_ids: [],
      unused_observation_set_ids: [],
      results: [
        {
          scenario_id: "runtime-critic-serious-v1",
          status: "PASS",
          checks: [
            {
              assertion_index: 0,
              assertion_key: "critic_pause",
              kind: "critic_pause",
              status: "PASS",
              expected: "task",
              actual: "task",
              reason: null
            }
          ],
          evaluated_at: "2026-08-31T18:30:00.000Z"
        }
      ],
      evaluated_at: "2026-08-31T18:30:00.000Z"
    };

    expect(Value.Check(ManagerRuntimeSuiteGateResultSchema, value)).toBe(true);
    expect(
      Value.Check(ManagerRuntimeSuiteGateResultSchema, {
        ...value,
        chain_of_thought: "why the release should pass"
      })
    ).toBe(false);
  });
});
