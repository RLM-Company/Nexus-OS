import type { RuntimeArtifact } from "./manager-runtime.js";

export const validateRuntimeArtifactProvenance = (input: {
  projectId: string;
  artifacts: readonly RuntimeArtifact[];
}): string[] => {
  const issues: string[] = [];
  const byId = new Map<string, RuntimeArtifact>();

  for (const artifact of input.artifacts) {
    if (byId.has(artifact.artifact_id)) {
      issues.push(`Duplicate runtime artifact: ${artifact.artifact_id}`);
      continue;
    }
    byId.set(artifact.artifact_id, artifact);

    if (artifact.project_id !== input.projectId) {
      issues.push(`Artifact ${artifact.artifact_id} belongs to another project`);
    }
  }

  for (const artifact of byId.values()) {
    for (const sourceArtifactId of artifact.source_artifact_ids) {
      if (sourceArtifactId === artifact.artifact_id) {
        issues.push(`Artifact ${artifact.artifact_id} references itself as provenance`);
        continue;
      }

      const sourceArtifact = byId.get(sourceArtifactId);
      if (sourceArtifact === undefined) {
        issues.push(
          `Artifact ${artifact.artifact_id} references unknown source artifact ${sourceArtifactId}`
        );
        continue;
      }
      if (sourceArtifact.project_id !== artifact.project_id) {
        issues.push(
          `Artifact ${artifact.artifact_id} references cross-project provenance ${sourceArtifactId}`
        );
      }
      if (Date.parse(sourceArtifact.created_at) > Date.parse(artifact.created_at)) {
        issues.push(
          `Artifact ${artifact.artifact_id} references source artifact created later: ${sourceArtifactId}`
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (artifactId: string): void => {
    if (visited.has(artifactId)) return;
    if (visiting.has(artifactId)) {
      issues.push(`Runtime artifact provenance contains a cycle at ${artifactId}`);
      return;
    }

    const artifact = byId.get(artifactId);
    if (artifact === undefined) return;
    visiting.add(artifactId);
    for (const sourceArtifactId of artifact.source_artifact_ids) {
      if (byId.has(sourceArtifactId)) visit(sourceArtifactId);
    }
    visiting.delete(artifactId);
    visited.add(artifactId);
  };

  for (const artifactId of byId.keys()) visit(artifactId);

  return [...new Set(issues)];
};
