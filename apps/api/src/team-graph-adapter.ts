import {
  AgentTeamRunValidationError,
  type AgentTeamRunGraphPort,
  type TeamGraphNode,
  type ManagerWorkStore
} from "@cosmora/db";
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

  createOrGet(
    input: Parameters<AgentTeamRunGraphPort["createOrGet"]>[0]
  ): ReturnType<AgentTeamRunGraphPort["createOrGet"]> {
    const graph = this.coordinator.create(input.projectId, input.ownerId, input.actorId, {
      client_request_id: input.runKey ?? `team:${input.compositionId}`,
      title: input.title ?? `Команда ${input.compositionId.slice(0, 8)}`,
      nodes: input.parts.map((part) => ({
        id: part.nodeId,
        title: part.title,
        goal: part.goal,
        depends_on: part.dependsOn ?? []
      }))
    });
    return {
      graphId: graph.id,
      nodes: this.#nodesOfGraph(graph)
    };
  }

  nodesOf(graphId: string, ownerId: string, projectId: string, runKey?: string): TeamGraphNode[] {
    const graph = this.works.dag.get(graphId, ownerId);
    if (!graph || graph.project_id !== projectId) return [];
    if (runKey && graph.client_request_id !== runKey) {
      throw new AgentTeamRunValidationError(
        "This team composition already belongs to another plan"
      );
    }
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
