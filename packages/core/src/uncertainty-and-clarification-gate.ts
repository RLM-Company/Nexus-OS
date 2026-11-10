export interface CandidateMatchRecord {
  id: string;
  label: string;
  distinguishingDetail: string;
  sourceUrl?: string;
}

export interface UncertaintyCheckInput {
  userQuery: string;
  intendedActionKind: "read_only_research" | "file_generation" | "mutating_external_or_destructive";
  missingRequiredParameters?: string[];
  ambiguousEntityCandidates?: Record<string, CandidateMatchRecord[]>;
  conflictingContextFacts?: Array<{
    topic: string;
    olderValue: string;
    newerValue: string;
    explicitlySuperseded: boolean;
  }>;
  unblockedSubtasks?: string[];
}

export interface UncertaintyGateDecision {
  status: "proceed_autonomously" | "execute_unblocked_then_ask" | "halt_and_clarify";
  epistemicUncertaintyScore: number; // [0.0 .. 1.0]
  unblockedSubtasksToRunNow: string[];
  clarificationQuestions: string[];
  resolvedFacts: Record<string, string>;
}

/**
 * Epistemic Uncertainty Quantification & Smart Clarification Gate.
 * Prevents hallucinated assumptions on ambiguous/destructive actions while maximizing
 * autonomous execution of unblocked work before asking concise, concrete questions.
 */
export class UncertaintyAndClarificationGate {
  public static evaluateTurnUncertainty(input: UncertaintyCheckInput): UncertaintyGateDecision {
    const missing = input.missingRequiredParameters ?? [];
    const ambiguities = input.ambiguousEntityCandidates ?? {};
    const conflicts = input.conflictingContextFacts ?? [];
    const unblocked = input.unblockedSubtasks ?? [];

    const clarificationQuestions: string[] = [];
    const resolvedFacts: Record<string, string> = {};
    let uncertaintyScore = 0;

    // 1. Evaluate conflicting context records (newer supersedes older ONLY when explicitlySuperseded === true)
    for (const conflict of conflicts) {
      if (conflict.explicitlySuperseded) {
        resolvedFacts[conflict.topic] = conflict.newerValue;
      } else {
        uncertaintyScore += 0.35;
        clarificationQuestions.push(
          `По параметру «${conflict.topic}» найдены противоречивые данные («${conflict.olderValue}» и «${conflict.newerValue}»). Какое значение использовать?`
        );
      }
    }

    // 2. Evaluate ambiguous entity references (> 1 plausible candidate)
    for (const [entityName, candidates] of Object.entries(ambiguities)) {
      if (candidates.length === 1) {
        resolvedFacts[entityName] = candidates[0]!.id;
      } else if (candidates.length > 1) {
        uncertaintyScore += 0.4;
        const optionsText = candidates
          .map((c) => `«${c.label}» (${c.distinguishingDetail})`)
          .join(" или ");
        clarificationQuestions.push(
          `Для «${entityName}» найдено несколько вариантов: ${optionsText}. Какой именно выбрать?`
        );
      }
    }

    // 3. Evaluate missing required parameters
    if (missing.length > 0) {
      uncertaintyScore += Math.min(0.6, missing.length * 0.25);
      clarificationQuestions.push(
        `Уточни, пожалуйста, недостающие параметры для выполнения: ${missing.join(", ")}.`
      );
    }

    // 4. Amplify caution for mutating/destructive actions
    if (
      input.intendedActionKind === "mutating_external_or_destructive" &&
      clarificationQuestions.length > 0
    ) {
      uncertaintyScore = Math.max(0.85, uncertaintyScore);
    }

    const clampedScore = Number(Math.min(1.0, uncertaintyScore).toFixed(2));

    if (clarificationQuestions.length === 0) {
      return {
        status: "proceed_autonomously",
        epistemicUncertaintyScore: clampedScore,
        unblockedSubtasksToRunNow: unblocked,
        clarificationQuestions: [],
        resolvedFacts
      };
    }

    if (unblocked.length > 0 && input.intendedActionKind !== "mutating_external_or_destructive") {
      return {
        status: "execute_unblocked_then_ask",
        epistemicUncertaintyScore: clampedScore,
        unblockedSubtasksToRunNow: unblocked,
        clarificationQuestions,
        resolvedFacts
      };
    }

    return {
      status: "halt_and_clarify",
      epistemicUncertaintyScore: clampedScore,
      unblockedSubtasksToRunNow: [],
      clarificationQuestions,
      resolvedFacts
    };
  }
}
