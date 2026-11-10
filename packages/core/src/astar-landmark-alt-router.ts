export interface AltGraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface AltShortestPathResult {
  reachable: boolean;
  totalDistance: number;
  path: string[];
  nodesExpandedWithAlt: number;
  nodesExpandedStandardDijkstra: number;
  selectedLandmarks: string[];
}

/**
 * Goldberg & Harrelson's ALT (A* + Landmarks + Triangle Inequality) Shortest-Path Router.
 * Precomputes distances from k farthest-point landmarks L and uses the admissible, consistent
 * triangle-inequality lower bound h(u, t) = max_{L} |dist(L, t) - dist(L, u)| to prune search space.
 */
export class AStarLandmarkTriangleInequalityRouter {
  private readonly vertices: string[];
  private readonly adj = new Map<string, Array<{ to: string; weight: number }>>();
  private readonly landmarks: string[] = [];
  private readonly landmarkDist = new Map<string, Map<string, number>>();

  public constructor(vertices: string[], edges: AltGraphEdge[], numLandmarks: number = 2) {
    this.vertices = [...vertices];
    for (const v of vertices) this.adj.set(v, []);
    for (const e of edges) {
      if (!this.adj.has(e.from)) this.adj.set(e.from, []);
      this.adj.get(e.from)!.push({ to: e.to, weight: Math.max(0, e.weight) });
    }
    this.precomputeFarthestLandmarks(Math.min(numLandmarks, vertices.length));
  }

  private runSingleSourceDijkstra(source: string): Map<string, number> {
    const dist = new Map<string, number>(this.vertices.map((v) => [v, Infinity]));
    dist.set(source, 0);
    const visited = new Set<string>();

    while (visited.size < this.vertices.length) {
      let bestU: string | null = null;
      let bestD = Infinity;
      for (const v of this.vertices) {
        if (!visited.has(v) && (dist.get(v) ?? Infinity) < bestD) {
          bestD = dist.get(v)!;
          bestU = v;
        }
      }
      if (bestU === null) break;
      visited.add(bestU);

      for (const e of this.adj.get(bestU) ?? []) {
        const nd = bestD + e.weight;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
        }
      }
    }
    return dist;
  }

  private precomputeFarthestLandmarks(k: number): void {
    if (this.vertices.length === 0 || k <= 0) return;
    let nextLandmark = this.vertices[0]!;
    const minDistToAnyLandmark = new Map<string, number>(this.vertices.map((v) => [v, Infinity]));

    for (let i = 0; i < k; i++) {
      this.landmarks.push(nextLandmark);
      const dMap = this.runSingleSourceDijkstra(nextLandmark);
      this.landmarkDist.set(nextLandmark, dMap);

      let farthestNode = nextLandmark;
      let maxMinD = -1;
      for (const v of this.vertices) {
        const d = dMap.get(v) ?? Infinity;
        const updatedMin = Math.min(minDistToAnyLandmark.get(v) ?? Infinity, d);
        minDistToAnyLandmark.set(v, updatedMin);
        if (Number.isFinite(updatedMin) && updatedMin > maxMinD) {
          maxMinD = updatedMin;
          farthestNode = v;
        }
      }
      nextLandmark = farthestNode;
    }
  }

  public heuristicBound(u: string, target: string): number {
    let bestBound = 0;
    for (const L of this.landmarks) {
      const dMap = this.landmarkDist.get(L)!;
      const dLu = dMap.get(u) ?? Infinity;
      const dLt = dMap.get(target) ?? Infinity;
      if (Number.isFinite(dLu) && Number.isFinite(dLt)) {
        // By triangle inequality: d(L, u) + d(u, t) >= d(L, t) => d(u, t) >= d(L, t) - d(L, u)
        const bound = Math.max(0, dLt - dLu);
        if (bound > bestBound) bestBound = bound;
      }
    }
    return bestBound;
  }

  public findShortestPath(source: string, target: string): AltShortestPathResult {
    const runSearch = (useHeuristic: boolean) => {
      const gScore = new Map<string, number>(this.vertices.map((v) => [v, Infinity]));
      const fScore = new Map<string, number>(this.vertices.map((v) => [v, Infinity]));
      const prev = new Map<string, string>();
      const closed = new Set<string>();

      gScore.set(source, 0);
      fScore.set(source, useHeuristic ? this.heuristicBound(source, target) : 0);
      let expanded = 0;

      while (closed.size < this.vertices.length) {
        let curr: string | null = null;
        let bestF = Infinity;
        for (const v of this.vertices) {
          if (!closed.has(v) && (fScore.get(v) ?? Infinity) < bestF) {
            bestF = fScore.get(v)!;
            curr = v;
          }
        }
        if (curr === null) break;
        expanded++;
        if (curr === target) break;
        closed.add(curr);

        const gCurr = gScore.get(curr)!;
        for (const edge of this.adj.get(curr) ?? []) {
          if (closed.has(edge.to)) continue;
          const tentativeG = gCurr + edge.weight;
          if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
            prev.set(edge.to, curr);
            gScore.set(edge.to, tentativeG);
            const h = useHeuristic ? this.heuristicBound(edge.to, target) : 0;
            fScore.set(edge.to, tentativeG + h);
          }
        }
      }

      const totalDist = gScore.get(target) ?? Infinity;
      if (!Number.isFinite(totalDist)) {
        return { reachable: false, totalDist: Infinity, path: [] as string[], expanded };
      }
      const path: string[] = [];
      let step: string | undefined = target;
      while (step !== undefined) {
        path.push(step);
        step = prev.get(step);
      }
      path.reverse();
      return { reachable: true, totalDist, path, expanded };
    };

    const altRun = runSearch(true);
    const dijkstraRun = runSearch(false);

    return {
      reachable: altRun.reachable,
      totalDistance: Number.isFinite(altRun.totalDist)
        ? Number(altRun.totalDist.toFixed(6))
        : Infinity,
      path: altRun.path,
      nodesExpandedWithAlt: altRun.expanded,
      nodesExpandedStandardDijkstra: dijkstraRun.expanded,
      selectedLandmarks: [...this.landmarks]
    };
  }
}
