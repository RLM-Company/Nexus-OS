import { validateScenarioCoverage, type ManagerRuntimeScenario } from "./manager-runtime.js";

const EXPECTED_AUTONOMY_LEVELS = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"] as const;

export const validateManagerRuntimeScenarioCatalog = (
  scenarios: readonly ManagerRuntimeScenario[]
): string[] => {
  const issues = [...validateScenarioCoverage(scenarios)];
  const scenarioIds = new Set<string>();

  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.scenario_id)) {
      issues.push(`Duplicate runtime scenario_id: ${scenario.scenario_id}`);
    }
    scenarioIds.add(scenario.scenario_id);
  }

  const autonomyLevels = new Set(
    scenarios
      .filter((scenario) => scenario.category === "autonomy")
      .map((scenario) => scenario.autonomy_level)
  );

  for (const level of EXPECTED_AUTONOMY_LEVELS) {
    if (!autonomyLevels.has(level)) issues.push(`Missing autonomy runtime scenario for ${level}`);
  }

  for (const level of autonomyLevels) {
    if (!(EXPECTED_AUTONOMY_LEVELS as readonly string[]).includes(level)) {
      issues.push(`Unexpected autonomy runtime scenario level: ${level}`);
    }
  }

  return [...new Set(issues)];
};
