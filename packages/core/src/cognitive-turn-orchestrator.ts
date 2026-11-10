import {
  AdaptiveAiParameterController,
  type AiInferenceHyperparameters,
  type AiTaskProfileKind
} from "./adaptive-ai-parameter-controller.js";
import {
  AdaptivePersonaAndPromptComposer,
  type CognitiveRole,
  type InferredUserStyleProfile
} from "./adaptive-persona-and-prompt-composer.js";
import {
  TestTimeComputeSelfRefineEngine,
  type QueryComplexityAssessment,
  type SelfRefineEvaluationResult
} from "./test-time-compute-self-refine.js";
import {
  UncertaintyAndClarificationGate,
  type UncertaintyCheckInput,
  type UncertaintyGateDecision
} from "./uncertainty-and-clarification-gate.js";
import { WorkingMemoryScratchpad } from "./working-memory-scratchpad.js";
import {
  DynamicFewShotSelector,
  type SelectedExemplarsResult
} from "./dynamic-few-shot-selector.js";
import {
  LostInTheMiddleContextReranker,
  type ContextChunkItem,
  type UShapedContextLayout
} from "./lost-in-the-middle-context-reranker.js";
import {
  MultiHopQueryDecomposer,
  type MultiHopDecompositionPlan
} from "./multi-hop-query-decomposer.js";

export interface PrepareCognitiveTurnInput {
  role: CognitiveRole;
  taskKind: AiTaskProfileKind;
  userQuery: string;
  recentUserMessages?: string[];
  modelId?: string;
  protocol?: "openai-compatible" | "anthropic-compatible" | "mock";
  estimatedPromptTokens: number;
  dagStepCount?: number;
  toolDefinitionsCount?: number;
  mandatoryConstraints?: string[];
  retrievedContextChunks?: ContextChunkItem[];
  ownerSettings?: {
    customSystemPrompt?: string | null;
    autoAdaptStyle?: boolean;
    defaultReasoningMode?: "auto" | "fast" | "deep_self_refine";
    customTemperature?: number | null;
    customTopP?: number | null;
    customThinkingBudget?: number | null;
    learnedStyleProfile?: Partial<InferredUserStyleProfile>;
  };
  uncertaintyCheck?: Omit<UncertaintyCheckInput, "userQuery">;
  scratchpad?: WorkingMemoryScratchpad;
}

export interface PreparedCognitiveTurn {
  systemPrompt: string;
  inferredStyle: InferredUserStyleProfile;
  complexityAssessment: QueryComplexityAssessment;
  hyperparameters: AiInferenceHyperparameters;
  uncertaintyDecision: UncertaintyGateDecision;
  selectedFewShots: SelectedExemplarsResult;
  uShapedContextLayout: UShapedContextLayout;
  multiHopPlan: MultiHopDecompositionPlan;
}

/**
 * Unified Cognitive Turn Orchestrator (16-Module Full Cognitive Architecture).
 * Connects Persona/Style Adaptation, Custom System Prompts, Epistemic Uncertainty Gating,
 * Working Memory Scratchpad, Dynamic MMR Few-Shot Selection, U-Shaped Context Re-Ranking,
 * Multi-Hop Query Decomposition, Test-Time Compute Sizing, and Multi-Pass Self-Refinement.
 */
