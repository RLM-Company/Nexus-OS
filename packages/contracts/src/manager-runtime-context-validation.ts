import type { RuntimeArtifact, RuntimeTaskNode } from "./manager-runtime.js";
import {
  validateRuntimeArtifactExchange,
  validateRuntimeContextEnvelope,
  type RuntimeContextEnvelope
} from "./manager-runtime-state.js";

export const validateRuntimeContextMaterialization = (input: {
  context: RuntimeContextEnvelope;
  task: RuntimeTaskNode;
  artifacts: readonly RuntimeArtifact[];
}): string[] => {
  const issues = [...validateRuntimeContextEnvelope(input.context)];

  if (input.task.project_id !== input.context.project_id) {
    issues.push("Context task belongs to another project");
  }
  if (input.task.task_id !== input.context.task_id) {
    issues.push("Context task_id does not match the materialized task");
  }
  if (input.task.assigned_role !== input.context.role) {
    issues.push("Context role does not match the task assigned role");
  }
  if (input.task.memory_scope.read_mode !== input.context.memory_scope.read_mode) {
    issues.push("Context memory read mode differs from the task contract");
  }
  if (input.task.memory_scope.write_back !== input.context.memory_scope.write_back) {
    issues.push("Context memory write-back mode differs from the task contract");
  }

  const taskMemorySourceIds = new Set(input.task.memory_scope.source_ids);
  for (const sourceId of input.context.memory_scope.source_ids) {
    if (!taskMemorySourceIds.has(sourceId)) {
      issues.push(`Context memory source is not declared by the task: ${sourceId}`);
    }
  }

  const taskInputArtifactIds = new Set(input.task.input_artifact_ids);
  for (const artifactId of input.context.artifact_ids) {
    if (!taskInputArtifactIds.has(artifactId)) {
      issues.push(`Context artifact is not declared as a task input: ${artifactId}`);
    }
  }

  const declaredArtifactIds = new Set(input.context.artifact_ids);
  const allowedDataClasses = new Set(input.context.allowed_data_classes);
  const allowedSourceIds = new Set(input.context.source_ids);
  const materializedArtifactIds = new Set<string>();

  for (const artifact of input.artifacts) {
    if (materializedArtifactIds.has(artifact.artifact_id)) {
      issues.push(`Duplicate materialized artifact: ${artifact.artifact_id}`);
      continue;
    }
    materializedArtifactIds.add(artifact.artifact_id);

    if (!declaredArtifactIds.has(artifact.artifact_id)) {
      issues.push(`Materialized artifact is not declared by the context: ${artifact.artifact_id}`);
    }
    issues.push(
      ...validateRuntimeArtifactExchange({
        artifact,
        targetRole: input.context.role,
        targetProjectId: input.context.project_id
      })
    );
    if (artifact.project_id !== input.context.project_id) {
      issues.push(`Artifact ${artifact.artifact_id} crosses the context project boundary`);
    }
    if (!allowedDataClasses.has(artifact.data_class)) {
      issues.push(`Artifact ${artifact.artifact_id} uses a data class not allowed by the context`);
    }
    if (artifact.instruction_treatment !== "data_only") {
      issues.push(`Artifact ${artifact.artifact_id} attempted to introduce instruction authority`);
    }
    if (artifact.source_artifact_ids.includes(artifact.artifact_id)) {
      issues.push(`Artifact ${artifact.artifact_id} references itself as provenance`);
    }
    for (const sourceId of artifact.source_ids) {
      if (!allowedSourceIds.has(sourceId)) {
        issues.push(
          `Artifact ${artifact.artifact_id} uses an undeclared context source: ${sourceId}`
        );
      }
    }
  }

  for (const artifactId of input.context.artifact_ids) {
    if (!materializedArtifactIds.has(artifactId)) {
      issues.push(`Declared context artifact was not materialized: ${artifactId}`);
    }
  }

  return [...new Set(issues)];
};
