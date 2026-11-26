import { createHash } from "node:crypto";

/** Deterministic binding between a Stars mission and the existing Agent Team
 * composition/Work DAG. No paid dispatch and no fake DAG status writes.
 *
 * The composition id follows the existing AgentTeamStore convention: sha256 of
 * sorted `blueprint_ref@version` lines. Stars agent ids are used as blueprint
 * refs with version 1 for the first binding; an integrator may replace this
 * mapping with a real blueprint lookup without changing the mission contract. */
export type StarsTeamBinding = {
  composition_id: string;
  project_id: string;
  parts: Array<{ agent_id: string; node_id: string; instance_id: string | null }>;
  activated: boolean;
};

export function bindStarsTeam(
  mission: { id: string; team_scope: string; agents: Array<{ id: string }> },
  projectId: string
): StarsTeamBinding {
  const refs = [...mission.agents.map((agent) => `${agent.id}@1`)].sort();
  const compositionId = createHash("sha256").update(refs.join("\n")).digest("hex");
  return {
    composition_id: compositionId,
    project_id: projectId,
    parts: mission.agents.map((agent) => ({
      agent_id: agent.id,
      node_id: `part-${createHash("sha256").update(`${agent.id}@1`).digest("hex").slice(0, 16)}`,
      instance_id: null
    })),
    activated: false
  };
}

export function starsTeamStatus(
  parts: ReadonlyArray<{ instance_id: string; node_id: string; status: string }>,
  binding: StarsTeamBinding
): StarsTeamBinding {
  const byNode = new Map(parts.map((part) => [part.node_id, part]));
  return {
    ...binding,
    parts: binding.parts.map((part) => {
      const live = byNode.get(part.node_id);
      return live ? { ...part, instance_id: live.instance_id } : part;
    }),
    activated: byNode.size > 0
  };
}
