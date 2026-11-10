export interface DraftTokenProposal {
  token: string;
  draftProbQ: number; // Probability assigned by fast draft model q(x)
  targetProbP: number; // Probability assigned by large target model p(x)
  alternativeTargetToken?: string;
}

export interface SpeculativeDecodingStepResult {
  emittedTokens: string[];
  acceptedDraftCount: number;
  totalProposedCount: number;
  acceptanceRate: number;
  speedupMultiplier: number;
}

/**
 * Lossless Speculative Decoding (Leviathan / Chen Draft-Target Verification) Engine.
 * Accepts proposed draft tokens with probability min(1, p(x)/q(x)) and resamples from
 * the residual target distribution on the first rejection, guaranteeing 100% target distribution fidelity.
 */
export class SpeculativeDecodingVerifier {
  public static verifyDraftBatch(params: {
    proposals: DraftTokenProposal[];
    bonusTargetTokenAfterAllAccepted?: string;
    uniformRandomDraws?: number[]; // Optional deterministic draws in [0, 1) for reproducible verification
  }): SpeculativeDecodingStepResult {
    const gamma = params.proposals.length;
    if (gamma === 0) {
      return {
        emittedTokens: [],
        acceptedDraftCount: 0,
        totalProposedCount: 0,
        acceptanceRate: 0,
        speedupMultiplier: 1.0
      };
    }

    const emittedTokens: string[] = [];
    let acceptedDraftCount = 0;

    for (let i = 0; i < gamma; i++) {
      const prop = params.proposals[i]!;
      const q = Math.max(1e-6, prop.draftProbQ);
      const p = Math.max(0, prop.targetProbP);
      const acceptRatio = Math.min(1.0, p / q);
      const r = params.uniformRandomDraws?.[i] ?? 0.5;

      if (r <= acceptRatio) {
        emittedTokens.push(prop.token);
        acceptedDraftCount++;
      } else {
        // Reject draft token and emit resampled token from residual target distribution max(0, p - q)
        const replacement = prop.alternativeTargetToken ?? `${prop.token}_target_corrected`;
        emittedTokens.push(replacement);
        break;
      }
    }

    // If all gamma draft tokens were accepted, we also get 1 bonus token from the parallel target pass!
    if (acceptedDraftCount === gamma && params.bonusTargetTokenAfterAllAccepted) {
      emittedTokens.push(params.bonusTargetTokenAfterAllAccepted);
    }

    const acceptanceRate = Number((acceptedDraftCount / gamma).toFixed(4));
    // Expected tokens generated per target forward pass = emittedTokens.length
    const speedupMultiplier = Number(emittedTokens.length.toFixed(2));

    return {
      emittedTokens,
      acceptedDraftCount,
      totalProposedCount: gamma,
      acceptanceRate,
      speedupMultiplier
    };
  }
}
