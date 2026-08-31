import { describe, expect, it } from "vitest";
import {
  MANAGER_RUNTIME_SCENARIOS,
  type ScenarioObservationSet
} from "@cosmora/contracts";
import { runManagerRuntimeScenarioSuite } from "../src/index.js";

const evaluatedAt = "2026-08-31T18:30:00.000Z";

const passingCriticObservationSets = (): ScenarioObservationSet[] => [
  {
    scenario_id: "runtime-critic-serious-v1",
    observations: [{ kind: "critic_pause", actual: "task" }]
  },
  {
    scenario_id: "runtime-false-critic-v1",
    observations: [
      { kind: "critic_pause", actual: "none" },
      { kind: "task_state", task_id: "reviewed-task", actual: "completed" }
    ]
  }
];

describe("manager runtime scenario suite runner", () => {
  it("passes only when every required scenario for the increment passes", () => {
    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "critic-runtime-v1",
      observationSets: passingCriticObservationSets(),
      evaluatedAt
    });

    expect(result.status).toBe("PASS");
    expect(result.catalog_issues).toEqual([]);
    expect(result.missing_scenario_ids).toEqual([]);
    expect(result.duplicate_observation_set_ids).toEqual([]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((scenarioResult) => scenarioResult.status === "PASS")).toBe(true);
  });

  it("fails closed when a required scenario bundle is missing", () => {
    const [onlySerious] = passingCriticObservationSets();
    if (onlySerious === undefined) throw new Error("Missing critic fixture");

    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "critic-runtime-v1",
      observationSets: [onlySerious],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.missing_scenario_ids).toContain("runtime-false-critic-v1");
  });

  it("fails closed on duplicated observation sets for one required scenario", () => {
    const sets = passingCriticObservationSets();
    const serious = sets[0];
    if (serious === undefined) throw new Error("Missing critic fixture");

    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "critic-runtime-v1",
      observationSets: [...sets, serious],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.duplicate_observation_set_ids).toContain("runtime-critic-serious-v1");
    expect(result.missing_scenario_ids).toContain("runtime-critic-serious-v1");
  });

  it("fails when the canonical scenario catalog itself is incomplete", () => {
    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS.filter(
        (scenario) => scenario.category !== "cross_project_leak"
      ),
      targetIncrement: "critic-runtime-v1",
      observationSets: passingCriticObservationSets(),
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.catalog_issues).toContain("Missing required runtime scenario: cross_project_leak");
  });

  it("propagates a failing nested scenario into the aggregate verdict", () => {
    const sets = passingCriticObservationSets();
    sets[0] = {
      scenario_id: "runtime-critic-serious-v1",
      observations: [{ kind: "critic_pause", actual: "none" }]
    };

    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "critic-runtime-v1",
      observationSets: sets,
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(
      result.results.find((scenarioResult) => scenarioResult.scenario_id === "runtime-critic-serious-v1")
    ).toMatchObject({ status: "FAIL" });
  });

  it("records unrelated bundles without letting them satisfy or fail required scenarios", () => {
    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "critic-runtime-v1",
      observationSets: [
        ...passingCriticObservationSets(),
        {
          scenario_id: "runtime-autonomy-a0-v1",
          observations: [{ kind: "policy_verdict", operation_id: "a0-web-read", actual: "DENY" }]
        }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("PASS");
    expect(result.unused_observation_set_ids).toEqual(["runtime-autonomy-a0-v1"]);
  });

  it("fails closed when the target increment has no registered scenarios", () => {
    const result = runManagerRuntimeScenarioSuite({
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      targetIncrement: "unknown-runtime-v1",
      observationSets: [],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.catalog_issues).toContain(
      "No runtime scenarios are registered for increment unknown-runtime-v1"
    );
  });
});
