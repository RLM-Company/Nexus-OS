export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: string;
  weight?: number;
}

export interface PprRankedNode {
  nodeId: string;
  pprScore: number;
}

export interface ExtractedSubgraphResult {
  topNodes: PprRankedNode[];
  inducedEdges: KnowledgeGraphEdge[];
  bridgePathsFound: number;
}

/**
 * Personalized PageRank (PPR) & Multi-Entity Subgraph Extractor (GraphRAG Core).
 * Computes Random Walk with Restart (RWR) stationary distribution from query seed entities
 * to extract the most structurally relevant multi-hop subgraph.
 */
export class PersonalizedPageRankSubgraphExtractor {
  public static extractSubgraph(params: {
    edges: KnowledgeGraphEdge[];
    seedNodeIds: string[];
    dampingAlpha?: number; // Teleportation restart probability to seed nodes (default 0.15)
    iterations?: number;
    topK?: number;
  }): ExtractedSubgraphResult {
    const alpha = Math.min(0.5, Math.max(0.05, params.dampingAlpha ?? 0.15));
    const iterations = Math.min(60, Math.max(5, params.iterations ?? 25));
    const topK = Math.max(1, params.topK ?? 8);

    const nodesSet = new Set<string>();
    const outEdges = new Map<string, Array<{ target: string; weight: number }>>();

    const addDirected = (u: string, v: string, w: number) => {
      nodesSet.add(u);
      nodesSet.add(v);
      const list = outEdges.get(u) ?? [];
      list.push({ target: v, weight: w });
      outEdges.set(u, list);
    };

    for (const e of params.edges) {
      const w = Math.max(0.01, e.weight ?? 1.0);
      // Treat knowledge graph edges as bidirectional with 0.5 reverse weight for bridge discovery
      addDirected(e.source, e.target, w);
      addDirected(e.target, e.source, w * 0.5);
    }

    for (const seed of params.seedNodeIds) {
      nodesSet.add(seed);
    }

    const allNodes = Array.from(nodesSet);
    if (allNodes.length === 0) {
      return { topNodes: [], inducedEdges: [], bridgePathsFound: 0 };
    }

    const validSeeds = params.seedNodeIds.filter((s) => nodesSet.has(s));
    const teleportProb = new Map<string, number>();
    if (validSeeds.length > 0) {
      const share = 1.0 / validSeeds.length;
      for (const s of validSeeds) {
        teleportProb.set(s, (teleportProb.get(s) ?? 0) + share);
      }
    } else {
      const uniform = 1.0 / allNodes.length;
      for (const n of allNodes) {
        teleportProb.set(n, uniform);
      }
    }

    // Initialize stationary distribution p^(0) = teleportProb
    let scores = new Map<string, number>(teleportProb);

    // Power Iteration: p^(t+1) = alpha * v_seed + (1 - alpha) * M^T * p^(t)
    for (let iter = 0; iter < iterations; iter++) {
      const nextScores = new Map<string, number>();
      for (const n of allNodes) {
        nextScores.set(n, alpha * (teleportProb.get(n) ?? 0));
      }

      for (const u of allNodes) {
        const uScore = scores.get(u) ?? 0;
        if (uScore <= 1e-12) continue;
        const neighbors = outEdges.get(u) ?? [];
        if (neighbors.length === 0) {
          // Dangling node redistributes mass back to seed vector
          for (const [s, tp] of teleportProb.entries()) {
            nextScores.set(s, (nextScores.get(s) ?? 0) + (1 - alpha) * uScore * tp);
          }
          continue;
        }
        const totalOutWeight = neighbors.reduce((acc, nb) => acc + nb.weight, 0);
        for (const nb of neighbors) {
          const transitionProb = nb.weight / totalOutWeight;
          nextScores.set(
            nb.target,
            (nextScores.get(nb.target) ?? 0) + (1 - alpha) * uScore * transitionProb
          );
        }
      }

      scores = nextScores;
    }

    const ranked: PprRankedNode[] = allNodes
      .map((nodeId) => ({
        nodeId,
        pprScore: Number((scores.get(nodeId) ?? 0).toFixed(6))
      }))
      .sort((a, b) => b.pprScore - a.pprScore)
      .slice(0, topK);

    const selectedSet = new Set(ranked.map((r) => r.nodeId));
    const inducedEdges = params.edges.filter(
      (e) => selectedSet.has(e.source) && selectedSet.has(e.target)
    );

    // Count non-seed intermediate bridge nodes included in topK
    const seedSet = new Set(validSeeds);
    const bridgePathsFound = ranked.filter((r) => !seedSet.has(r.nodeId)).length;

    return {
      topNodes: ranked,
      inducedEdges,
      bridgePathsFound
    };
  }
}
