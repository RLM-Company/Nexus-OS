import {
  MANAGER_RUNTIME_ROLE_CONTRACTS,
  validateRuntimeTaskGraph,
  type RuntimeArtifact,
  type RuntimeTaskGraph
} from "./manager-runtime.js";

export const validateRuntimeArtifactTaskBinding = (input: {
  artifact: RuntimeArtifact;
  graph: RuntimeTaskGraph;
}): string[] => {
  const issues = [...validateRuntimeTaskGraph(input.graph)];
  const { artifact, graph } = input;
  const task = graph.nodes.find((node) => node.task_id === artifact.task_id);

  if (artifact.project_id !== graph.project_id) {
    issues.push(`Artifact ${artifact.artifact_id} belongs to another task graph project`);
  }
  if (Date.parse(artifact.created_at) < Date.parse(graph.created_at)) {
    issues.push(`Artifact ${artifact.artifact_id} cannot predate its task graph`);
  }
  if (task === undefined) {
    issues.push(`Artifact ${artifact.artifact_id} references unknown task ${artifact.task_id}`);
    return [...new Set(issues)];
  }

  if (task.project_id !== artifact.project_id) {
    issues.push(`Artifact ${artifact.artifact_id} task belongs to another project`);
  }
  if (task.assigned_role !== artifact.producer_role) {
    issues.push(
      `Artifact ${artifact.artifact_id} producer role does not match task ${task.task_id}`
    );
  }
  if (!task.expected_output_kinds.includes(artifact.kind)) {
    issues.push(`Artifact ${artifact.artifact_id} kind is not declared by task ${task.task_id}`);
  }
  if (!MANAGER_RUNTIME_ROLE_CONTRACTS[artifact.producer_role].emits.includes(artifact.kind)) {
    issues.push(`Role ${artifact.producer_role} cannot emit artifact kind ${artifact.kind}`);
  }

  const declaredInputs = new Set(task.input_artifact_ids);
  for (const sourceArtifactId of artifact.source_artifact_ids) {
    if (!declaredInputs.has(sourceArtifactId)) {
      issues.push(
        `Artifact ${artifact.artifact_id} cites undeclared task input ${sourceArtifactId}`
      );
    }
  }

  if (Date.parse(artifact.created_at) < Date.parse(task.created_at)) {
    issues.push(`Artifact ${artifact.artifact_id} cannot predate task ${task.task_id}`);
  }

  return [...new Set(issues)];
};
