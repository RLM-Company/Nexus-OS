export interface GoalDriftReport {
  turnIndex: number;
  macroGoalText: string;
  currentTurnText: string;
  alignmentSimilarity: number; // [0..1]
  driftScore: number; // 1 - alignmentSimilarity
  driftDetected: boolean;
  reanchoringDirective: string | null;
}

function extractAnchorKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9\u0400-\u04ff_]{3,}/g) ?? [];
  return new Set(words);
}

/**
 * Semantic Long-Horizon Conversation State Machine & Goal-Drift Detector.
 * Monitors multi-turn agent trajectories against the user's macro-objective and pinned
 * constraints, emitting an immediate Goal Re-Anchoring Directive when intermediate steps drift.
 */
export class ConversationGoalDriftTracker {
  private readonly macroGoalText: string;
  private readonly macroKeywords: Set<string>;
  private readonly pinnedConstraints: string[];
  private turnCount = 0;

  constructor(params: {
    macroGoalText: string;
    pinnedConstraints?: string[];
  }) {
    this.macroGoalText = params.macroGoalText.trim();
    this.pinnedConstraints = [...(params.pinnedConstraints ?? [])];
    this.macroKeywords = extractAnchorKeywords(
      `${this.macroGoalText} ${this.pinnedConstraints.join(" ")}`
    );
  }

  public observeTurnAndCheckDrift(
    turnSummaryOrOutput: string,
    driftThreshold = 0.72
  ): GoalDriftReport {
    this.turnCount++;
    const turnKeywords = extractAnchorKeywords(turnSummaryOrOutput);

    let overlap = 0;
    for (const kw of this.macroKeywords) {
      if (turnKeywords.has(kw)) overlap++;
    }

    const denom = Math.max(1, Math.min(this.macroKeywords.size, Math.max(3, turnKeywords.size)));
    const alignmentSimilarity = Number(Math.min(1.0, overlap / denom).toFixed(4));
    const driftScore = Number((1.0 - alignmentSimilarity).toFixed(4));
    const driftDetected = driftScore >= driftThreshold;

    const reanchoringDirective = driftDetected
      ? [
          `[GOAL_DRIFT_REANCHORING_DIRECTIVE — Turn #${this.turnCount}]`,
          `Primary Macro-Goal: ${this.macroGoalText}`,
          ...(this.pinnedConstraints.length > 0
            ? [`Mandatory Constraints: ${this.pinnedConstraints.join(" | ")}`]
            : []),
          "Refocus the next action strictly on completing the primary macro-goal above."
        ].join("\n")
      : null;

    return {
      turnIndex: this.turnCount,
      macroGoalText: this.macroGoalText,
      currentTurnText: turnSummaryOrOutput,
      alignmentSimilarity,
      driftScore,
      driftDetected,
      reanchoringDirective
    };
  }
}
