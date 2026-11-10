export interface VerifiedFactEntry {
  key: string;
  value: string;
  sourceUrl?: string;
  verifiedAtStep: number;
}

export interface SubGoalStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  resultSummary?: string;
}

/**
 * Structured Working Memory Scratchpad & Multi-Step Goal Tracker.
 * Maintains verified facts, intermediate deductions, and sub-goal statuses across multi-turn
 * or multi-tool execution so the AI never loses context or repeats already-completed lookups.
 */
export class WorkingMemoryScratchpad {
  private readonly facts = new Map<string, VerifiedFactEntry>();
  private readonly subGoals = new Map<string, SubGoalStep>();
  private readonly hypotheses = new Map<string, { statement: string; status: "testing" | "confirmed" | "refuted" }>();
  private stepCounter = 0;

  public recordVerifiedFact(key: string, value: string, sourceUrl?: string): VerifiedFactEntry {
    this.stepCounter++;
    const entry: VerifiedFactEntry = {
      key: key.trim(),
      value: value.trim(),
      sourceUrl,
      verifiedAtStep: this.stepCounter
    };
    this.facts.set(entry.key, entry);
    return entry;
  }

  public upsertSubGoal(
    id: string,
    description: string,
    status: SubGoalStep["status"],
    resultSummary?: string
  ): SubGoalStep {
    const existing = this.subGoals.get(id);
    const updated: SubGoalStep = {
      id,
      description: description || existing?.description || id,
      status,
      resultSummary: resultSummary ?? existing?.resultSummary
    };
    this.subGoals.set(id, updated);
    return updated;
  }

  public recordHypothesis(
    id: string,
    statement: string,
    status: "testing" | "confirmed" | "refuted"
  ): void {
    this.hypotheses.set(id, { statement, status });
  }

  public getFact(key: string): VerifiedFactEntry | undefined {
    return this.facts.get(key.trim());
  }

  /**
   * Renders a compact, high-density prompt block summarizing verified facts,
   * confirmed/refuted hypotheses, and remaining sub-goals.
   */
  public renderPromptBlock(): string {
    const sections: string[] = [];

    if (this.facts.size > 0) {
      const factLines = Array.from(this.facts.values()).map((f) =>
        f.sourceUrl ? `- ${f.key}: ${f.value} (${f.sourceUrl})` : `- ${f.key}: ${f.value}`
      );
      sections.push(`[WORKING_MEMORY_VERIFIED_FACTS]\n${factLines.join("\n")}`);
    }

    if (this.hypotheses.size > 0) {
      const hypLines = Array.from(this.hypotheses.entries()).map(
        ([id, h]) => `- [${h.status.toUpperCase()}] (${id}) ${h.statement}`
      );
      sections.push(`[WORKING_MEMORY_HYPOTHESES]\n${hypLines.join("\n")}`);
    }

    if (this.subGoals.size > 0) {
      const goalLines = Array.from(this.subGoals.values()).map((g) => {
        const mark =
          g.status === "completed"
            ? "[x]"
            : g.status === "in_progress"
              ? "[/]"
              : g.status === "blocked"
                ? "[!]"
                : "[ ]";
        return `${mark} ${g.id}: ${g.description}${g.resultSummary ? ` -> ${g.resultSummary}` : ""}`;
      });
      sections.push(`[WORKING_MEMORY_SUBGOALS]\n${goalLines.join("\n")}`);
    }

    return sections.join("\n\n");
  }
}
