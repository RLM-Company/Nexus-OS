export interface TtcAgentPreference {
  agentId: string;
  initialEndowedItemId: string;
  strictPreferenceOrderItemIds: string[];
}

export interface TtcMarketClearingResult {
  finalAllocationByAgent: Record<string, string>;
  cyclesClearedByRound: Array<{ round: number; cycleAgents: string[]; tradedItems: string[] }>;
  individuallyRationalVerified: boolean;
}

/**
 * David Gale's Top Trading Cycles (TTC) Algorithm for Shapley-Scarf Indivisible Resource Markets.
 * In each round, every remaining agent points to the owner of their most preferred remaining item.
 * Because the finite graph has out-degree 1, at least one directed cycle exists; all such cycles
 * are cleared simultaneously, yielding the unique strict core allocation (Pareto-efficient & strategy-proof).
 */
export class ShapleyScarfTopTradingCyclesEngine {
  public static clearMarket(agents: TtcAgentPreference[]): TtcMarketClearingResult {
    const remainingAgents = new Set<string>(agents.map((a) => a.agentId));
    const remainingItems = new Set<string>(agents.map((a) => a.initialEndowedItemId));

    const ownerByItem = new Map<string, string>();
    const prefByAgent = new Map<string, string[]>();
    const initialByAgent = new Map<string, string>();

    for (const a of agents) {
      ownerByItem.set(a.initialEndowedItemId, a.agentId);
      prefByAgent.set(a.agentId, [...a.strictPreferenceOrderItemIds]);
      initialByAgent.set(a.agentId, a.initialEndowedItemId);
    }

    const finalAllocationByAgent: Record<string, string> = {};
    const cyclesClearedByRound: Array<{
      round: number;
      cycleAgents: string[];
      tradedItems: string[];
    }> = [];

    let round = 0;
    while (remainingAgents.size > 0) {
      round++;
      // Each remaining agent points to the current owner of their top remaining preferred item
      const nextAgentPointer = new Map<string, string>();
      const topItemChoice = new Map<string, string>();

      for (const agentId of remainingAgents) {
        const prefs = prefByAgent.get(agentId) ?? [];
        const bestItem =
          prefs.find((item) => remainingItems.has(item)) ?? initialByAgent.get(agentId)!;
        topItemChoice.set(agentId, bestItem);
        nextAgentPointer.set(agentId, ownerByItem.get(bestItem)!);
      }

      // Detect all disjoint cycles among remainingAgents
      const globallyVisited = new Set<string>();
      for (const startAgent of remainingAgents) {
        if (globallyVisited.has(startAgent)) continue;
        const path: string[] = [];
        const posInPath = new Map<string, number>();
        let curr = startAgent;

        while (!globallyVisited.has(curr) && !posInPath.has(curr)) {
          posInPath.set(curr, path.length);
          path.push(curr);
          curr = nextAgentPointer.get(curr)!;
        }

        for (const node of path) globallyVisited.add(node);

        if (posInPath.has(curr)) {
          const cycleStart = posInPath.get(curr)!;
          const cycleAgents = path.slice(cycleStart);
          const tradedItems = cycleAgents.map((ag) => topItemChoice.get(ag)!);

          cyclesClearedByRound.push({
            round,
            cycleAgents,
            tradedItems
          });

          for (let i = 0; i < cycleAgents.length; i++) {
            const ag = cycleAgents[i]!;
            const item = tradedItems[i]!;
            finalAllocationByAgent[ag] = item;
            remainingAgents.delete(ag);
            remainingItems.delete(item);
          }
        }
      }
    }

    // Verify individual rationality: every agent gets an item at least as preferred as their initial endowment
    let individuallyRationalVerified = true;
    for (const a of agents) {
      const assigned = finalAllocationByAgent[a.agentId]!;
      const assignedRank = a.strictPreferenceOrderItemIds.indexOf(assigned);
      const initialRank = a.strictPreferenceOrderItemIds.indexOf(a.initialEndowedItemId);
      if (assignedRank !== -1 && initialRank !== -1 && assignedRank > initialRank) {
        individuallyRationalVerified = false;
      }
    }

    return {
      finalAllocationByAgent,
      cyclesClearedByRound,
      individuallyRationalVerified
    };
  }
}
