export type AiTaskProfileKind =
  | "deterministic_code_and_sql"
  | "analytical_research_and_grounding"
  | "manager_dag_planning"
  | "adversarial_critic_audit"
  | "creative_synthesis_and_brainstorm";

export type ReasoningEffortLevel = "low" | "medium" | "high" | "max";

export interface AiInferenceHyperparameters {
  profileKind: AiTaskProfileKind;
  protocol: "openai-compatible" | "anthropic-compatible" | "mock";
  modelId: string;
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  repetitionPenalty: number;
  reasoningEffort: ReasoningEffortLevel;
  thinkingBudgetTokens: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  stopSequences: string[];
  seed?: number;
}

export interface TaskComplexitySignals {
  taskKind: AiTaskProfileKind;
  modelId?: string;
  protocol?: "openai-compatible" | "anthropic-compatible" | "mock";
  estimatedPromptTokens: number;
  dagStepCount?: number;
  toolDefinitionsCount?: number;
  requiresExtendedThinking?: boolean;
  retryAttempt?: number;
  previousFailureReason?: "json_truncation" | "repetition_loop" | "tool_schema_error" | "timeout";
  ownerOverrides?: Partial<{
    temperature: number;
    topP: number;
    topK: number;
    minP: number;
    presencePenalty: number;
    frequencyPenalty: number;
    repetitionPenalty: number;
    thinkingBudgetTokens: number;
    maxOutputTokens: number;
    seed: number;
  }>;
}

export interface RepetitionLoopAudit {
  loopDetected: boolean;
  repeatedNgram: string | null;
  repeatCount: number;
  compressionEntropyRatio: number;
}

const BASE_PROFILES: Record<
  AiTaskProfileKind,
  {
    temperature: number;
    topP: number;
    topK: number;
    minP: number;
    presencePenalty: number;
    frequencyPenalty: number;
    repetitionPenalty: number;
    baseThinkingTokens: number;
  }
> = {
  deterministic_code_and_sql: {
    temperature: 0.05,
    topP: 0.85,
    topK: 20,
    minP: 0.08,
    presencePenalty: 0.0,
    frequencyPenalty: 0.0,
    repetitionPenalty: 1.02,
    baseThinkingTokens: 4096
  },
  analytical_research_and_grounding: {
    temperature: 0.2,
    topP: 0.9,
    topK: 40,
    minP: 0.05,
    presencePenalty: 0.0,
    frequencyPenalty: 0.05,
    repetitionPenalty: 1.05,
    baseThinkingTokens: 8192
  },
  manager_dag_planning: {
    temperature: 0.15,
    topP: 0.88,
    topK: 30,
    minP: 0.06,
    presencePenalty: 0.0,
    frequencyPenalty: 0.0,
    repetitionPenalty: 1.03,
    baseThinkingTokens: 6144
  },
  adversarial_critic_audit: {
    temperature: 0.1,
    topP: 0.85,
    topK: 25,
    minP: 0.07,
    presencePenalty: 0.0,
    frequencyPenalty: 0.0,
    repetitionPenalty: 1.04,
    baseThinkingTokens: 4096
  },
  creative_synthesis_and_brainstorm: {
    temperature: 0.75,
    topP: 0.95,
    topK: 64,
    minP: 0.03,
    presencePenalty: 0.15,
    frequencyPenalty: 0.1,
    repetitionPenalty: 1.08,
    baseThinkingTokens: 2048
  }
};

function clamp(val: number, min: number, max: number): number {
  return Number(Math.min(max, Math.max(min, val)).toFixed(4));
}

/**
 * Adaptive AI Hyperparameter, Decoding & Reasoning Budget Controller.
 * Tunes sampling parameters (temperature, top_p, top_k, min_p, penalties), thinking token budgets,
 * and self-healing retry perturbations for Fable 5 (1.0M), Sol (1.05M), GPT-5.5, and Claude Sonnet 5.
 */
export class AdaptiveAiParameterController {
  public static resolveModelLimits(modelId: string): {
    contextWindowTokens: number;
    defaultMaxOutputTokens: number;
  } {
    const normalized = modelId.toLowerCase();
    if (normalized.includes("sol")) {
      return { contextWindowTokens: 1_050_000, defaultMaxOutputTokens: 100_000 };
    }
    if (normalized.includes("fable")) {
      return { contextWindowTokens: 1_000_000, defaultMaxOutputTokens: 100_000 };
    }
    return { contextWindowTokens: 100_000, defaultMaxOutputTokens: 16_384 };
  }

