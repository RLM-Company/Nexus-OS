import { AdaptiveAiParameterController } from "./adaptive-ai-parameter-controller.js";

export type ReasoningExecutionMode = "fast_single_pass" | "deep_self_refine";

export interface QueryComplexityAssessment {
  executionMode: ReasoningExecutionMode;
  complexityScore: number; // [0.0 .. 1.0]
  recommendedThinkingBudgetTokens: number;
  recommendedTemperature: number;
  extractedHardConstraints: string[];
  reasons: string[];
}

export interface DraftCritiqueIssue {
  category:
    | "missed_constraint"
    | "placeholder_stub_detected"
    | "unbalanced_code_or_json"
    | "repetition_loop"
    | "empty_or_truncated";
  severity: "critical" | "warning";
  description: string;
  remediationDirective: string;
}

export interface SelfRefineEvaluationResult {
  passed: boolean;
  qualityScore: number; // [0.0 .. 1.0]
  issues: DraftCritiqueIssue[];
  refinementPrompt: string | null;
  refinedParameters: {
    temperature: number;
    topP: number;
    repetitionPenalty: number;
    thinkingBudgetTokens: number;
  };
}

/**
 * Test-Time Compute & Multi-Pass Self-Refine Reasoning Pipeline.
 * Automatically routes complex queries into a System-2 (Draft -> Critique -> Refine) loop
 * and audits drafts for missed constraints, placeholder stubs, unbalanced code fences, and repetition loops.
 */
export class TestTimeComputeSelfRefineEngine {
  /**
   * Evaluates whether a user request requires fast single-pass execution (System 1)
   * or multi-pass Test-Time Compute with self-refinement (System 2).
   */
  public static assessQueryComplexity(params: {
    userQuery: string;
    explicitConstraints?: string[];
    modeOverride?: "auto" | "fast" | "deep_self_refine";
  }): QueryComplexityAssessment {
    const q = params.userQuery.trim();
    const reasons: string[] = [];
    let score = 0.15;

    // Extract inline negative or numeric constraints from the user query
    const extractedHardConstraints: string[] = [...(params.explicitConstraints ?? [])];
    const negativeMatches =
      q.match(/(?:не используй|без\s+[\u0400-\u04ffa-z0-9_-]+|не трогай|never use|do not modify|must not)\s*[^.,;\n]*/gi) ??
      [];
    for (const m of negativeMatches) {
      const cleaned = m.trim();
      if (cleaned && !extractedHardConstraints.includes(cleaned)) {
        extractedHardConstraints.push(cleaned);
      }
    }

    if (q.length > 250) {
      score += 0.2;
      reasons.push("long_multi_clause_prompt");
    }
    if (
      /(архитектур|спроектируй|реализуй|код|алгоритм|миграци|безопасност|сравни|проанализируй|implement|architect|optimize|refactor|verify|debug)/i.test(
        q
      )
    ) {
      score += 0.35;
      reasons.push("technical_or_analytical_depth");
    }
    if (extractedHardConstraints.length > 0) {
      score += Math.min(0.3, extractedHardConstraints.length * 0.12);
      reasons.push(`hard_constraints_present(${extractedHardConstraints.length})`);
    }
    if (/(шаг за шагом|пошагово|максимум|полный стек|step by step|comprehensive)/i.test(q)) {
      score += 0.2;
      reasons.push("explicit_depth_request");
    }

    const complexityScore = Number(Math.min(1.0, score).toFixed(2));
    let executionMode: ReasoningExecutionMode =
      complexityScore >= 0.45 ? "deep_self_refine" : "fast_single_pass";

    if (params.modeOverride === "fast") {
      executionMode = "fast_single_pass";
    } else if (params.modeOverride === "deep_self_refine") {
      executionMode = "deep_self_refine";
    }

    const recommendedThinkingBudgetTokens =
      executionMode === "deep_self_refine"
        ? Math.min(32_768, Math.max(4_096, Math.round((complexityScore * 16_384) / 1024) * 1024))
        : 0;

    const recommendedTemperature = executionMode === "deep_self_refine" ? 0.15 : 0.35;

    return {
      executionMode,
      complexityScore,
      recommendedThinkingBudgetTokens,
      recommendedTemperature,
      extractedHardConstraints,
      reasons
    };
  }

