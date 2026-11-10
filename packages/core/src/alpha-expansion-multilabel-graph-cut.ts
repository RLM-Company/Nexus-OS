import { SubmodularMarkovRandomFieldGraphCut } from "./mrf-binary-submodular-graph-cut.ts";

export interface MultiLabelAlphaExpansionResult {
  optimalLabelsByNode: Record<string, number>;
  finalEnergy: number;
  expansionSweepsExecuted: number;
}

/**
 * Boykov, Veksler & Zabih (2001) Alpha-Expansion Multi-Label MRF Energy Minimizer.
 * Iteratively cycles through each candidate label alpha in {0..L-1} and solves an exact
 * binary s-t graph-cut move problem where every node i chooses between keeping its current
 * label f_i (binary 0) or switching to alpha (binary 1). Guaranteed within 2x of global optimum.
 */
export class BoykovVekslerAlphaExpansionOptimizer {
  public static computeTotalEnergy(
    nodes: string[],
    labelsByNode: Record<string, number>,
    unaryCostByNodeAndLabel: Record<string, number[]>,
    edges: Array<{ u: string; v: string; pottsPenaltyLambda: number }>
  ): number {
    let e = 0;
    for (const n of nodes) {
      const lbl = labelsByNode[n]!;
      e += unaryCostByNodeAndLabel[n]?.[lbl] ?? 0;
    }
    for (const edge of edges) {
      if (labelsByNode[edge.u] !== labelsByNode[edge.v]) {
        e += edge.pottsPenaltyLambda;
      }
    }
    return Number(e.toFixed(6));
  }

  public static optimizeMultiLabelPottsMrf(params: {
    nodes: string[];
    numLabelsL: number;
    unaryCostByNodeAndLabel: Record<string, number[]>;
    edges: Array<{ u: string; v: string; pottsPenaltyLambda: number }>;
    maxSweeps?: number;
  }): MultiLabelAlphaExpansionResult {
    const { nodes, numLabelsL, unaryCostByNodeAndLabel, edges } = params;
    const maxSweeps = params.maxSweeps ?? 5;

    // Initialize every node to its greedy unary-minimum label
    const currentLabels: Record<string, number> = {};
    for (const n of nodes) {
      const costs = unaryCostByNodeAndLabel[n] ?? [0];
      let bestL = 0;
      for (let l = 1; l < numLabelsL; l++) {
        if ((costs[l] ?? Infinity) < (costs[bestL] ?? Infinity)) bestL = l;
      }
      currentLabels[n] = bestL;
    }

    let currentEnergy = BoykovVekslerAlphaExpansionOptimizer.computeTotalEnergy(
      nodes,
      currentLabels,
      unaryCostByNodeAndLabel,
      edges
    );

    let sweeps = 0;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      sweeps++;
      let improvedInSweep = false;

      for (let alpha = 0; alpha < numLabelsL; alpha++) {
        // Binary subproblem: x_i = 0 means keep currentLabels[i] (!== alpha), x_i = 1 means label alpha.
        // Nodes already having currentLabels[i] === alpha are pinned to x_i = 1 (costLabel0 = 1e9).
        const unaries = nodes.map((nodeId) => {
          const curLbl = currentLabels[nodeId]!;
          const alphaCost = unaryCostByNodeAndLabel[nodeId]?.[alpha] ?? 0;
          const keepCost =
            curLbl === alpha
              ? alphaCost + 1e9
              : (unaryCostByNodeAndLabel[nodeId]?.[curLbl] ?? 0);
          return {
            nodeId,
            costLabel0: keepCost,
            costLabel1: alphaCost
          };
        });

        const pairwise = edges.map((e) => ({
          u: e.u,
          v: e.v,
          disagreementPenaltyLambda: e.pottsPenaltyLambda
        }));

        const cutRes = SubmodularMarkovRandomFieldGraphCut.minimizeBinaryEnergy(
          unaries,
          pairwise
        );

        const candidateLabels: Record<string, number> = {};
        for (const n of nodes) {
          candidateLabels[n] =
            cutRes.optimalLabelsByNode[n] === 1 ? alpha : currentLabels[n]!;
        }

        const candidateEnergy = BoykovVekslerAlphaExpansionOptimizer.computeTotalEnergy(
          nodes,
          candidateLabels,
          unaryCostByNodeAndLabel,
          edges
        );

        if (candidateEnergy + 1e-9 < currentEnergy) {
          for (const n of nodes) currentLabels[n] = candidateLabels[n]!;
          currentEnergy = candidateEnergy;
          improvedInSweep = true;
        }
      }

      if (!improvedInSweep) break;
    }

    return {
      optimalLabelsByNode: currentLabels,
      finalEnergy: currentEnergy,
      expansionSweepsExecuted: sweeps
    };
  }
}