export class CognitiveTurnOrchestrator {
  public static prepareTurn(input: PrepareCognitiveTurnInput): PreparedCognitiveTurn {
    // 1. Decompose compound multi-hop queries into parallelizable sub-question waves
    const multiHopPlan = MultiHopQueryDecomposer.decomposeQuery(input.userQuery);

    // 2. Assess query complexity & extract inline negative/hard constraints
    const effectiveDagSteps = Math.max(input.dagStepCount ?? 1, multiHopPlan.hops.length);
    const complexityAssessment = TestTimeComputeSelfRefineEngine.assessQueryComplexity({
      userQuery: input.userQuery,
      explicitConstraints: input.mandatoryConstraints,
      modeOverride: input.ownerSettings?.defaultReasoningMode ?? "auto"
    });

    // 3. Evaluate epistemic uncertainty & clarification gate
    const uncertaintyDecision = UncertaintyAndClarificationGate.evaluateTurnUncertainty({
      userQuery: input.userQuery,
      intendedActionKind: input.uncertaintyCheck?.intendedActionKind ?? "read_only_research",
      missingRequiredParameters: input.uncertaintyCheck?.missingRequiredParameters,
      ambiguousEntityCandidates: input.uncertaintyCheck?.ambiguousEntityCandidates,
      conflictingContextFacts: input.uncertaintyCheck?.conflictingContextFacts,
      unblockedSubtasks: input.uncertaintyCheck?.unblockedSubtasks
    });

    // 4. Select non-redundant In-Context Learning (ICL) Few-Shot exemplars via MMR
    const fewShotSelector = new DynamicFewShotSelector();
    const selectedFewShots = fewShotSelector.selectExemplarsMmr({
      userQuery: input.userQuery,
      taskKind: input.taskKind,
      maxCount: 2,
      maxTokensBudget: 220
    });

    // 5. Arrange retrieved context chunks into U-Shaped Primacy/Recency layout ("Lost-in-the-Middle" mitigation)
    const uShapedContextLayout = LostInTheMiddleContextReranker.arrangeUShapedContext(
      input.retrievedContextChunks ?? []
    );

    // 6. Compose adaptive system prompt + custom system prompt + pinned constraints + working memory + few-shots
    const allHistory = [...(input.recentUserMessages ?? []), input.userQuery];
    const composed = AdaptivePersonaAndPromptComposer.composeAdaptiveSystemPrompt({
      role: input.role,
      customSystemPrompt: input.ownerSettings?.customSystemPrompt,
      autoAdaptStyle: input.ownerSettings?.autoAdaptStyle ?? true,
      recentUserMessages: allHistory,
      persistedStyleProfile: input.ownerSettings?.learnedStyleProfile,
      mandatoryConstraints: complexityAssessment.extractedHardConstraints
    });

    let finalSystemPrompt = composed.systemPrompt;
    if (selectedFewShots.formattedPromptBlock) {
      finalSystemPrompt += `\n\n${selectedFewShots.formattedPromptBlock}`;
    }
    if (input.scratchpad) {
      const scratchpadBlock = input.scratchpad.renderPromptBlock();
      if (scratchpadBlock) {
        finalSystemPrompt += `\n\n${scratchpadBlock}`;
      }
    }

    // 7. Compute calibrated decoding & thinking budget hyperparameters
    const effectiveThinkingOverride =
      input.ownerSettings?.customThinkingBudget !== undefined &&
      input.ownerSettings?.customThinkingBudget !== null
        ? input.ownerSettings.customThinkingBudget
        : complexityAssessment.recommendedThinkingBudgetTokens;

    const hyperparameters = AdaptiveAiParameterController.computeHyperparameters({
      taskKind: input.taskKind,
      modelId: input.modelId,
      protocol: input.protocol,
      estimatedPromptTokens: input.estimatedPromptTokens + selectedFewShots.totalTokensUsed,
      dagStepCount: effectiveDagSteps,
      toolDefinitionsCount: input.toolDefinitionsCount,
      requiresExtendedThinking: complexityAssessment.executionMode === "deep_self_refine",
      ownerOverrides: {
        temperature: input.ownerSettings?.customTemperature ?? undefined,
        topP: input.ownerSettings?.customTopP ?? undefined,
        thinkingBudgetTokens: effectiveThinkingOverride
      }
    });

    return {
      systemPrompt: finalSystemPrompt,
      inferredStyle: composed.inferredStyle,
      complexityAssessment,
      hyperparameters,
      uncertaintyDecision,
      selectedFewShots,
      uShapedContextLayout,
      multiHopPlan
    };
  }

  public static verifyAndRefineDraft(params: {
    userQuery: string;
    candidateDraft: string;
    requiredTermsOrConstraints?: string[];
    forbiddenTerms?: string[];
    currentTemperature?: number;
  }): SelfRefineEvaluationResult {
    return TestTimeComputeSelfRefineEngine.evaluateAndBuildRefinement(params);
  }
}
