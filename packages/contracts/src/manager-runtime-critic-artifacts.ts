import {
  MANAGER_RUNTIME_ROLE_CONTRACTS,
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
  const criticAccepts = new Set(MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts);

  for (const artifact of input.artifacts) {
    if (artifactsById.has(artifact.artifact_id)) {
      issues.push(
        `Duplicate runtime artifact supplied to critic validation: ${artifact.artifact_id}`
      );
      continue;
    }
    artifactsById.set(artifact.artifact_id, artifact);
  }

  for (const artifactId of input.verdict.reviewed_artifact_ids) {
    const artifact = artifactsById.get(artifactId);
    if (artifact === undefined) {
      issues.push(`Critic verdict references unknown reviewed artifact ${artifactId}`);
      continue;
    }
    if (artifact.project_id !== input.verdict.project_id) {
      issues.push(
        `Critic verdict references reviewed artifact from another project: ${artifactId}`
      );
    }
    if (!criticAccepts.has(artifact.kind)) {
      issues.push(
        `Critic verdict reviews unsupported artifact kind ${artifact.kind}: ${artifactId}`
      );
    }
    if (Date.parse(artifact.created_at) > Date.parse(input.verdict.created_at)) {
      issues.push(`Critic verdict references reviewed artifact created later: ${artifactId}`);
    }
  }

  return [...new Set(issues)];
};
