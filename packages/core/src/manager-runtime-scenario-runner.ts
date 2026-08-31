import type {
  ManagerRuntimeScenario,
  ManagerRuntimeScenarioGateResult,
  ScenarioAssertion,
  ScenarioAssertionCheck,
  ScenarioObservation
} from "@cosmora/contracts";

const assertionKey = (assertion: ScenarioAssertion): string => {
  switch (assertion.kind) {
    case "policy_verdict":
      return `policy_verdict:${assertion.operation_id}`;
    case "task_state":
      return `task_state:${assertion.task_id}`;
    case "runtime_state":
      return "runtime_state";
    case "artifact_visibility":
      return `artifact_visibility:${assertion.artifact_id}`;
    case "operation_effect_count":
      return `operation_effect_count:${assertion.operation_id}`;
    case "critic_pause":
      return "critic_pause";
    case "route_group":
      return "route_group";
  }
};

const observationKey = (observation: ScenarioObservation): string => {
  switch (observation.kind) {
    case "policy_verdict":
      return `policy_verdict:${observation.operation_id}`;
    case "task_state":
      return `task_state:${observation.task_id}`;
    case "runtime_state":
      return "runtime_state";
    case "artifact_visibility":
      return `artifact_visibility:${observation.artifact_id}`;
    case "operation_effect_count":
      return `operation_effect_count:${observation.operation_id}`;
    case "critic_pause":
      return "critic_pause";
    case "route_group":
      return "route_group";
  }
};

const expectedSummary = (assertion: ScenarioAssertion): string => {
  switch (assertion.kind) {
    case "policy_verdict":
    case "task_state":
    case "runtime_state":
    case "critic_pause":
      return assertion.expected;
    case "artifact_visibility":
      return String(assertion.visible);
    case "operation_effect_count":
      return String(assertion.expected);
    case "route_group":
      return assertion.expected_group_id;
  }
};

const actualSummary = (observation: ScenarioObservation): string => {
  switch (observation.kind) {
    case "policy_verdict":
    case "task_state":
    case "runtime_state":
    case "operation_effect_count":
    case "critic_pause":
      return String(observation.actual);
    case "artifact_visibility":
      return String(observation.visible);
    case "route_group":
      return observation.actual_group_id;
  }
};

const observationMatches = (
  assertion: ScenarioAssertion,
  observation: ScenarioObservation
): boolean => {
  switch (assertion.kind) {
    case "policy_verdict":
      return observation.kind === "policy_verdict" && observation.actual === assertion.expected;
    case "task_state":
      return observation.kind === "task_state" && observation.actual === assertion.expected;
    case "runtime_state":
      return observation.kind === "runtime_state" && observation.actual === assertion.expected;
    case "artifact_visibility":
      return observation.kind === "artifact_visibility" && observation.visible === assertion.visible;
    case "operation_effect_count":
      return (
        observation.kind === "operation_effect_count" && observation.actual === assertion.expected
      );
    case "critic_pause":
      return observation.kind === "critic_pause" && observation.actual === assertion.expected;
    case "route_group":
      return (
        observation.kind === "route_group" &&
        observation.actual_group_id === assertion.expected_group_id
      );
  }
};

export const runManagerRuntimeScenario = (input: {
  scenario: ManagerRuntimeScenario;
  observations: readonly ScenarioObservation[];
  evaluatedAt: string;
}): ManagerRuntimeScenarioGateResult => {
  const observationsByKey = new Map<string, ScenarioObservation[]>();

  for (const observation of input.observations) {
    const key = observationKey(observation);
    const current = observationsByKey.get(key) ?? [];
    current.push(observation);
    observationsByKey.set(key, current);
  }

  const checks: ScenarioAssertionCheck[] = input.scenario.assertions.map((assertion, index) => {
    const key = assertionKey(assertion);
    const candidates = observationsByKey.get(key) ?? [];
    const expected = expectedSummary(assertion);

    if (candidates.length === 0) {
      return {
        assertion_index: index,
        assertion_key: key,
        kind: assertion.kind,
        status: "FAIL",
        expected,
        actual: null,
        reason: "Required observation is missing"
      };
    }

    if (candidates.length !== 1) {
      return {
        assertion_index: index,
        assertion_key: key,
        kind: assertion.kind,
        status: "FAIL",
        expected,
        actual: candidates.map(actualSummary).join(" | "),
        reason: "Multiple observations match one assertion"
      };
    }

    const observation = candidates[0];
    if (observation === undefined) {
      throw new Error("Unreachable scenario observation state");
    }
    const passed = observationMatches(assertion, observation);
    return {
      assertion_index: index,
      assertion_key: key,
      kind: assertion.kind,
      status: passed ? "PASS" : "FAIL",
      expected,
      actual: actualSummary(observation),
      reason: passed ? null : "Observed value does not match the release-gate assertion"
    };
  });

  return {
    scenario_id: input.scenario.scenario_id,
    status: checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    checks,
    evaluated_at: input.evaluatedAt
  };
};
