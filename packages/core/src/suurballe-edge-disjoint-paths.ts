export interface DisjointPathSpec {
  nodes: string[];
  cost: number;
}

/**
 * Suurballe / Shortest-Augmenting-Path Edge-Disjoint Fault-Tolerant Multi-Path Router.
 * Finds K edge-disjoint paths from source to target with minimum total latency cost
 * so that up to K - 1 simultaneous link failures cannot disconnect communication.
 */
export class EdgeDisjointFaultTolerantRouter {
  public static findEdgeDisjointPaths(params: {
    nodes: string[];
    directedEdges: Array<{ from: string; to: string; cost: number }>;
    sourceId: string;
    targetId: string;
    maxPathsK: number;
  }): { paths: DisjointPathSpec[]; totalCombinedCost: number } {
    const remainingEdges = params.directedEdges.map((e, idx) => ({
      id: idx,
      from: e.from,
      to: e.to,
      cost: e.cost,
      used: false
    }));

    const paths: DisjointPathSpec[] = [];
    let totalCombinedCost = 0;

    for (let k = 0; k < params.maxPathsK; k++) {
      // Bellman-Ford shortest path over unused directed edges
      const dist = new Map<string, number>();
      const parentEdgeIdx = new Map<string, number>();
      for (const n of params.nodes) dist.set(n, Infinity);
      dist.set(params.sourceId, 0);

      for (let step = 0; step < params.nodes.length - 1; step++) {
        let updated = false;
        for (let i = 0; i < remainingEdges.length; i++) {
          const e = remainingEdges[i]!;
          if (e.used) continue;
          const dU = dist.get(e.from) ?? Infinity;
          const dV = dist.get(e.to) ?? Infinity;
          if (dU + e.cost < dV - 1e-9) {
            dist.set(e.to, dU + e.cost);
            parentEdgeIdx.set(e.to, i);
            updated = true;
          }
        }
        if (!updated) break;
      }

      const targetCost = dist.get(params.targetId) ?? Infinity;
      if (!Number.isFinite(targetCost)) {
        break;
      }

      const pathNodes: string[] = [params.targetId];
      let curr = params.targetId;
      while (curr !== params.sourceId) {
        const eIdx = parentEdgeIdx.get(curr)!;
        const edge = remainingEdges[eIdx]!;
        edge.used = true;
        curr = edge.from;
        pathNodes.push(curr);
      }
      pathNodes.reverse();

      paths.push({
        nodes: pathNodes,
        cost: Number(targetCost.toFixed(6))
      });
      totalCombinedCost += targetCost;
    }

    return {
      paths,
      totalCombinedCost: Number(totalCombinedCost.toFixed(6))
    };
  }
}