  /**
   * Computes optimal inference hyperparameters and thinking budgets given task complexity,
   * retry state, protocol constraints, and optional owner overrides.
   */
  public static computeHyperparameters(signals: TaskComplexitySignals): AiInferenceHyperparameters {
    const modelId = signals.modelId ?? "claude-fable-5";
    const protocol = signals.protocol ?? "openai-compatible";
    const base = BASE_PROFILES[signals.taskKind];
    const limits = AdaptiveAiParameterController.resolveModelLimits(modelId);

    let temperature = base.temperature;
    let topP = base.topP;
    let topK = base.topK;
    let minP = base.minP;
    let presencePenalty = base.presencePenalty;
    let frequencyPenalty = base.frequencyPenalty;
    let repetitionPenalty = base.repetitionPenalty;

    // 1. Scale thinking budget by DAG depth and tool count
    const dagSteps = Math.max(1, signals.dagStepCount ?? 1);
    const toolCount = Math.max(0, signals.toolDefinitionsCount ?? 0);
    const complexityMultiplier = 1 + Math.min(2.5, (dagSteps - 1) * 0.25 + toolCount * 0.08);

    let thinkingBudgetTokens = signals.requiresExtendedThinking === false
      ? 0
      : Math.round((base.baseThinkingTokens * complexityMultiplier) / 1024) * 1024;

    thinkingBudgetTokens = Math.min(32_768, Math.max(0, thinkingBudgetTokens));

    let reasoningEffort: ReasoningEffortLevel = "low";
    if (thinkingBudgetTokens >= 16_384) {
      reasoningEffort = "max";
    } else if (thinkingBudgetTokens >= 8_192) {
      reasoningEffort = "high";
    } else if (thinkingBudgetTokens >= 4_096) {
      reasoningEffort = "medium";
    }

    // 2. Apply self-healing retry adaptations if previous attempt failed
    const retry = Math.max(0, signals.retryAttempt ?? 0);
    let maxOutputTokens = signals.ownerOverrides?.maxOutputTokens ?? limits.defaultMaxOutputTokens;

    if (retry > 0) {
      if (signals.previousFailureReason === "repetition_loop") {
        // Increase repetition/frequency penalties and slightly Perturb temperature to break out of degenerate cycle
        repetitionPenalty = clamp(repetitionPenalty + 0.12 * retry, 1.0, 1.5);
        frequencyPenalty = clamp(frequencyPenalty + 0.2 * retry, 0.0, 1.0);
        temperature = clamp(temperature + 0.15 * retry, 0.0, 1.0);
      } else if (signals.previousFailureReason === "tool_schema_error") {
        // Cool down temperature toward 0 for strict grammar adherence
        temperature = clamp(temperature * Math.pow(0.5, retry), 0.0, 1.0);
        topP = clamp(topP - 0.05 * retry, 0.5, 1.0);
      } else if (signals.previousFailureReason === "json_truncation") {
        maxOutputTokens = Math.min(100_000, Math.round(maxOutputTokens * 1.5));
      }
    }

    // 3. Apply and clamp explicit owner overrides
    if (signals.ownerOverrides) {
      const ov = signals.ownerOverrides;
      if (ov.temperature !== undefined) temperature = clamp(ov.temperature, 0.0, 1.5);
      if (ov.topP !== undefined) topP = clamp(ov.topP, 0.05, 1.0);
      if (ov.topK !== undefined) topK = Math.min(200, Math.max(1, Math.round(ov.topK)));
      if (ov.minP !== undefined) minP = clamp(ov.minP, 0.0, 0.5);
      if (ov.presencePenalty !== undefined) presencePenalty = clamp(ov.presencePenalty, -2.0, 2.0);
      if (ov.frequencyPenalty !== undefined) frequencyPenalty = clamp(ov.frequencyPenalty, -2.0, 2.0);
      if (ov.repetitionPenalty !== undefined) repetitionPenalty = clamp(ov.repetitionPenalty, 1.0, 2.0);
      if (ov.thinkingBudgetTokens !== undefined) {
        thinkingBudgetTokens = Math.min(65_536, Math.max(0, Math.round(ov.thinkingBudgetTokens)));
      }
    }

    // 4. Enforce available context window safety margin
    const remainingWindow = Math.max(2048, limits.contextWindowTokens - signals.estimatedPromptTokens);
    maxOutputTokens = Math.min(100_000, Math.min(maxOutputTokens, remainingWindow));

    // Ensure thinking budget never exceeds 75% of maxOutputTokens
    if (thinkingBudgetTokens >= maxOutputTokens) {
      thinkingBudgetTokens = Math.floor(maxOutputTokens * 0.5);
    }

    // 5. Protocol-specific invariant: Anthropic extended thinking requires temperature = 1.0 when thinkingBudgetTokens > 0
    if (protocol === "anthropic-compatible" && thinkingBudgetTokens >= 1024) {
      temperature = 1.0;
    }

    return {
      profileKind: signals.taskKind,
      protocol,
      modelId,
      temperature,
      topP,
      topK,
      minP,
      presencePenalty,
      frequencyPenalty,
      repetitionPenalty,
      reasoningEffort,
      thinkingBudgetTokens,
      maxOutputTokens,
      contextWindowTokens: limits.contextWindowTokens,
      stopSequences: ["</tool_call>", "<|endoftext|>"],
      seed: signals.ownerOverrides?.seed
    };
  }

  /**
   * Detects degenerate token/phrase repetition loops in generated model text using sliding 4-gram frequencies.
   */
  public static detectRepetitionLoop(text: string, thresholdRepeats = 5): RepetitionLoopAudit {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 16) {
      return {
        loopDetected: false,
        repeatedNgram: null,
        repeatCount: 0,
        compressionEntropyRatio: 1.0
      };
    }

    const ngramCounts = new Map<string, number>();
    let maxNgram: string | null = null;
    let maxCount = 0;

    for (let i = 0; i <= words.length - 4; i++) {
      const ngram = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`.toLowerCase();
      const next = (ngramCounts.get(ngram) ?? 0) + 1;
      ngramCounts.set(ngram, next);
      if (next > maxCount) {
        maxCount = next;
        maxNgram = ngram;
      }
    }

    const uniqueNgrams = ngramCounts.size;
    const totalNgrams = Math.max(1, words.length - 3);
    const compressionEntropyRatio = Number((uniqueNgrams / totalNgrams).toFixed(4));

    return {
      loopDetected: maxCount >= thresholdRepeats || compressionEntropyRatio < 0.35,
      repeatedNgram: maxCount >= thresholdRepeats ? maxNgram : null,
      repeatCount: maxCount,
      compressionEntropyRatio
    };
  }
}
