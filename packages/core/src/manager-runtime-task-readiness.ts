import {
  validateRuntimeTaskGraph,
  type RuntimeTaskGraph,
  type RuntimeTaskReadinessDecision,
  type RuntimeTaskReadinessSnapshot,
  type RuntimeTaskStatus
} from "@cosmora/contracts";

const terminalStatuses = new Set<RuntimeTaskStatus>(["completed", "failed", "cancelled"]);

export const deriveRuntimeTaskReadiness = (input: {
  graph: RuntimeTaskGraph;
  evaluatedAt: string;
}): RuntimeTaskReadinessSnapshot => {
  const graphIssues = validateRuntimeTaskGraph(input.graph);

  if (graphIssues.length > 0) {
    return {
      graph_id: input.graph.graph_id,
      project_id: input.graph.project_id,
      valid_graph: false,
      graph_issues: graphIssues,
      decisions: input.graph.nodes.map((node) => ({
        task_id: node.task_id,
        current_status: node.status,
        derived_status: "blocked",
        reason: "invalid_graph",
        blocking_dependency_ids: [...node.depends_on].sort()
      })),
      evaluated_at: input.evaluatedAt
    };
  }

  const statusByTaskId = new Map(input.graph.nodes.map((node) => [node.task_id, node.status]));
  const decisions: RuntimeTaskReadinessDecision[] = input.graph.nodes.map((node) => {
    if (node.status === "blocked") {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: node.status,
        reason: "already_blocked",
        blocking_dependency_ids: []
      };
    }

    if (node.status === "running") {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: node.status,
        reason: "already_running",
        blocking_dependency_ids: []
      };
    }

    if (terminalStatuses.has(node.status)) {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: node.status,
        reason: "already_terminal",
        blocking_dependency_ids: []
      };
    }

    const failedDependencies = node.depends_on
      .filter((dependencyId) => statusByTaskId.get(dependencyId) === "failed")
      .sort();
    if (failedDependencies.length > 0) {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: "blocked",
        reason: "dependency_failed",
        blocking_dependency_ids: failedDependencies
      };
    }

    const cancelledDependencies = node.depends_on
      .filter((dependencyId) => statusByTaskId.get(dependencyId) === "cancelled")
      .sort();
    if (cancelledDependencies.length > 0) {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: "blocked",
        reason: "dependency_cancelled",
        blocking_dependency_ids: cancelledDependencies
      };
    }

    const unfinishedDependencies = node.depends_on
      .filter((dependencyId) => statusByTaskId.get(dependencyId) !== "completed")
      .sort();
    if (unfinishedDependencies.length > 0) {
      return {
        task_id: node.task_id,
        current_status: node.status,
        derived_status: "pending",
        reason: "waiting_for_dependencies",
        blocking_dependency_ids: unfinishedDependencies
      };
    }

    return {
      task_id: node.task_id,
      current_status: node.status,
      derived_status: "ready",
      reason: "dependencies_satisfied",
      blocking_dependency_ids: []
    };
  });

  return {
    graph_id: input.graph.graph_id,
    project_id: input.graph.project_id,
    valid_graph: true,
    graph_issues: [],
    decisions,
    evaluated_at: input.evaluatedAt
  };
};
