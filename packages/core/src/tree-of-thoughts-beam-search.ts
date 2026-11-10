export interface ThoughtCandidateNode {
  id: string;
  parentId: string | null;
  depth: number;
  hypothesisText: string;
  feasibilityScore: number; // [0..1]
  constraintSatisfactionScore: number; // [0..1]
  evidenceGroundingScore: number; // [0..1]
  estimatedCostPenalty: number; // [0..1]
}

export interface EvaluatedThoughtPath {
  leafNodeId: string;
  orderedNodeIds: string[];
  orderedHypotheses: string[];
  cumulativeScore: number;
  prunedNodesCount: number;
}

/**
 * Tree-of-Thoughts (ToT) Multi-Hypothesis Beam Search & Branch Evaluator.
 * Explores multiple competing reasoning paths in parallel, prunes low-scoring or
 * constraint-violating branches, and selects the globally highest-utility reasoning chain.
 */
export class TreeOfThoughtsBeamSearch {
  public static scoreThoughtNode(node: ThoughtCandidateNode): number {
    // Weighted multi-objective utility: 40% constraint satisfaction, 30% evidence grounding, 25% feasibility, -5% cost penalty
    const raw =
      0.4 * node.constraintSatisfactionScore +
      0.3 * node.evidenceGroundingScore +
      0.25 * node.feasibilityScore -
      0.05 * node.estimatedCostPenalty;
    return Number(Math.max(0, Math.min(1, raw)).toFixed(4));
  }

  /**
   * Executes beam search of width `beamWidth` across layered ThoughtCandidateNodes,
   * pruning any branch whose node score falls below `pruneThreshold`.
   */
  public static searchBestReasoningPath(params: {
    nodes: ThoughtCandidateNode[];
    beamWidth?: number;
    pruneThreshold?: number;
  }): EvaluatedThoughtPath {
    const beamWidth = Math.max(1, params.beamWidth ?? 3);
    const pruneThreshold = params.pruneThreshold ?? 0.4;

    if (params.nodes.length === 0) {
      throw new Error("EMPTY_THOUGHT_TREE: require at least one root thought node");
    }

    const byDepth = new Map<number, ThoughtCandidateNode[]>();
    let maxDepth = 0;
    for (const n of params.nodes) {
      if (n.depth > maxDepth) maxDepth = n.depth;
      const list = byDepth.get(n.depth) ?? [];
      list.push(n);
      byDepth.set(n.depth, list);
    }

    interface ActiveBeamPath {
      lastNodeId: string;
      nodeIds: string[];
      hypotheses: string[];
      cumulativeScore: number;
    }

    let activeBeam: ActiveBeamPath[] = [];
    let prunedNodesCount = 0;

    // Initialize depth 0 roots
    const roots = byDepth.get(0) ?? [];
    for (const root of roots) {
      const score = TreeOfThoughtsBeamSearch.scoreThoughtNode(root);
      if (score < pruneThreshold) {
        prunedNodesCount++;
        continue;
      }
      activeBeam.push({
        lastNodeId: root.id,
        nodeIds: [root.id],
        hypotheses: [root.hypothesisText],
        cumulativeScore: score
      });
    }

    activeBeam.sort((a, b) => b.cumulativeScore - a.cumulativeScore);
    activeBeam = activeBeam.slice(0, beamWidth);

    // Expand across depths 1..maxDepth
    for (let d = 1; d <= maxDepth; d++) {
      const layerNodes = byDepth.get(d) ?? [];
      if (layerNodes.length === 0) continue;

      const nextCandidates: ActiveBeamPath[] = [];
      for (const beamPath of activeBeam) {
        const children = layerNodes.filter((n) => n.parentId === beamPath.lastNodeId);
        if (children.length === 0) {
          // Keep terminal path if it has no children at this depth
          nextCandidates.push(beamPath);
          continue;
        }
        for (const child of children) {
          const stepScore = TreeOfThoughtsBeamSearch.scoreThoughtNode(child);
          if (stepScore < pruneThreshold) {
            prunedNodesCount++;
            continue;
          }
          nextCandidates.push({
            lastNodeId: child.id,
            nodeIds: [...beamPath.nodeIds, child.id],
            hypotheses: [...beamPath.hypotheses, child.hypothesisText],
            cumulativeScore: Number(
              ((beamPath.cumulativeScore * beamPath.nodeIds.length + stepScore) /
                (beamPath.nodeIds.length + 1)).toFixed(4)
            )
          });
        }
      }

      if (nextCandidates.length > 0) {
        nextCandidates.sort((a, b) => b.cumulativeScore - a.cumulativeScore);
        activeBeam = nextCandidates.slice(0, beamWidth);
      }
    }

    if (activeBeam.length === 0) {
      throw new Error("ALL_THOUGHT_BRANCHES_PRUNED: no thought branch met the minimum quality threshold");
    }

    const winner = activeBeam[0]!;
    return {
      leafNodeId: winner.lastNodeId,
      orderedNodeIds: winner.nodeIds,
      orderedHypotheses: winner.hypotheses,
      cumulativeScore: winner.cumulativeScore,
      prunedNodesCount
    };
  }
}
