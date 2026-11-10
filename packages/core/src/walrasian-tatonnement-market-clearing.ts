export interface FisherAgentPreference {
  agentId: string;
  budgetEndowment: number;
  utilityWeightsByResource: Record<string, number>; // Cobb-Douglas weights alpha_{ij} > 0
}

export interface WalrasianEquilibriumResult {
  equilibriumPricesByResource: Record<string, number>;
  allocationsByAgent: Record<string, Record<string, number>>;
  maxExcessDemandNorm: number;
  iterationsExecuted: number;
  converged: boolean;
}

/**
 * Walrasian Tâtonnement Price-Adjustment Auction & Cobb-Douglas Fisher Market Equilibrium Solver.
 * Under Cobb-Douglas utilities u_i(x) = prod_j x_{ij}^{alpha_{ij}} (with sum_j alpha_{ij} = 1),
 * each agent i spends alpha_{ij} * budget_i on resource j, and Walrasian Tâtonnement converges
 * to exact market-clearing prices p_j* where Total Demand == Supply!
 */
export class WalrasianMarketClearingEquilibrium {
  public static computeEquilibrium(params: {
    resourceSupplies: Record<string, number>;
    agents: FisherAgentPreference[];
    learningRateEta?: number;
    maxIterations?: number;
    tolerance?: number;
  }): WalrasianEquilibriumResult {
    const resources = Object.keys(params.resourceSupplies);
    const eta = params.learningRateEta ?? 0.5;
    const maxIter = params.maxIterations ?? 120;
    const tol = params.tolerance ?? 1e-6;

    // Normalize each agent's Cobb-Douglas preference weights so sum_j alpha_{ij} = 1
    const normAgents = params.agents.map((ag) => {
      let sumW = 0;
      for (const r of resources) {
        sumW += Math.max(0, ag.utilityWeightsByResource[r] ?? 0);
      }
      const normW: Record<string, number> = {};
      for (const r of resources) {
        normW[r] =
          sumW <= 1e-12
            ? 1.0 / resources.length
            : Math.max(0, ag.utilityWeightsByResource[r] ?? 0) / sumW;
      }
      return {
        agentId: ag.agentId,
        budget: Math.max(0, ag.budgetEndowment),
        weights: normW
      };
    });

    const prices: Record<string, number> = {};
    for (const r of resources) {
      prices[r] = 1.0;
    }

    let converged = false;
    let iter = 0;
    let maxExcessDemandNorm = 0;

    for (; iter < maxIter; iter++) {
      maxExcessDemandNorm = 0;

      for (const r of resources) {
        const supply = Math.max(1e-9, params.resourceSupplies[r]!);
        const p = Math.max(1e-9, prices[r]!);

        // Total spending on resource r = sum_i (budget_i * alpha_{ir})
        let totalSpendingOnR = 0;
        for (const ag of normAgents) {
          totalSpendingOnR += ag.budget * ag.weights[r]!;
        }

        const demand = totalSpendingOnR / p;
        const relativeExcess = (demand - supply) / supply;
        maxExcessDemandNorm = Math.max(maxExcessDemandNorm, Math.abs(relativeExcess));

        // Walrasian price update
        prices[r] = Math.max(1e-6, p * (1.0 + eta * relativeExcess));
      }

      if (maxExcessDemandNorm <= tol) {
        converged = true;
        iter++;
        break;
      }
    }

    const equilibriumPricesByResource: Record<string, number> = {};
    for (const r of resources) {
      equilibriumPricesByResource[r] = Number(prices[r]!.toFixed(6));
    }

    const allocationsByAgent: Record<string, Record<string, number>> = {};
    for (const ag of normAgents) {
      allocationsByAgent[ag.agentId] = {};
      for (const r of resources) {
        const alloc = (ag.budget * ag.weights[r]!) / prices[r]!;
        allocationsByAgent[ag.agentId]![r] = Number(alloc.toFixed(6));
      }
    }

    return {
      equilibriumPricesByResource,
      allocationsByAgent,
      maxExcessDemandNorm: Number(maxExcessDemandNorm.toFixed(8)),
      iterationsExecuted: iter,
      converged
    };
  }
}
