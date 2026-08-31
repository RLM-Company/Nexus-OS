import type { RuntimeTaskGraph } from "./manager-runtime.js";
import type { RuntimeCheckpoint } from "./manager-runtime-state.js";

export const validateRuntimeCheckpointAgainstGraph = (input: {
  checkpoint: RuntimeCheckpoint;
  graph: RuntimeTaskGraph;
}): string[] => {
  const issues: string[] = [];
  const graphTaskIds = new Set(input.graph.nodes.map((node) => node.task_id));
  const checkpointTaskIds = new Set<string>();

  if (input.checkpoint.project_id !== input.graph.project_id) {
    issues.push("Runtime checkpoint belongs to another project");
  }
  if (input.checkpoint.graph_id !== input.graph.graph_id) {
    issues.push("Runtime checkpoint belongs to another task graph");
  }
  if (Date.parse(input.checkpoint.created_at) < Date.parse(input.graph.created_at)) {
    issues.push("Runtime checkpoint cannot predate its task graph");
  }

  for (const taskState of input.checkpoint.task_states) {
    if (checkpointTaskIds.has(taskState.task_id)) {
      issues.push(`Runtime checkpoint duplicates task state ${taskState.task_id}`);
    }
    checkpointTaskIds.add(taskState.task_id);

    if (!graphTaskIds.has(taskState.task_id)) {
      issues.push(`Runtime checkpoint contains unknown task ${taskState.task_id}`);
    }
  }

  for (const taskId of graphTaskIds) {
    if (!checkpointTaskIds.has(taskId)) {
      issues.push(`Runtime checkpoint is missing task state ${taskId}`);
    }
  }

  return [...new Set(issues)];
};
