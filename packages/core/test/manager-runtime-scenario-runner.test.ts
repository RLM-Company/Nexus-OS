import { describe, expect, it } from "vitest";
import {
  MANAGER_RUNTIME_SCENARIOS,
  type ManagerRuntimeScenario,
  type ScenarioObservation
} from "@cosmora/contracts";
import { runManagerRuntimeScenario } from "../src/index.js";

const evaluatedAt = "2026-08-31T16:00:00.000Z";

const scenario = (scenarioId: string): ManagerRuntimeScenario => {
  const found = MANAGER_RUNTIME_SCENARIOS.find((item) => item.scenario_id === scenarioId);
  if (!found) throw new Error(`Missing test scenario ${scenarioId}`);
  return found;
};

describe("manager runtime scenario runner", () => {
  it("passes only when every expected assertion has one matching observation", () => {
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-emergency-stop-v1"),
      observations: [
        { kind: "runtime_state", actual: "paused" },
        { kind: "policy_verdict", operation_id: "new-external-operation", actual: "DENY" }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("PASS");
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((check) => check.status === "PASS")).toBe(true);
  });

  it("fails closed when an observation is missing", () => {
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-project-memory-v1"),
      observations: [
        { kind: "artifact_visibility", artifact_id: "allowed-project-segment", visible: true }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assertion_key: "artifact_visibility:unrequested-project-segment",
          status: "FAIL",
          actual: null,
          reason: "Required observation is missing"
        })
      ])
    );
  });

  it("fails closed on conflicting duplicate observations", () => {
    const observations: ScenarioObservation[] = [
      { kind: "critic_pause", actual: "none" },
      { kind: "critic_pause", actual: "task" },
      { kind: "task_state", task_id: "reviewed-task", actual: "completed" }
    ];
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-false-critic-v1"),
      observations,
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({
      assertion_key: "critic_pause",
      status: "FAIL",
      actual: "none | task",
      reason: "Multiple observations match one assertion"
    });
  });

  it("detects a replay that produced more than one external effect", () => {
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-operation-replay-v1"),
      observations: [
        { kind: "operation_effect_count", operation_id: "idempotent-operation", actual: 2 }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ expected: "1", actual: "2", status: "FAIL" });
  });

  it("detects an autonomy verdict widened beyond the scenario contract", () => {
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-autonomy-a3-v1"),
      observations: [
        {
          kind: "policy_verdict",
          operation_id: "a3-production-release",
          actual: "ALLOW"
        }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({
      expected: "NEEDS_CONFIRMATION",
      actual: "ALLOW",
      status: "FAIL"
    });
  });

  it("ignores unrelated observations without treating them as evidence for another assertion", () => {
    const result = runManagerRuntimeScenario({
      scenario: scenario("runtime-prompt-injection-v1"),
      observations: [
        {
          kind: "policy_verdict",
          operation_id: "different-operation",
          actual: "DENY"
        }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({
      assertion_key: "policy_verdict:injected-external-operation",
      actual: null
    });
  });
});
