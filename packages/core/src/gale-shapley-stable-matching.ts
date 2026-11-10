export interface StableMatchingResult {
  proposerToReviewer: Record<string, string>;
  reviewerToProposer: Record<string, string>;
  isStableZeroBlockingPairs: boolean;
  blockingPairs: Array<{ proposer: string; reviewer: string }>;
}

/**
 * Gale-Shapley Deferred Acceptance Stable Matching & Blocking-Pair Stability Verifier.
 * Guarantees proposer-optimal stable matching in O(N^2) proposals with zero blocking pairs.
 */
export class GaleShapleyStableMatchingEngine {
  public static computeStableMatching(params: {
    proposerPreferences: Record<string, string[]>;
    reviewerPreferences: Record<string, string[]>;
  }): StableMatchingResult {
    const proposers = Object.keys(params.proposerPreferences);
    const nextProposalIdx = new Map<string, number>();
    const freeProposers: string[] = [];

    for (const p of proposers) {
      nextProposalIdx.set(p, 0);
      freeProposers.push(p);
    }

    // Build O(1) rank lookup for reviewers: lower rank = higher preference
    const reviewerRank = new Map<string, Map<string, number>>();
    for (const [rev, prefs] of Object.entries(params.reviewerPreferences)) {
      const rankMap = new Map<string, number>();
      prefs.forEach((p, idx) => rankMap.set(p, idx));
      reviewerRank.set(rev, rankMap);
    }

    const reviewerPartner = new Map<string, string>();
    const proposerPartner = new Map<string, string>();

    while (freeProposers.length > 0) {
      const p = freeProposers.shift()!;
      const prefs = params.proposerPreferences[p] ?? [];
      const idx = nextProposalIdx.get(p) ?? 0;
      if (idx >= prefs.length) continue;

      const targetReviewer = prefs[idx]!;
      nextProposalIdx.set(p, idx + 1);

      const currentFiance = reviewerPartner.get(targetReviewer);
      if (!currentFiance) {
        reviewerPartner.set(targetReviewer, p);
        proposerPartner.set(p, targetReviewer);
      } else {
        const ranks = reviewerRank.get(targetReviewer);
        const rankNew = ranks?.get(p) ?? Infinity;
        const rankCurrent = ranks?.get(currentFiance) ?? Infinity;

        if (rankNew < rankCurrent) {
          reviewerPartner.set(targetReviewer, p);
          proposerPartner.set(p, targetReviewer);
          proposerPartner.delete(currentFiance);
          freeProposers.push(currentFiance);
        } else {
          freeProposers.push(p);
        }
      }
    }

    // Verify stability: check if any (p, r) prefer each other over their assigned partners
    const blockingPairs: Array<{ proposer: string; reviewer: string }> = [];
    for (const p of proposers) {
      const assignedRev = proposerPartner.get(p);
      const pPrefs = params.proposerPreferences[p] ?? [];
      for (const r of pPrefs) {
        if (r === assignedRev) break; // Only check reviewers that `p` strictly prefers over `assignedRev`
        const rAssignedProp = reviewerPartner.get(r);
        const ranks = reviewerRank.get(r);
        const rankP = ranks?.get(p) ?? Infinity;
        const rankRAssigned = rAssignedProp ? (ranks?.get(rAssignedProp) ?? Infinity) : Infinity;
        if (rankP < rankRAssigned) {
          blockingPairs.push({ proposer: p, reviewer: r });
        }
      }
    }

    return {
      proposerToReviewer: Object.fromEntries(proposerPartner.entries()),
      reviewerToProposer: Object.fromEntries(reviewerPartner.entries()),
      isStableZeroBlockingPairs: blockingPairs.length === 0,
      blockingPairs
    };
  }
}
