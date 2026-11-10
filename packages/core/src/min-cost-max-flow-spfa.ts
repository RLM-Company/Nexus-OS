interface CostResidualEdge {
  to: number;
  rev: number;
  cap: number;
  flow: number;
  cost: number;
}

export interface MinCostMaxFlowResult {
  maxFlow: number;
  minTotalCost: number;
  augmentingPathsUsed: number;
}

/**
 * Successive Shortest Augmenting Path (SPFA / Bellman-Ford) Minimum-Cost Maximum-Flow (MCMF) Solver.
 * Simultaneously maximizes total network flow from source to sink while minimizing total edge routing cost.
 */
export class SuccessiveShortestPathMinCostMaxFlow {
  private readonly nodeIndex = new Map<string, number>();
  private readonly adj: CostResidualEdge[][] = [];

  private ensureNode(id: string): number {
    let idx = this.nodeIndex.get(id);
    if (idx === undefined) {
      idx = this.adj.length;
      this.nodeIndex.set(id, idx);
      this.adj.push([]);
    }
    return idx;
  }

  public addEdge(fromId: string, toId: string, capacity: number, unitCost: number): void {
    const u = this.ensureNode(fromId);
    const v = this.ensureNode(toId);

    const fwd: CostResidualEdge = {
      to: v,
      rev: this.adj[v]!.length,
      cap: capacity,
      flow: 0,
      cost: unitCost
    };
    const bwd: CostResidualEdge = {
      to: u,
      rev: this.adj[u]!.length,
      cap: 0,
      flow: 0,
      cost: -unitCost
    };

    this.adj[u]!.push(fwd);
    this.adj[v]!.push(bwd);
  }

  public computeMinCostMaxFlow(
    sourceId: string,
    sinkId: string,
    desiredMaxFlow = Infinity
  ): MinCostMaxFlowResult {
    const s = this.ensureNode(sourceId);
    const t = this.ensureNode(sinkId);
    const n = this.adj.length;

    let maxFlow = 0;
    let minTotalCost = 0;
    let augmentingPathsUsed = 0;

    while (maxFlow < desiredMaxFlow) {
      const dist = new Float64Array(n).fill(Infinity);
      const inQueue = new Uint8Array(n);
      const parentNode = new Int32Array(n).fill(-1);
      const parentEdge = new Int32Array(n).fill(-1);

      dist[s] = 0;
      const queue: number[] = [s];
      inQueue[s] = 1;

      while (queue.length > 0) {
        const u = queue.shift()!;
        inQueue[u] = 0;

        for (let i = 0; i < this.adj[u]!.length; i++) {
          const e = this.adj[u]![i]!;
          if (e.cap - e.flow > 1e-9 && dist[u]! + e.cost < dist[e.to]! - 1e-9) {
            dist[e.to] = dist[u]! + e.cost;
            parentNode[e.to] = u;
            parentEdge[e.to] = i;
            if (!inQueue[e.to]) {
              inQueue[e.to] = 1;
              queue.push(e.to);
            }
          }
        }
      }

      if (!Number.isFinite(dist[t]!)) {
        break; // No more augmenting paths
      }

      // Find bottleneck capacity along shortest-cost path
      let push = desiredMaxFlow - maxFlow;
      let curr = t;
      while (curr !== s) {
        const p = parentNode[curr]!;
        const eIdx = parentEdge[curr]!;
        const edge = this.adj[p]![eIdx]!;
        push = Math.min(push, edge.cap - edge.flow);
        curr = p;
      }

      curr = t;
      while (curr !== s) {
        const p = parentNode[curr]!;
        const eIdx = parentEdge[curr]!;
        const edge = this.adj[p]![eIdx]!;
        edge.flow += push;
        this.adj[curr]![edge.rev]!.flow -= push;
        minTotalCost += push * edge.cost;
        curr = p;
      }

      maxFlow += push;
      augmentingPathsUsed++;
    }

    return {
      maxFlow: Number(maxFlow.toFixed(6)),
      minTotalCost: Number(minTotalCost.toFixed(6)),
      augmentingPathsUsed
    };
  }
}
