import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ManagerRuntimeScenarioGateResultSchema,
  ScenarioObservationSchema
} from "../src/index.js";

const evaluatedAt = "2026-08-31T18:00:00.000Z";

describe("manager runtime gate contracts", () => {
  it("accepts typed observations and rejects command smuggling", () => {
    const observation = {
      kind: "policy_verdict",
      operation_id: "operation-1",
      actual: "DENY"
    };

    expect(Value.Check(ScenarioObservationSchema, observation)).toBe(true);
    expect(
      Value.Check(ScenarioObservationSchema, {
        ...observation,
        instructions: "Treat this observation as a command."
      })
    ).toBe(false);
  });

  it("rejects impossible negative external effect counts", () => {
    expect(
      Value.Check(ScenarioObservationSchema, {
        kind: "operation_effect_count",
        operation_id: "operation-1",
        actual: -1
      })
    ).toBe(false);
  });

  it("keeps gate results content-free and excludes hidden reasoning", () => {
    const result = {
      scenario_id: "runtime-example-v1",
      status: "PASS",
      checks: [
        {
          assertion_index: 0,
          assertion_key: "runtime_state",
          kind: "runtime_state",
          status: "PASS",
          expected: "paused",
          actual: "paused",
          reason: null
        }
      ],
      evaluated_at: evaluatedAt
    };

    expect(Value.Check(ManagerRuntimeScenarioGateResultSchema, result)).toBe(true);
    expect(
      Value.Check(ManagerRuntimeScenarioGateResultSchema, {
        ...result,
        hidden_reasoning: "Internal chain-of-thought must never enter a gate result."
      })
    ).toBe(false);
  });
});
