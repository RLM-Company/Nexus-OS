import {
  validateManagerRuntimeScenarioCatalog,
  type ManagerRuntimeReleaseGateResult,
  type ManagerRuntimeScenario,
  type ScenarioObservationBundle
} from "@cosmora/contracts";
import { runManagerRuntimeScenario } from "./manager-runtime-scenario-runner.js";

export const runManagerRuntimeReleaseGate = (input: {
  incrementId: string;
  scenarios: readonly ManagerRuntimeScenario[];
  observationBundles: readonly ScenarioObservationBundle[];
  evaluatedAt: string;
}): ManagerRuntimeReleaseGateResult => {
  const catalogIssues = [...validateManagerRuntimeScenarioCatalog(input.scenarios)];
  const catalogScenarioIds = new Set(input.scenarios.map((scenario) => scenario.scenario_id));
  const bundlesByScenario = new Map<string, ScenarioObservationBundle[]>();

  for (const bundle of input.observationBundles) {
    if (!catalogScenarioIds.has(bundle.scenario_id)) {
      catalogIssues.push(`Unknown runtime scenario observation bundle: ${bundle.scenario_id}`);
    }
    const current = bundlesByScenario.get(bundle.scenario_id) ?? [];
    current.push(bundle);
    bundlesByScenario.set(bundle.scenario_id, current);
  }

  for (const [scenarioId, bundles] of bundlesByScenario) {
    if (bundles.length > 1) {
      catalogIssues.push(`Duplicate runtime scenario observation bundle: ${scenarioId}`);
    }
  }

  const requiredScenarios = input.scenarios.filter((scenario) =>
    scenario.required_for.includes(input.incrementId)
  );

  if (requiredScenarios.length === 0) {
    catalogIssues.push(`No required runtime scenarios for increment: ${input.incrementId}`);
  }

  const scenarioResults = requiredScenarios.map((scenario) => {
    const observations = (bundlesByScenario.get(scenario.scenario_id) ?? []).flatMap(
      (bundle) => bundle.observations
    );
    return runManagerRuntimeScenario({
      scenario,
      observations,
      evaluatedAt: input.evaluatedAt
    });
  });

  const uniqueCatalogIssues = [...new Set(catalogIssues)];
  const requiredScenarioIds = [...new Set(requiredScenarios.map((scenario) => scenario.scenario_id))];
  const passed =
    uniqueCatalogIssues.length === 0 &&
    scenarioResults.length > 0 &&
    scenarioResults.every((result) => result.status === "PASS");

  return {
    increment_id: input.incrementId,
    status: passed ? "PASS" : "FAIL",
    required_scenario_ids: requiredScenarioIds,
    scenario_results: scenarioResults,
    catalog_issues: uniqueCatalogIssues,
    evaluated_at: input.evaluatedAt
  };
};
