import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  MANAGER_RUNTIME_SCENARIOS,
  ManagerRuntimeReleaseGateResultSchema,
  type ManagerRuntimeScenario,
  type ScenarioAssertion,
  type ScenarioObservation,
  type ScenarioObservationBundle
} from "@cosmora/contracts";
import { runManagerRuntimeReleaseGate } from "../src/index.js";

const evaluatedAt = "2026-08-31T18:00:00.000Z";

const observationForAssertion = (assertion: ScenarioAssertion): ScenarioObservation => {
  switch (assertion.kind) {
    case "policy_verdict":
      return {
        kind: "policy_verdict",
        operation_id: assertion.operation_id,
        actual: assertion.expected
      };
    case "task_state":
      return { kind: "task_state", task_id: assertion.task_id, actual: assertion.expected };
    case "runtime_state":
      return { kind: "runtime_state", actual: assertion.expected };
    case "artifact_visibility":
      return {
        kind: "artifact_visibility",
        artifact_id: assertion.artifact_id,
        visible: assertion.visible
      };
    case "operation_effect_count":
      return {
        kind: "operation_effect_count",
        operation_id: assertion.operation_id,
        actual: assertion.expected
      };
    case "critic_pause":
      return { kind: "critic_pause", actual: assertion.expected };
    case "route_group":
      return { kind: "route_group", actual_group_id: assertion.expected_group_id };
  }
};

const bundleForScenario = (scenario: ManagerRuntimeScenario): ScenarioObservationBundle => ({
  scenario_id: scenario.scenario_id,
  observations: scenario.assertions.map(observationForAssertion)
});

const managerRuntimeBundles = (): ScenarioObservationBundle[] =>
  MANAGER_RUNTIME_SCENARIOS.filter((scenario) =>
    scenario.required_for.includes("manager-runtime-v1")
  ).map(bundleForScenario);

describe("manager runtime release gate", () => {
  it("passes manager-runtime-v1 only when every required scenario passes", () => {
    const result = runManagerRuntimeReleaseGate({
      incrementId: "manager-runtime-v1",
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      observationBundles: managerRuntimeBundles(),
      evaluatedAt
    });

    expect(Value.Check(ManagerRuntimeReleaseGateResultSchema, result)).toBe(true);
    expect(result.status).toBe("PASS");
    expect(result.catalog_issues).toEqual([]);
    expect(result.required_scenario_ids).toHaveLength(result.scenario_results.length);
    expect(result.scenario_results.every((scenario) => scenario.status === "PASS")).toBe(true);
  });

  it("fails when one required scenario has no observations", () => {
    const result = runManagerRuntimeReleaseGate({
      incrementId: "manager-runtime-v1",
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      observationBundles: managerRuntimeBundles().filter(
        (bundle) => bundle.scenario_id !== "runtime-emergency-stop-v1"
      ),
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(
      result.scenario_results.find((scenario) => scenario.scenario_id === "runtime-emergency-stop-v1")
        ?.status
    ).toBe("FAIL");
  });

  it("fails closed on an unknown observation bundle", () => {
    const result = runManagerRuntimeReleaseGate({
      incrementId: "manager-runtime-v1",
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      observationBundles: [
        ...managerRuntimeBundles(),
        { scenario_id: "runtime-unknown-v1", observations: [] }
      ],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.catalog_issues).toContain(
      "Unknown runtime scenario observation bundle: runtime-unknown-v1"
    );
  });

  it("fails closed on duplicate bundles for one scenario", () => {
    const bundles = managerRuntimeBundles();
    const duplicate = bundles.find((bundle) => bundle.scenario_id === "runtime-false-critic-v1");
    if (!duplicate) throw new Error("Missing false critic test bundle");

    const result = runManagerRuntimeReleaseGate({
      incrementId: "manager-runtime-v1",
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      observationBundles: [...bundles, duplicate],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.catalog_issues).toContain(
      "Duplicate runtime scenario observation bundle: runtime-false-critic-v1"
    );
  });

  it("fails when an increment has no declared required scenarios", () => {
    const result = runManagerRuntimeReleaseGate({
      incrementId: "unknown-runtime-v1",
      scenarios: MANAGER_RUNTIME_SCENARIOS,
      observationBundles: [],
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.required_scenario_ids).toEqual([]);
    expect(result.catalog_issues).toContain(
      "No required runtime scenarios for increment: unknown-runtime-v1"
    );
  });

  it("fails before release when the mandatory scenario catalog is incomplete", () => {
    const incompleteCatalog = MANAGER_RUNTIME_SCENARIOS.filter(
      (scenario) => scenario.category !== "prompt_injection"
    );
    const result = runManagerRuntimeReleaseGate({
      incrementId: "manager-runtime-v1",
      scenarios: incompleteCatalog,
      observationBundles: incompleteCatalog.map(bundleForScenario),
      evaluatedAt
    });

    expect(result.status).toBe("FAIL");
    expect(result.catalog_issues).toContain("Missing required runtime scenario: prompt_injection");
  });
});
