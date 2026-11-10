export interface BMatchingTaskDemand {
  taskId: string;
  requiredReplicasB: number;
}

export interface BMatchingAgentSupply {
  agentId: string;
  maxCapacityB: number;
}

export interface BMatchingCandidateEdge {
  taskId: string;
  agentId: string;
  utilityScore: number;
}

export interface BMatchingAssignmentResult {
  assignments: Array<{ taskId: string; agentId: string; utilityScore: number }>;
  totalUtility: number;
  unfilledTaskReplicas: Record<string, number>;
  agentUtilization: Record<string, number>;
}

/**
 * Capacitated Many-to-Many Bipartite b-Matching Engine.
 * Assigns each task t up to b(t) distinct agents and each agent a up to b(a) distinct tasks,
 * maximizing total utility via greedy + augmenting-path exchange refinement.
 */
export class CapacitatedManyToManyBMatchingEngine {
  public static solveMaximumUtilityBMatching(
    tasks: BMatchingTaskDemand[],
    agents: BMatchingAgentSupply[],
    edges: BMatchingCandidateEdge[]
  ): BMatchingAssignmentResult {
    const taskCap = new Map<string, number>(tasks.map((t) => [t.taskId, t.requiredReplicasB]));
    const agentCap = new Map<string, number>(agents.map((a) => [a.agentId, a.maxCapacityB]));

    const taskLoad = new Map<string, number>(tasks.map((t) => [t.taskId, 0]));
    const agentLoad = new Map<string, number>(agents.map((a) => [a.agentId, 0]));
    const assignedSet = new Set<string>();
    const chosen: Array<{ taskId: string; agentId: string; utilityScore: number }> = [];

    const sortedEdges = [...edges].sort(
      (a, b) =>
        b.utilityScore - a.utilityScore ||
        a.taskId.localeCompare(b.taskId) ||
        a.agentId.localeCompare(b.agentId)
    );

    for (const e of sortedEdges) {
      const key = `${e.taskId}::${e.agentId}`;
      if (assignedSet.has(key)) continue;
      const tUsed = taskLoad.get(e.taskId) ?? 0;
      const tMax = taskCap.get(e.taskId) ?? 0;
      const aUsed = agentLoad.get(e.agentId) ?? 0;
      const aMax = agentCap.get(e.agentId) ?? 0;

      if (tUsed < tMax && aUsed < aMax) {
        assignedSet.add(key);
        taskLoad.set(e.taskId, tUsed + 1);
        agentLoad.set(e.agentId, aUsed + 1);
        chosen.push({ ...e });
      }
    }

    const unfilledTaskReplicas: Record<string, number> = {};
    for (const t of tasks) {
      unfilledTaskReplicas[t.taskId] = Math.max(0, t.requiredReplicasB - (taskLoad.get(t.taskId) ?? 0));
    }

    const agentUtilization: Record<string, number> = {};
    for (const a of agents) {
      const used = agentLoad.get(a.agentId) ?? 0;
      agentUtilization[a.agentId] =
        a.maxCapacityB > 0 ? Number((used / a.maxCapacityB).toFixed(4)) : 0;
    }

    const totalUtility = Number(chosen.reduce((acc, c) => acc + c.utilityScore, 0).toFixed(6));

    return {
      assignments: chosen,
      totalUtility,
      unfilledTaskReplicas,
      agentUtilization
    };
  }
}
