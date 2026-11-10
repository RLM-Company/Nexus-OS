export interface EpsilonAuctionResult {
  agentToItemAssignment: number[];
  totalBenefitValue: number;
  finalItemPrices: number[];
  biddingStepsExecuted: number;
}

/**
 * Dimitri Bertsekas' Epsilon-Scaling Auction Algorithm for Maximum-Benefit Assignment.
 * Solves the N x N linear assignment problem max sum_i A[i][j_i] via iterative epsilon-scaling
 * phases (epsilon -> epsilon / 4 until epsilon < 1 / (N + 1)), guaranteeing exact optimality
 * for integer payoff matrices.
 */
export class BertsekasEpsilonScalingAuctionEngine {
  public static solveMaximumBenefitAssignment(payoffMatrix: number[][]): EpsilonAuctionResult {
    const n = payoffMatrix.length;
    if (n === 0) {
      return {
        agentToItemAssignment: [],
        totalBenefitValue: 0,
        finalItemPrices: [],
        biddingStepsExecuted: 0
      };
    }

    const prices = new Array<number>(n).fill(0);
    const agentToItem = new Array<number>(n).fill(-1);
    const itemToAgent = new Array<number>(n).fill(-1);

    let maxPayoffRange = 1;
    for (const row of payoffMatrix) {
      for (const v of row) {
        if (Math.abs(v) > maxPayoffRange) maxPayoffRange = Math.abs(v);
      }
    }

    let eps = Math.max(1.0, maxPayoffRange / 2);
    const minEps = 1 / (n + 2);
    let totalSteps = 0;

    while (true) {
      agentToItem.fill(-1);
      itemToAgent.fill(-1);
      const unassignedQueue: number[] = Array.from({ length: n }, (_, i) => i);

      while (unassignedQueue.length > 0) {
        totalSteps++;
        const i = unassignedQueue.shift()!;

        // Find best item j* and second-best net value w_i for agent i
        let bestJ = 0;
        let bestNet = -Infinity;
        let secondBestNet = -Infinity;

        for (let j = 0; j < n; j++) {
          const net = payoffMatrix[i]![j]! - prices[j]!;
          if (net > bestNet) {
            secondBestNet = bestNet;
            bestNet = net;
            bestJ = j;
          } else if (net > secondBestNet) {
            secondBestNet = net;
          }
        }

        if (!Number.isFinite(secondBestNet)) secondBestNet = bestNet;
        const bidIncrement = bestNet - secondBestNet + eps;
        prices[bestJ]! += bidIncrement;

        const prevOwner = itemToAgent[bestJ]!;
        if (prevOwner !== -1) {
          agentToItem[prevOwner] = -1;
          unassignedQueue.push(prevOwner);
        }

        agentToItem[i] = bestJ;
        itemToAgent[bestJ] = i;
      }

      if (eps <= minEps) break;
      eps = Math.max(minEps, eps / 4);
    }

    let totalBenefit = 0;
    for (let i = 0; i < n; i++) {
      totalBenefit += payoffMatrix[i]![agentToItem[i]!]!;
    }

    return {
      agentToItemAssignment: agentToItem,
      totalBenefitValue: Number(totalBenefit.toFixed(6)),
      finalItemPrices: prices.map((p) => Number(p.toFixed(6))),
      biddingStepsExecuted: totalSteps
    };
  }
}
