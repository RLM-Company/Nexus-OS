interface ResidualEdge {
  to: number;
  rev: number;
  cap: number;
  flow: number;
  originalCap: number;
  fromNodeId: string;
  toNodeId: string;
}

export interface MaxFlowMinCutResult {
  maxFlowValue: number;
  sourceSideNodes: string[];
  sinkSideNodes: string[];
  minCutBottleneckEdges: Array<{ from: string; to: string; capacity: number }>;
}

/**
 * Dinic's O(V^2 E) Maximum Network Flow & Minimum Cut Solver (BFS Level Graph + DFS Blocking Flow).
 * Computes maximum throughput across multi-stage agent pipelines and extracts the exact s-t Min-Cut
 * bottleneck edges.
 */
export class DinicMaxFlowMinCutEngine {
  private readonly nodeIndex = new Map<string, number>();
  private readonly nodeNames: string[] = [];
  private readonly adj: ResidualEdge[][] = [];

  private ensureNode(id: string): number {
    let idx = this.nodeIndex.get(id);
    if (idx === undefined) {
      idx = this.nodeNames.length;
      this.nodeNames.push(id);
      this.nodeIndex.set(id, idx);
      this.adj.push([]);
    }
    return idx;
  }

  public addDirectedEdge(fromId: string, toId: string, capacity: number): void {
    const u = this.ensureNode(fromId);
    const v = this.ensureNode(toId);
    const fwd: ResidualEdge = {
      to: v,
      rev: this.adj[v]!.length,
      cap: capacity,
      flow: 0,
      originalCap: capacity,
      fromNodeId: fromId,
      toNodeId: toId
    };
    const bwd: ResidualEdge = {
      to: u,
      rev: this.adj[u]!.length,
      cap: 0,
      flow: 0,
      originalCap: 0,
      fromNodeId: toId,
      toNodeId: fromId
    };
    this.adj[u]!.push(fwd);
    this.adj[v]!.push(bwd);
  }

  public computeMaxFlowAndMinCut(sourceId: string, sinkId: string): MaxFlowMinCutResult {
    const s = this.ensureNode(sourceId);
    const t = this.ensureNode(sinkId);
    const n = this.nodeNames.length;
    const level = new Int32Array(n);
    const ptr = new Int32Array(n);

    const bfs = (): boolean => {
      level.fill(-1);
      level[s] = 0;
      const q: number[] = [s];
      while (q.length > 0) {
        const v = q.shift()!;
        for (const edge of this.adj[v]!) {
          if (edge.cap - edge.flow > 1e-9 && level[edge.to] === -1) {
            level[edge.to] = level[v]! + 1;
            q.push(edge.to);
          }
        }
      }
      return level[t] !== -1;
    };

    const dfs = (v: number, pushed: number): number => {
      if (pushed <= 1e-9 || v === t) return pushed;
      for (; ptr[v]! < this.adj[v]!.length; ptr[v]!++) {
        const cid = ptr[v]!;
        const e = this.adj[v]![cid]!;
        const tr = e.to;
        if (level[v]! + 1 !== level[tr] || e.cap - e.flow <= 1e-9) continue;
        const trPushed = dfs(tr, Math.min(pushed, e.cap - e.flow));
        if (trPushed <= 1e-9) continue;
        e.flow += trPushed;
        this.adj[tr]![e.rev]!.flow -= trPushed;
        return trPushed;
      }
      return 0;
    };

    let maxFlow = 0;
    while (bfs()) {
      ptr.fill(0);
      while (true) {
        const pushed = dfs(s, Infinity);
        if (pushed <= 1e-9) break;
        maxFlow += pushed;
      }
    }

    // After Dinic terminates, nodes with level[u] !== -1 are reachable from source in the residual graph
    const sourceSideNodes: string[] = [];
    const sinkSideNodes: string[] = [];
    for (let i = 0; i < n; i++) {
      if (level[i] !== -1) sourceSideNodes.push(this.nodeNames[i]!);
      else sinkSideNodes.push(this.nodeNames[i]!);
    }

    const minCutBottleneckEdges: Array<{ from: string; to: string; capacity: number }> = [];
    for (let u = 0; u < n; u++) {
      if (level[u] === -1) continue;
      for (const e of this.adj[u]!) {
        if (e.originalCap > 0 && level[e.to] === -1) {
          minCutBottleneckEdges.push({
            from: e.fromNodeId,
            to: e.toNodeId,
            capacity: e.originalCap
          });
        }
      }
    }

    return {
      maxFlowValue: Number(maxFlow.toFixed(6)),
      sourceSideNodes,
      sinkSideNodes,
      minCutBottleneckEdges
    };
  }
}
