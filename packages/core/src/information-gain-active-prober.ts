export interface CompetingHypothesis {
  id: string;
  description: string;
  priorWeight: number; // Positive weight (will be normalized to sum to 1)
}

export interface DiagnosticProbeCandidate {
  probeId: string;
  questionOrTest: string;
  /**
   * Map of hypothesisId -> likelihood P(probe = true | hypothesisId) in [0.01 .. 0.99]
   */
  likelihoodTrueGivenHypothesis: Record<string, number>;
  costWeight?: number;
}

export interface RankedDiagnosticProbe {
  probeId: string;
  questionOrTest: string;
  expectedInformationGainBits: number;
  posteriorEntropyBits: number;
  utilityPerCost: number;
}

/**
 * Information-Gain Active Probing & Socratic Hypothesis Disambiguator.
 * Selects the single diagnostic test or clarifying question that maximizes Shannon
 * Mutual Information (Expected Information Gain in bits) over competing hypotheses.
 */
export class InformationGainActiveProber {
  public static computeShannonEntropyBits(probabilities: number[]): number {
    let h = 0;
    for (const p of probabilities) {
      if (p > 1e-12) {
        h -= p * Math.log2(p);
      }
    }
    return Number(h.toFixed(6));
  }

  public static selectOptimalProbe(params: {
    hypotheses: CompetingHypothesis[];
    candidateProbes: DiagnosticProbeCandidate[];
  }): {
    initialEntropyBits: number;
    bestProbe: RankedDiagnosticProbe | null;
    rankedProbes: RankedDiagnosticProbe[];
  } {
    if (params.hypotheses.length === 0 || params.candidateProbes.length === 0) {
      return { initialEntropyBits: 0, bestProbe: null, rankedProbes: [] };
    }

    const totalWeight = params.hypotheses.reduce((acc, h) => acc + Math.max(1e-6, h.priorWeight), 0);
    const priors = params.hypotheses.map((h) => Math.max(1e-6, h.priorWeight) / totalWeight);
    const initialEntropyBits = InformationGainActiveProber.computeShannonEntropyBits(priors);

    const rankedProbes: RankedDiagnosticProbe[] = [];

    for (const probe of params.candidateProbes) {
      // Compute marginal probability P(probe = true) = \sum_i P(H_i) * P(probe=true | H_i)
      let pProbeTrue = 0;
      const likelihoods = params.hypotheses.map((h) => {
        const raw = probe.likelihoodTrueGivenHypothesis[h.id] ?? 0.5;
        return Math.min(0.999, Math.max(0.001, raw));
      });

      for (let i = 0; i < priors.length; i++) {
        pProbeTrue += priors[i]! * likelihoods[i]!;
      }
      const pProbeFalse = 1 - pProbeTrue;

      // Bayes' Rule posteriors P(H_i | probe = true) and P(H_i | probe = false)
      const postGivenTrue = priors.map((pr, i) =>
        pProbeTrue > 1e-12 ? (pr * likelihoods[i]!) / pProbeTrue : pr
      );
      const postGivenFalse = priors.map((pr, i) =>
        pProbeFalse > 1e-12 ? (pr * (1 - likelihoods[i]!)) / pProbeFalse : pr
      );

      const hGivenTrue = InformationGainActiveProber.computeShannonEntropyBits(postGivenTrue);
      const hGivenFalse = InformationGainActiveProber.computeShannonEntropyBits(postGivenFalse);

      const expectedPosteriorEntropy = pProbeTrue * hGivenTrue + pProbeFalse * hGivenFalse;
      const infoGain = Math.max(0, initialEntropyBits - expectedPosteriorEntropy);
      const cost = Math.max(0.1, probe.costWeight ?? 1.0);

      rankedProbes.push({
        probeId: probe.probeId,
        questionOrTest: probe.questionOrTest,
        expectedInformationGainBits: Number(infoGain.toFixed(6)),
        posteriorEntropyBits: Number(expectedPosteriorEntropy.toFixed(6)),
        utilityPerCost: Number((infoGain / cost).toFixed(6))
      });
    }

    rankedProbes.sort((a, b) => b.utilityPerCost - a.utilityPerCost);

    return {
      initialEntropyBits,
      bestProbe: rankedProbes[0] ?? null,
      rankedProbes
    };
  }
}
