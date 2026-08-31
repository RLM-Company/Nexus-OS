import {
  validateCriticVerdict,
  type CriticVerdict,
  type RuntimeArtifact
} from "./manager-runtime.js";

export const validateCriticVerdictAgainstArtifacts = (input: {
  verdict: CriticVerdict;
  artifacts: readonly RuntimeArtifact[];
}): string[] => {
  const issues = [...validateCriticVerdict(input.verdict)];
  const artifactsById = new Map<string, RuntimeArtifact>();

  for (const artifact of input.artifacts) {
    if (!artifactsById.has(artifact.artifact_id)) {
      artifactsById.set(artifact.artifact_id, artifact);
    }
  }

  for (const artifactId of input.verdict.reviewed_artifact_ids) {
    const artifact = artifactsById.get(artifactId);
    if (artifact === undefined) {
      issues.push(`Critic verdict references unknown reviewed artifact ${artifactId}`);
      continue;
    }
    if (artifact.project_id !== input.verdict.project_id) {
      issues.push(`Critic verdict references reviewed artifact from another project: ${artifactId}`);
    }
    if (Date.parse(artifact.created_at) > Date.parse(input.verdict.created_at)) {
      issues.push(`Critic verdict references reviewed artifact created later: ${artifactId}`);
    }
  }

  return [...new Set(issues)];
};
