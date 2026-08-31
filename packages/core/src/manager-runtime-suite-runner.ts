import {
  validateManagerRuntimeScenarioCatalog,
  type ManagerRuntimeScenario,
  type ManagerRuntimeSuiteGateResult,
  type ScenarioObservationSet
} from "@cosmora/contracts";
import { runManagerRuntimeScenario } from "./manager-runtime-scenario-runner.js";

export const runManagerRuntimeScenarioSuite = (input: {
  scenarios: readonly ManagerRuntimeScenario[];
  targetIncrement: string;
  observationSets: readonly ScenarioObservationSet[];
  evaluatedAt: string;
}): ManagerRuntimeSuiteGateResult => {
  const catalogIssues = [...validateManagerRuntimeScenarioCatalog(input.scenarios)];
  const requiredScenarios = input.scenarios.filter((scenario) =>
    scenario.required_for.includes(input.targetIncrement)
  );

  if (requiredScenarios.length === 0) {
    catalogIssues.push(
      `No runtime scenarios are registered for increment ${input.targetIncrement}`
    );
  }

  const setsByScenarioId = new Map<string, ScenarioObservationSet[]>();
  for (const observationSet of input.observationSets) {
    const current = setsByScenarioId.get(observationSet.scenario_id) ?? [];
    current.push(observationSet);
    setsByScenarioId.set(observationSet.scenario_id, current);
  }

  const requiredScenarioIds = requiredScenarios.map((scenario) => scenario.scenario_id);
  const requiredSet = new Set(requiredScenarioIds);
  const duplicateObservationSetIds = [...setsByScenarioId.entries()]
    .filter(([, sets]) => sets.length > 1)
    .map(([scenarioId]) => scenarioId)
    .sort();
  const missingScenarioIds = requiredScenarioIds
    .filter((scenarioId) => (setsByScenarioId.get(scenarioId)?.length ?? 0) !== 1)
    .sort();
  const unusedObservationSetIds = [...setsByScenarioId.keys()]
    .filter((scenarioId) => !requiredSet.has(scenarioId))
    .sort();

  const results = requiredScenarios.flatMap((scenario) => {
    const sets = setsByScenarioId.get(scenario.scenario_id) ?? [];
    if (sets.length !== 1) return [];
    const observationSet = sets[0];
    if (observationSet === undefined) return [];
    return [
      runManagerRuntimeScenario({
        scenario,
        observations: observationSet.observations,
        evaluatedAt: input.evaluatedAt
      })
    ];
  });

  const status =
    catalogIssues.length === 0 &&
    missingScenarioIds.length === 0 &&
    duplicateObservationSetIds.length === 0 &&
    results.length === requiredScenarios.length &&
    results.every((result) => result.status === "PASS")
      ? "PASS"
      : "FAIL";

  return {
    target_increment: input.targetIncrement,
    status,
    catalog_issues: [...new Set(catalogIssues)],
    required_scenario_ids: requiredScenarioIds,
    missing_scenario_ids: missingScenarioIds,
    duplicate_observation_set_ids: duplicateObservationSetIds,
    unused_observation_set_ids: unusedObservationSetIds,
    results,
    evaluated_at: input.evaluatedAt
  };
};
