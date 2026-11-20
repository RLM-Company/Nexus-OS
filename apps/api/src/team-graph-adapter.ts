import type { AgentTeamRunGraphPort, TeamGraphNode, ManagerWorkStore } from "@cosmora/db";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";
import type { WorkDag } from "@cosmora/contracts";

// Adapts the existing WorkDagCoordinator to the team runtime port. One DAG per
// composition activation, idempotent by client_request_id; node ids are stable
// hashes of roster lines so a repeat activation resolves the same graph nodes.
export class TeamGraphAdapter implements AgentTeamRunGraphPort {
  constructor(
    private readonly coordinator: WorkDagCoordinator,
    private readonly works: ManagerWorkStore
  ) {}

  createOrGet(input: {
    ownerId: string;
    actorId: string;
    projectId: string;
    compositionId: string;
    parts: Array<{ instanceId: string; nodeId: string; title: string; goal: string }>;
  }): { graphId: string; nodes: TeamGraphNode[] } {
    const graph = this.coordinator.create(input.projectId, input.ownerId, input.actorId, {
      client_request_id: `team:${input.compositionId}`,
      title: `Команда ${input.compositionId.slice(0, 8)}`,
      nodes: input.parts.map((part) => ({
        id: part.nodeId,
        title: part.title,
        goal: part.goal,
        depends_on: []
      }))
    });
    return {
      graphId: graph.id,
      nodes: this.#nodesOfGraph(graph)
    };
  }

  nodesOf(graphId: string, ownerId: string, projectId: string): TeamGraphNode[] {
    const graph = this.works.dag.get(graphId, ownerId);
    if (!graph || graph.project_id !== projectId) return [];
    return this.#nodesOfGraph(graph);
  }

  #nodesOfGraph(graph: WorkDag): TeamGraphNode[] {
    return graph.nodes.map((node) => ({
      id: node.id,
      status: node.status,
      workId: node.attempts.at(-1)?.work_id ?? null
    }));
  }
}
