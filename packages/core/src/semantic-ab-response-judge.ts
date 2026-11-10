import { TestTimeComputeSelfRefineEngine } from "./test-time-compute-self-refine.js";

export interface CandidateResponseScorecard {
  constraintAdherenceScore: number; // 35% weight
  groundingCitationScore: number; // 25% weight
  structuralClarityScore: number; // 15% weight
  completenessScore: number; // 15% weight
  concisenessSignalScore: number; // 10% weight
  totalWeightedScore: number;
}

export interface PairwiseJudgeVerdict {
  winner: "A" | "B" | "tie";
  scorecardA: CandidateResponseScorecard;
  scorecardB: CandidateResponseScorecard;
  margin: number;
  rationale: string;
}

/**
 * Semantic Response Diff, Regression Detector & Pairwise A/B Judge.
 * Objectively scores and compares two candidate AI responses (e.g., Draft vs Self-Refine,
 * or Model A vs Model B) across 5 weighted quality rubrics without human intervention.
 */
export class SemanticAbResponseJudge {
  public static scoreSingleResponse(params: {
    userQuery: string;
    responseText: string;
    requiredTerms?: string[];
    forbiddenTerms?: string[];
  }): CandidateResponseScorecard {
    const text = params.responseText.trim();
    const evalResult = TestTimeComputeSelfRefineEngine.evaluateAndBuildRefinement({
      userQuery: params.userQuery,
      candidateDraft: text,
      requiredTermsOrConstraints: params.requiredTerms,
      forbiddenTerms: params.forbiddenTerms
    });

    // 1. Constraint Adherence (35%)
    const missedConstraints = evalResult.issues.filter(
      (i) => i.category === "missed_constraint"
    ).length;
    const constraintAdherenceScore = Math.max(0, 1.0 - missedConstraints * 0.4);

    // 2. Grounding & Verified Inline Links (25%)
    const markdownLinks = text.match(/\[[^\]]+\]\(https?:\/\/[^\s)]+\)/g)?.length ?? 0;
    const bareBracketRefs = text.match(/\[\d+\]/g)?.length ?? 0;
    const groundingCitationScore = Math.max(
      0,
      Math.min(1.0, 0.5 + markdownLinks * 0.25 - bareBracketRefs * 0.3)
    );

    // 3. Structural Clarity (15%): balanced fences, tables or bullet structure
    const hasUnbalancedFence = evalResult.issues.some(
      (i) => i.category === "unbalanced_code_or_json"
    );
    const hasTableOrList = /(?:\|.*\|.*\n\|[\s:|-]+\||^\s*[-*]\s+)/m.test(text);
    const structuralClarityScore = hasUnbalancedFence ? 0.1 : hasTableOrList ? 1.0 : 0.75;

    // 4. Completeness & Zero Stubs (15%)
    const hasPlaceholder = evalResult.issues.some(
      (i) =>
        i.category === "placeholder_stub_detected" ||
        i.category === "empty_or_truncated" ||
        i.category === "repetition_loop"
    );
    const completenessScore = hasPlaceholder ? 0.0 : 1.0;

    // 5. Conciseness / Signal-to-Noise (10%)
    const hasClichéFluff =
      /^(?:Sure,\s+I\s+can|Of\s+course!|Конечно,\s+я\s+с\s+радостью|In\s+conclusion:)/i.test(
        text
      );
    const concisenessSignalScore = hasClichéFluff ? 0.5 : 1.0;

    const totalWeightedScore = Number(
      (
        0.35 * constraintAdherenceScore +
        0.25 * groundingCitationScore +
        0.15 * structuralClarityScore +
        0.15 * completenessScore +
        0.1 * concisenessSignalScore
      ).toFixed(4)
    );

    return {
      constraintAdherenceScore: Number(constraintAdherenceScore.toFixed(4)),
      groundingCitationScore: Number(groundingCitationScore.toFixed(4)),
      structuralClarityScore: Number(structuralClarityScore.toFixed(4)),
      completenessScore: Number(completenessScore.toFixed(4)),
      concisenessSignalScore: Number(concisenessSignalScore.toFixed(4)),
      totalWeightedScore
    };
  }

  public static compareCandidates(params: {
    userQuery: string;
    candidateA: string;
    candidateB: string;
    requiredTerms?: string[];
    forbiddenTerms?: string[];
  }): PairwiseJudgeVerdict {
    const scorecardA = SemanticAbResponseJudge.scoreSingleResponse({
      userQuery: params.userQuery,
      responseText: params.candidateA,
      requiredTerms: params.requiredTerms,
      forbiddenTerms: params.forbiddenTerms
    });
    const scorecardB = SemanticAbResponseJudge.scoreSingleResponse({
      userQuery: params.userQuery,
      responseText: params.candidateB,
      requiredTerms: params.requiredTerms,
      forbiddenTerms: params.forbiddenTerms
    });

    const diff = Number((scorecardA.totalWeightedScore - scorecardB.totalWeightedScore).toFixed(4));
    const margin = Math.abs(diff);

    let winner: "A" | "B" | "tie" = "tie";
    if (diff > 0.02) winner = "A";
    else if (diff < -0.02) winner = "B";

    return {
      winner,
      scorecardA,
      scorecardB,
      margin,
      rationale:
        winner === "tie"
          ? `Candidates A and B tied (${scorecardA.totalWeightedScore} vs ${scorecardB.totalWeightedScore}).`
          : `Candidate ${winner} won by +${margin} (${scorecardA.totalWeightedScore} vs ${scorecardB.totalWeightedScore}).`
    };
  }
}
