import {
  MANAGER_RUNTIME_ROLE_CONTRACTS,
  type AgentConflict,
  type ManagerRuntimeRole
} from "./manager-runtime.js";

export const roleCanArbitrateAgentConflict = (role: ManagerRuntimeRole): boolean =>
  MANAGER_RUNTIME_ROLE_CONTRACTS[role].can_arbitrate_conflict;

export const validateAgentConflictLifecycle = (conflict: AgentConflict): string[] => {
  const issues: string[] = [];
  const distinctArtifacts = new Set(conflict.positions.map((position) => position.artifact_id));

  if (distinctArtifacts.size < 2) {
    issues.push("Agent conflict requires at least two distinct position artifacts");
  }

  if (conflict.status === "resolved") {
    if (conflict.resolution_artifact_id === null) {
      issues.push("Resolved agent conflict requires a resolution artifact");
    }
    if (conflict.resolved_at === null) {
      issues.push("Resolved agent conflict requires resolved_at");
    }
  } else {
    if (conflict.resolution_artifact_id !== null) {
      issues.push("Open or escalated agent conflict cannot carry a resolution artifact");
    }
    if (conflict.resolved_at !== null) {
      issues.push("Open or escalated agent conflict cannot carry resolved_at");
    }
  }

  if (
    conflict.resolved_at !== null &&
    Date.parse(conflict.resolved_at) < Date.parse(conflict.created_at)
  ) {
    issues.push("Agent conflict cannot resolve before it was created");
  }

  return issues;
};