  /**
   * Audits a candidate model draft against hard constraints, code completeness,
   * placeholder bans (`TODO`, `[Insert ...]`), and repetition loops.
   * If defects are found, generates a targeted Self-Refine prompt and tightened decoding parameters.
   */
  public static evaluateAndBuildRefinement(params: {
    userQuery: string;
    candidateDraft: string;
    requiredTermsOrConstraints?: string[];
    forbiddenTerms?: string[];
    currentTemperature?: number;
  }): SelfRefineEvaluationResult {
    const draft = params.candidateDraft.trim();
    const issues: DraftCritiqueIssue[] = [];

    // 1. Check for empty or trivially truncated output
    if (draft.length < 10) {
      issues.push({
        category: "empty_or_truncated",
        severity: "critical",
        description: "Candidate draft is empty or shorter than 10 characters.",
        remediationDirective: "Provide a complete, substantive response addressing the user query."
      });
    }

    // 2. Check for banned lazy placeholders (`// TODO`, `/* TODO */`, `[Insert Date]`, `...rest of code...`)
    const placeholderMatch = draft.match(
      /(?:\/\/\s*TODO\b|\/\*\s*TODO\b|\[Insert\s+[^\]]+\]|\/\/\s*\.\.\.\s*rest of)/i
    );
    if (placeholderMatch) {
      issues.push({
        category: "placeholder_stub_detected",
        severity: "critical",
        description: `Detected lazy placeholder or stub: '${placeholderMatch[0]}'`,
        remediationDirective:
          "Replace all TODO comments and bracketed placeholders with complete, working implementation."
      });
    }

    // 3. Check for unbalanced markdown code fences (```)
    const fenceCount = (draft.match(/```/g) ?? []).length;
    if (fenceCount % 2 !== 0) {
      issues.push({
        category: "unbalanced_code_or_json",
        severity: "critical",
        description: "Unclosed Markdown code block fence (odd number of ``` delimiters).",
        remediationDirective:
          "Ensure every opened code block is properly completed and closed with ```."
      });
    }

    // 4. Check required terms / constraints
    for (const req of params.requiredTermsOrConstraints ?? []) {
      const normalizedReq = req.trim().toLowerCase();
      if (normalizedReq && !draft.toLowerCase().includes(normalizedReq)) {
        issues.push({
          category: "missed_constraint",
          severity: "critical",
          description: `Draft omitted required constraint or entity: '${req}'`,
          remediationDirective: `Explicitly incorporate and address '${req}' in the revised response.`
        });
      }
    }

    // 5. Check forbidden terms (negative constraints)
    for (const forbidden of params.forbiddenTerms ?? []) {
      const normalizedForb = forbidden.trim().toLowerCase();
      if (normalizedForb && draft.toLowerCase().includes(normalizedForb)) {
        issues.push({
          category: "missed_constraint",
          severity: "critical",
          description: `Draft violated negative constraint by including forbidden term: '${forbidden}'`,
          remediationDirective: `Remove all occurrences of '${forbidden}' and rewrite without it.`
        });
      }
    }

    // 6. Check for 4-gram repetition loops
    const loopAudit = AdaptiveAiParameterController.detectRepetitionLoop(draft, 5);
    if (loopAudit.loopDetected) {
      issues.push({
        category: "repetition_loop",
        severity: "critical",
        description: `Detected repetitive token loop ('${loopAudit.repeatedNgram ?? "low entropy"}', count=${loopAudit.repeatCount}).`,
        remediationDirective:
          "Eliminate repeated phrases and state each point once clearly and concisely."
      });
    }

    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const passed = criticalCount === 0;
    const qualityScore = Number(Math.max(0, 1.0 - issues.length * 0.25).toFixed(2));

    const baseTemp = params.currentTemperature ?? 0.2;
    const hasLoop = issues.some((i) => i.category === "repetition_loop");

    const refinedParameters = {
      temperature: hasLoop ? Math.min(0.6, baseTemp + 0.15) : Math.max(0.05, Number((baseTemp * 0.5).toFixed(3))),
      topP: 0.85,
      repetitionPenalty: hasLoop ? 1.2 : 1.05,
      thinkingBudgetTokens: passed ? 0 : 8192
    };

    const refinementPrompt = passed
      ? null
      : [
          "[SELF_REFINE_CRITIQUE_PASS]",
          "Your previous draft had the following verification issues that must be corrected before responding to the user:",
          ...issues.map((iss, idx) => `${idx + 1}. [${iss.category}] ${iss.description} -> ${iss.remediationDirective}`),
          "",
          "Produce the corrected, complete final response now without mentioning this internal critique pass."
        ].join("\n");

    return {
      passed,
      qualityScore,
      issues,
      refinementPrompt,
      refinedParameters
    };
  }
}
