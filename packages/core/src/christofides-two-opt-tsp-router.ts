export interface WaypointPoint2D {
  id: string;
  x: number;
  y: number;
}

export interface MetricTspTourResult {
  orderedStopIds: string[];
  initialChristofidesCost: number;
  optimizedTwoOptCost: number;
  twoOptSwapsPerformed: number;
}

/**
 * Metric Traveling Salesperson & Multi-Waypoint Router combining a Christofides
 * MST + Odd-Degree Minimum Weight Matching Eulerian Tour with 2-Opt Local Search Refinement.
 */
export class MetricTspChristofidesTwoOptRouter {
  public static dist(a: WaypointPoint2D, b: WaypointPoint2D): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  public static computeTourCost(order: number[], pts: WaypointPoint2D[]): number {
    if (order.length <= 1) return 0;
    let total = 0;
    for (let i = 0; i < order.length; i++) {
      const u = pts[order[i]!]!;
      const v = pts[order[(i + 1) % order.length]!]!;
      total += MetricTspChristofidesTwoOptRouter.dist(u, v);
    }
    return Number(total.toFixed(6));
  }

  public static solveMetricTsp(waypoints: WaypointPoint2D[]): MetricTspTourResult {
    const n = waypoints.length;
    if (n === 0) {
      return {
        orderedStopIds: [],
        initialChristofidesCost: 0,
        optimizedTwoOptCost: 0,
        twoOptSwapsPerformed: 0
      };
    }
    if (n <= 2) {
      const idx = waypoints.map((_, i) => i);
      const cost = MetricTspChristofidesTwoOptRouter.computeTourCost(idx, waypoints);
      return {
        orderedStopIds: waypoints.map((w) => w.id),
        initialChristofidesCost: cost,
        optimizedTwoOptCost: cost,
        twoOptSwapsPerformed: 0
      };
    }

    // 1. Prim's Minimum Spanning Tree (MST)
    const inMst = new Array<boolean>(n).fill(false);
    const parent = new Array<number>(n).fill(-1);
    const minEdge = new Array<number>(n).fill(Infinity);
    minEdge[0] = 0;

    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let step = 0; step < n; step++) {
      let u = -1;
      for (let i = 0; i < n; i++) {
        if (!inMst[i] && (u === -1 || minEdge[i]! < minEdge[u]!)) {
          u = i;
        }
      }
      inMst[u] = true;
      if (parent[u]! !== -1) {
        adj[u]!.push(parent[u]!);
        adj[parent[u]!]!.push(u);
      }
      for (let v = 0; v < n; v++) {
        if (!inMst[v]) {
          const d = MetricTspChristofidesTwoOptRouter.dist(waypoints[u]!, waypoints[v]!);
          if (d < minEdge[v]!) {
            minEdge[v] = d;
            parent[v] = u;
          }
        }
      }
    }

    // 2. Identify odd-degree vertices in MST and pair them via greedy minimum-weight matching
    const oddVertices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (adj[i]!.length % 2 === 1) {
        oddVertices.push(i);
      }
    }
    const matchedOdd = new Set<number>();
    const oddPairs: Array<{ u: number; v: number; d: number }> = [];
    for (let i = 0; i < oddVertices.length; i++) {
      for (let j = i + 1; j < oddVertices.length; j++) {
        const u = oddVertices[i]!;
        const v = oddVertices[j]!;
        oddPairs.push({
          u,
          v,
          d: MetricTspChristofidesTwoOptRouter.dist(waypoints[u]!, waypoints[v]!)
        });
      }
    }
    oddPairs.sort((a, b) => a.d - b.d);
    for (const pair of oddPairs) {
      if (!matchedOdd.has(pair.u) && !matchedOdd.has(pair.v)) {
        matchedOdd.add(pair.u);
        matchedOdd.add(pair.v);
        adj[pair.u]!.push(pair.v);
        adj[pair.v]!.push(pair.u);
      }
    }

    // 3. Hierholzer's Eulerian circuit + Hamiltonian shortcutting
    const multiAdj = adj.map((neighbors) => [...neighbors]);
    const stack = [0];
    const eulerCircuit: number[] = [];
    while (stack.length > 0) {
      const u = stack[stack.length - 1]!;
      if (multiAdj[u]!.length > 0) {
        const v = multiAdj[u]!.pop()!;
        const revIdx = multiAdj[v]!.indexOf(u);
        if (revIdx !== -1) multiAdj[v]!.splice(revIdx, 1);
        stack.push(v);
      } else {
        eulerCircuit.push(stack.pop()!);
      }
    }

    const visited = new Set<number>();
    const tour: number[] = [];
    for (const node of eulerCircuit) {
      if (!visited.has(node)) {
        visited.add(node);
        tour.push(node);
      }
    }

    const initialCost = MetricTspChristofidesTwoOptRouter.computeTourCost(tour, waypoints);

    // 4. 2-Opt Local Search Uncrossing Refinement
    let swaps = 0;
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n - 1; i++) {
        for (let k = i + 2; k < n; k++) {
          if (i === 0 && k === n - 1) continue;
          const a = waypoints[tour[i]!]!;
          const b = waypoints[tour[(i + 1) % n]!]!;
          const c = waypoints[tour[k]!]!;
          const d = waypoints[tour[(k + 1) % n]!]!;

          const currentEdges =
            MetricTspChristofidesTwoOptRouter.dist(a, b) +
            MetricTspChristofidesTwoOptRouter.dist(c, d);
          const swappedEdges =
            MetricTspChristofidesTwoOptRouter.dist(a, c) +
            MetricTspChristofidesTwoOptRouter.dist(b, d);

          if (swappedEdges + 1e-9 < currentEdges) {
            // Reverse segment tour[i+1 .. k]
            let left = i + 1;
            let right = k;
            while (left < right) {
              const tmp = tour[left]!;
              tour[left] = tour[right]!;
              tour[right] = tmp;
              left++;
              right--;
            }
            swaps++;
            improved = true;
          }
        }
      }
    }

    const optimizedCost = MetricTspChristofidesTwoOptRouter.computeTourCost(tour, waypoints);
    return {
      orderedStopIds: tour.map((idx) => waypoints[idx]!.id),
      initialChristofidesCost: initialCost,
      optimizedTwoOptCost: optimizedCost,
      twoOptSwapsPerformed: swaps
    };
  }
}
