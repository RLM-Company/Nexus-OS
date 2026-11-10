/**
 * Goldberg-Tarjan Preflow Push-Relabel Maximum Flow Engine.
 * Maintains vertex height labels h(u) (with h(s) = |V|) and excess preflow e(u),
 * discharging active vertices via local Push and Relabel operations.
 */
export class GoldbergTarjanPushRelabelMaxFlow {
  private readonly nodeIndex = new Map<string, number>();
  private readonly cap: number[][] = [];

  private ensureNode(id: string): number {
    let idx = this.nodeIndex.get(id);
    if (idx === undefined) {
      idx = this.nodeIndex.size;
      this.nodeIndex.set(id, idx);
      for (const row of this.cap) row.push(0);
      this.cap.push(new Array<number>(idx + 1).fill(0));
    }
    return idx;
  }

  public addDirectedEdge(fromId: string, toId: string, capacity: number): void {
    const u = this.ensureNode(fromId);
    const v = this.ensureNode(toId);
    this.cap[u]![v] = (this.cap[u]![v] ?? 0) + capacity;
  }

  public computeMaxFlow(sourceId: string, sinkId: string): number {
    const s = this.ensureNode(sourceId);
    const t = this.ensureNode(sinkId);
    const n = this.nodeIndex.size;

    const flow: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const height = new Int32Array(n);
    const excess = new Float64Array(n);
    const seen = new Int32Array(n);

    height[s] = n;
    excess[s] = Infinity;

    const activeQueue: number[] = [];
    const inQueue = new Uint8Array(n);

    const enqueue = (v: number) => {
      if (v !== s && v !== t && excess[v]! > 1e-9 && !inQueue[v]) {
        inQueue[v] = 1;
        activeQueue.push(v);
      }
    };

    const push = (u: number, v: number) => {
      const d = Math.min(excess[u]!, this.cap[u]![v]! - flow[u]![v]!);
      flow[u]![v] = flow[u]![v]! + d;
      flow[v]![u] = flow[v]![u]! - d;
      excess[u] -= d;
      excess[v] += d;
      enqueue(v);
    };

    const relabel = (u: number) => {
      let minHeight = Infinity;
      for (let v = 0; v < n; v++) {
        if (this.cap[u]![v]! - flow[u]![v]! > 1e-9) {
          minHeight = Math.min(minHeight, height[v]!);
        }
      }
      if (Number.isFinite(minHeight)) {
        height[u] = minHeight + 1;
      }
    };

    const discharge = (u: number) => {
      while (excess[u]! > 1e-9) {
        if (seen[u]! < n) {
          const v = seen[u]!;
          if (this.cap[u]![v]! - flow[u]![v]! > 1e-9 && height[u]! > height[v]!) {
            push(u, v);
          } else {
            seen[u]!++;
          }
        } else {
          relabel(u);
          seen[u] = 0;
        }
      }
    };

    // Initialize preflow from source s
    for (let v = 0; v < n; v++) {
      if (v !== s && this.cap[s]![v]! > 0) {
        push(s, v);
      }
    }

    while (activeQueue.length > 0) {
      const u = activeQueue.shift()!;
      inQueue[u] = 0;
      discharge(u);
    }

    return Number(excess[t]!.toFixed(6));
  }
}
