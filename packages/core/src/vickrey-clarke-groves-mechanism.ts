export interface VcgBid {
  bidderId: string;
  unitsRequested: number;
  valuationValue: number; // True utility valuation v_i
}

export interface VcgWinnerSettlement {
  bidderId: string;
  unitsAllocated: number;
  reportedValuation: number;
  vcgClarkeTaxPayment: number;
  netUtilitySurplus: number;
}

export interface VcgAuctionOutcome {
  totalSocialWelfare: number;
  totalRevenueCollected: number;
  winners: VcgWinnerSettlement[];
}

/**
 * Vickrey-Clarke-Groves (VCG) Strategy-Proof Combinatorial Resource Auction Engine.
 * Selects the subset of bidders that maximizes Total Social Welfare under capacity constraint C,
 * and charges each winner i the exact Clarke Pivot Externality Tax:
 *   payment_i = maxWelfareWithout(i) - (maxWelfareWithAll - v_i)
 * guaranteeing Incentive Compatibility (truthful bidding is a dominant strategy).
 */
export class VcgTruthfulMechanismAuction {
  private static solveKnapsackOptimalAllocation(
    bids: VcgBid[],
    totalCapacityUnits: number
  ): { maxWelfare: number; chosenBidderIds: Set<string> } {
    const n = bids.length;
    const C = Math.max(0, Math.floor(totalCapacityUnits));

    // dp[i][w] = max social welfare using subset of first i bidders with capacity w
    const dp: Float64Array[] = Array.from(
      { length: n + 1 },
      () => new Float64Array(C + 1)
    );

    for (let i = 1; i <= n; i++) {
      const bid = bids[i - 1]!;
      const u = Math.max(1, Math.floor(bid.unitsRequested));
      const v = Math.max(0, bid.valuationValue);
      for (let w = 0; w <= C; w++) {
        dp[i]![w] = dp[i - 1]![w]!;
        if (w >= u) {
          const cand = dp[i - 1]![w - u]! + v;
          if (cand > dp[i]![w]!) {
            dp[i]![w] = cand;
          }
        }
      }
    }

    const chosenBidderIds = new Set<string>();
    let remW = C;
    for (let i = n; i >= 1; i--) {
      if (Math.abs(dp[i]![remW]! - dp[i - 1]![remW]!) > 1e-9) {
        const bid = bids[i - 1]!;
        chosenBidderIds.add(bid.bidderId);
        remW -= Math.max(1, Math.floor(bid.unitsRequested));
      }
    }

    return {
      maxWelfare: dp[n]![C]!,
      chosenBidderIds
    };
  }

  public static runTruthfulAuction(
    bids: VcgBid[],
    totalCapacityUnits: number
  ): VcgAuctionOutcome {
    const optimalAll = VcgTruthfulMechanismAuction.solveKnapsackOptimalAllocation(
      bids,
      totalCapacityUnits
    );

    const winners: VcgWinnerSettlement[] = [];
    let totalRevenueCollected = 0;

    for (const bid of bids) {
      if (!optimalAll.chosenBidderIds.has(bid.bidderId)) continue;

      const bidsWithoutI = bids.filter((b) => b.bidderId !== bid.bidderId);
      const optimalWithoutI = VcgTruthfulMechanismAuction.solveKnapsackOptimalAllocation(
        bidsWithoutI,
        totalCapacityUnits
      );

      const welfareOfOthersWhenIPresent = optimalAll.maxWelfare - bid.valuationValue;
      const clarkeTax = Math.max(
        0,
        optimalWithoutI.maxWelfare - welfareOfOthersWhenIPresent
      );
      const surplus = bid.valuationValue - clarkeTax;

      totalRevenueCollected += clarkeTax;
      winners.push({
        bidderId: bid.bidderId,
        unitsAllocated: bid.unitsRequested,
        reportedValuation: Number(bid.valuationValue.toFixed(6)),
        vcgClarkeTaxPayment: Number(clarkeTax.toFixed(6)),
        netUtilitySurplus: Number(surplus.toFixed(6))
      });
    }

    return {
      totalSocialWelfare: Number(optimalAll.maxWelfare.toFixed(6)),
      totalRevenueCollected: Number(totalRevenueCollected.toFixed(6)),
      winners
    };
  }
}
