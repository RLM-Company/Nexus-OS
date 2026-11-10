export interface ApspAnalysisResult {
  distanceMatrix: Record<string, Record<string, number>>;
  hasNegativeCycle: boolean;
  graphDiameter: number;
  graphRadius: number;
  centerNodes: string[];
}

/**
 * Floyd-Warshall All-Pairs Shortest Paths (APSP), Negative-Cycle Detector,
 * and Graph Eccentricity / Diameter / Radius / Center Topology Analyzer.
 */
export class AllPairsShortestPathAndMinMeanCycleEngine {
  public static analyzeGraph(
    nodes: string[],
    directedEdges: Array<{ from: string; to: string; weight: number }>
  ): ApspAnalysisResult {
    const n = nodes.length;
    const idxMap = new Map<string, number>();
    nodes.forEach((id, idx) => idxMap.set(id, idx));

    const dist: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => (i === j ? 0 : Infinity))
    );

    for (const e of directedEdges) {
      const u = idxMap.get(e.from);
      const v = idxMap.get(e.to);
      if (u !== undefined && v !== undefined) {
        dist[u]![v] = Math.min(dist[u]![v]!, e.weight);
      }
    }

    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        if (dist[i]![k] === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (dist[k]![j] === Infinity) continue;
          const cand = dist[i]![k]! + dist[k]![j]!;
          if (cand < dist[i]![j]!) {
            dist[i]![j] = cand;
          }
        }
      }
    }

    let hasNegativeCycle = false;
    for (let i = 0; i < n; i++) {
      if (dist[i]![i]! < 0) {
        hasNegativeCycle = true;
        break;
      }
    }

    const distanceMatrix: Record<string, Record<string, number>> = {};
    let graphDiameter = 0;
    let graphRadius = Infinity;
    const eccentricities = new Map<string, number>();

    for (let i = 0; i < n; i++) {
      const uId = nodes[i]!;
      distanceMatrix[uId] = {};
      let ecc = 0;
      for (let j = 0; j < n; j++) {
        const vId = nodes[j]!;
        const d = dist[i]![j]!;
        distanceMatrix[uId]![vId] = Number.isFinite(d) ? Number(d.toFixed(6)) : Infinity;
        if (i !== j && Number.isFinite(d)) {
          ecc = Math.max(ecc, d);
        }
      }
      eccentricities.set(uId, ecc);
      graphDiameter = Math.max(graphDiameter, ecc);
      if (ecc > 0) {
        graphRadius = Math.min(graphRadius, ecc);
      }
    }

    if (!Number.isFinite(graphRadius)) graphRadius = 0;
    const centerNodes = nodes.filter(
      (id) => Math.abs((eccentricities.get(id) ?? 0) - graphRadius) <= 1e-9
    );

    return {
      distanceMatrix,
      hasNegativeCycle,
      graphDiameter: Number(graphDiameter.toFixed(6)),
      graphRadius: Number(graphRadius.toFixed(6)),
      centerNodes
    };
  }
}
