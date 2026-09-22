import {
  validateManagerExecutionRequest,
  type ManagerExecutionRequest,
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
