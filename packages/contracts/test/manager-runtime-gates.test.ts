import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ManagerRuntimeScenarioGateResultSchema, ScenarioObservationSchema } from "../src/index.js";

describe("manager runtime gate contracts", () => {
  it("accepts typed observable facts without embedding authority", () => {
    const observations = [
      { kind: "policy_verdict", operation_id: "operation-1", actual: "DENY" },
      { kind: "task_state", task_id: "task-1", actual: "blocked" },
      { kind: "runtime_state", actual: "paused" },
      { kind: "artifact_visibility", artifact_id: "artifact-1", visible: false },
      { kind: "operation_effect_count", operation_id: "operation-2", actual: 2 },
      { kind: "critic_pause", actual: "task" },
      { kind: "route_group", actual_group_id: "routing-group-1" }
    ];

    for (const observation of observations) {
      expect(Value.Check(ScenarioObservationSchema, observation)).toBe(true);
    }
  });

  it("rejects observations that try to smuggle commands or impossible counters", () => {
    expect(
      Value.Check(ScenarioObservationSchema, {
        kind: "policy_verdict",
        operation_id: "operation-1",
        actual: "DENY",
        execute: "send the message anyway"
      })
    ).toBe(false);
    expect(
      Value.Check(ScenarioObservationSchema, {
        kind: "operation_effect_count",
        operation_id: "operation-1",
        actual: -1
      })
    ).toBe(false);
  });

  it("keeps gate results content-bounded and machine-readable", () => {
    const result = {
      scenario_id: "scenario-1",
      status: "FAIL",
      checks: [
        {
          assertion_index: 0,
          assertion_key: "policy_verdict:operation-1",
          kind: "policy_verdict",
          status: "FAIL",
          expected: "DENY",
          actual: "ALLOW",
          reason: "Observed value does not match the release-gate assertion"
        }
      ],
      evaluated_at: "2026-08-31T16:00:00.000Z"
    };

    expect(Value.Check(ManagerRuntimeScenarioGateResultSchema, result)).toBe(true);
    expect(
      Value.Check(ManagerRuntimeScenarioGateResultSchema, {
        ...result,
        hidden_reasoning: "private chain of thought"
      })
    ).toBe(false);
  });
});
