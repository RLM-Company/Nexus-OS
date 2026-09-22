import {
  validateManagerExecutionRequest,
  validateManagerExecutionSnapshot,
  type ManagerExecutionRequest,
  type ManagerExecutionSnapshot,
  type RuntimeTaskGraph
} from "@cosmora/contracts";
import { deriveRuntimeTaskReadiness } from "./manager-runtime-task-readiness.js";

export interface ManagerExecutionPreflightResult {
  executionId: string;
  projectId: string;
  accepted: boolean;
  issues: string[];
  readyTaskIds: string[];
  waitingTaskIds: string[];
  runningTaskIds: string[];
  blockedTaskIds: string[];
  terminalTaskIds: string[];
  evaluatedAt: string;
}

export const preflightManagerExecution = (input: {
  request: ManagerExecutionRequest;
  graph: RuntimeTaskGraph;
  evaluatedAt: string;
}): ManagerExecutionPreflightResult => {
  const readiness = deriveRuntimeTaskReadiness({
    graph: input.graph,
    evaluatedAt: input.evaluatedAt
  });
  const requestIssues = validateManagerExecutionRequest({
    request: input.request,
    graph: input.graph
  });
  const issues = [...new Set([...readiness.graph_issues, ...requestIssues])];

  const readyTaskIds: string[] = [];
  const waitingTaskIds: string[] = [];
  const runningTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const terminalTaskIds: string[] = [];

  for (const decision of readiness.decisions) {
    switch (decision.derived_status) {
      case "ready":
        readyTaskIds.push(decision.task_id);
        break;
      case "pending":
        waitingTaskIds.push(decision.task_id);
        break;
      case "running":
        runningTaskIds.push(decision.task_id);
        break;
      case "blocked":
        blockedTaskIds.push(decision.task_id);
        break;
      case "completed":
      case "failed":
      case "cancelled":
        terminalTaskIds.push(decision.task_id);
        break;
    }
  }

  return {
    executionId: input.request.execution_id,
    projectId: input.request.project_id,
    accepted: issues.length === 0,
    issues,
    readyTaskIds: readyTaskIds.sort(),
    waitingTaskIds: waitingTaskIds.sort(),
    runningTaskIds: runningTaskIds.sort(),
    blockedTaskIds: blockedTaskIds.sort(),
    terminalTaskIds: terminalTaskIds.sort(),
    evaluatedAt: input.evaluatedAt
  };
};

export interface PreparedManagerExecution {
  preflight: ManagerExecutionPreflightResult;
  snapshot: ManagerExecutionSnapshot | null;
}

export const prepareManagerExecution = (input: {
  request: ManagerExecutionRequest;
  graph: RuntimeTaskGraph;
  evaluatedAt: string;
}): PreparedManagerExecution => {
  const preflight = preflightManagerExecution(input);
  if (!preflight.accepted) {
    return { preflight, snapshot: null };
  }

  const snapshot: ManagerExecutionSnapshot = {
    contract_version: input.request.contract_version,
    execution_id: input.request.execution_id,
    project_id: input.request.project_id,
    graph_id: input.graph.graph_id,
    phase: "accepted",
    task_states: input.graph.nodes.map((node) => ({
      task_id: node.task_id,
      status: node.status
    })),
    artifact_ids: [],
    verifications: [],
    checkpoint_id: null,
    result: null,
    updated_at: input.evaluatedAt
  };

  const snapshotIssues = validateManagerExecutionSnapshot({
    snapshot,
    graph: input.graph,
    artifacts: []
  });
  if (snapshotIssues.length > 0) {
    return {
      preflight: {
        ...preflight,
        accepted: false,
        issues: [...new Set([...preflight.issues, ...snapshotIssues])]
      },
      snapshot: null
    };
  }

  return { preflight, snapshot };
};
