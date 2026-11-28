/** Handoff packet for replacing a Stars agent. Contains exactly the state a
 * successor needs to continue: mission/composition versions, unfinished steps,
 * verified results, dependencies and access limits. No automatic permission
 * expansion and no model invocation. */
import type { StarsMission } from "./stars-mission.js";
import type { StarsOrgSnapshot } from "./stars-hierarchy.js";

export type StarsHandoffPacket = {
  format: "kosmora.stars-handoff.v1";
  mission_id: string;
  mission_version: number;
  composition_version: number;
  from: string;
  to: string;
  unfinished: Array<{ agent_id: string; task: string; reason: string }>;
  completed_results: Array<{
    agent_id: string;
    summary: string;
    artifact_ref: string | null;
    verification: string;
    verified_by: string | null;
  }>;
  dependencies: Record<string, string[]>;
  context_scopes: string[];
  created_at: string;
};

export function buildStarsHandoff(
  mission: StarsMission,
  org: StarsOrgSnapshot,
  from: string,
  to: string,
  createdAt: string
): StarsHandoffPacket {
  const source = mission.agents.find((agent) => agent.id === from);
  if (!source) throw Error("HANDOFF_AGENT_NOT_FOUND");
  return {
    format: "kosmora.stars-handoff.v1",
    mission_id: mission.id,
    mission_version: mission.version,
    composition_version: org.version,
    from,
    to,
    unfinished: mission.agents
      .filter(
        (agent) =>
          agent.role === "executor" && (agent.status === "failed" || agent.status === "assigned")
      )
      .map((agent) => ({
        agent_id: agent.id,
        task: agent.handoff ?? agent.task,
        reason: agent.status === "failed" ? "executor_failed" : "unfinished"
      })),
    completed_results: mission.results
      .filter((result) => result.verification === "verified")
      .map((result) => ({
        agent_id: result.agent_id,
        summary: result.summary,
        artifact_ref: result.artifact_ref,
        verification: result.verification,
        verified_by: result.verified_by
      })),
    dependencies: Object.fromEntries(
      Object.entries(mission.dependencies).map(([id, deps]) => [
        id === from ? to : id,
        deps.map((dep) => (dep === from ? to : dep))
      ])
    ),
    // The successor inherits only the original member's scopes; the team
    // scope is already present there when the mission granted it.
    context_scopes: [...source.context_scopes],
    created_at: createdAt
  };
}
