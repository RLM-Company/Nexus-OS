export type CognitiveRole = "manager" | "architect" | "coder" | "analyst" | "critic" | "assistant";

export type DetectedFormality = "casual_peer" | "polite_formal" | "technical_direct";
export type DetectedVerbosity = "concise" | "balanced" | "detailed";

export interface InferredUserStyleProfile {
  primaryLanguage: "ru" | "en" | "mixed";
  formality: DetectedFormality;
  verbosity: DetectedVerbosity;
  prefersNoFluff: boolean;
  prefersCodeFirst: boolean;
  confidence: number;
}

export interface ComposeSystemPromptInput {
  role: CognitiveRole;
  customSystemPrompt?: string | null;
  autoAdaptStyle?: boolean;
  recentUserMessages?: string[];
  persistedStyleProfile?: Partial<InferredUserStyleProfile>;
  mandatoryConstraints?: string[];
}

export interface ComposedSystemPromptResult {
  systemPrompt: string;
  inferredStyle: InferredUserStyleProfile;
  appliedCustomSystemPrompt: boolean;
  pinnedConstraintsCount: number;
}

const ROLE_COGNITIVE_FOUNDATIONS: Record<CognitiveRole, string> = {
  manager:
    "You are Kosmora Manager — an autonomous orchestrator that decomposes complex goals into verifiable DAG steps, delegates deterministically, and never drops user constraints.",
  architect:
    "You are Kosmora Systems Architect — you design fault-tolerant, zero-dependency, high-throughput software and database schemas with explicit invariants and boundary checks.",
  coder:
    "You are Kosmora Principal Engineer — you write production-ready, complete code without placeholders, TODO stubs, or unverified assumptions.",
  analyst:
    "You are Kosmora Lead Research Analyst — you ground every factual claim, metric, and date in verified primary sources and surface contradictions explicitly.",
  critic:
    "You are Kosmora Adversarial Critic — you audit drafts for logical flaws, missed constraints, security hazards, and ungrounded claims before final delivery.",
  assistant:
    "You are Kosmora AI — a capable, direct, and adaptable collaborator that combines deep analytical reasoning with clear, practical execution."
};

/**
 * Adaptive Persona, Live Conversational Style Mirroring & Custom System Prompt Composer.
 * Allows users to specify a custom system prompt in settings AND/OR let the AI automatically
 * adapt its tone, formality ("на ты" vs "на вы"), language, and conciseness to the user's messages.
 */
export class AdaptivePersonaAndPromptComposer {
  /**
   * Analyzes recent user messages to infer their preferred communication language,
   * formality ("на ты" / casual peer vs "на вы" / formal), verbosity, and technical focus.
   * Avoids ASCII-only \b boundaries so Unicode/Cyrillic tokens match accurately.
   */
  public static inferUserCommunicationStyle(
    recentUserMessages: string[],
    priorProfile?: Partial<InferredUserStyleProfile>
  ): InferredUserStyleProfile {
    const joined = recentUserMessages.join("\n").trim();
    if (!joined) {
      return {
        primaryLanguage: priorProfile?.primaryLanguage ?? "ru",
        formality: priorProfile?.formality ?? "casual_peer",
        verbosity: priorProfile?.verbosity ?? "balanced",
        prefersNoFluff: priorProfile?.prefersNoFluff ?? true,
        prefersCodeFirst: priorProfile?.prefersCodeFirst ?? false,
        confidence: priorProfile?.confidence ?? 0.5
      };
    }

    const cyrillicMatches = joined.match(/[\u0400-\u04ff]/g)?.length ?? 0;
    const latinMatches = joined.match(/[a-zA-Z]/g)?.length ?? 0;

    let primaryLanguage: "ru" | "en" | "mixed" = "ru";
    if (cyrillicMatches > 0 && latinMatches > 0) {
      const ratio = cyrillicMatches / (cyrillicMatches + latinMatches);
      if (ratio >= 0.35) {
        primaryLanguage = "ru";
      } else if (ratio <= 0.1) {
        primaryLanguage = "en";
      } else {
        primaryLanguage = "mixed";
      }
    } else if (latinMatches > 0 && cyrillicMatches === 0) {
      primaryLanguage = "en";
    }

    const lower = joined.toLowerCase();
    const casualMarkers =
      /(?:^|[\s,.!?])(давай|ты|твой|можешь|сделай|собери|продолжаем|хватит|дропаем|ок|го|hey|let's|can u)(?=$|[\s,.!?])/i.test(
        lower
      );
    const formalMarkers =
      /(будьте добры|не могли бы вы|предоставьте|уважаемый|прошу вас|kindly provide)/i.test(
        lower
      );
    const codeMarkers =
      /(код|скрипт|функци|таблиц|миграци|sql|typescript|node|api|json|zip|git|баг|тест)/i.test(
        lower
      );
    const brevityRequest =
      /(коротко|кратко|без воды|по делу|только суть|briefly|concise|tl;dr|no fluff)/i.test(
        lower
      );
    const deepExplanationRequest =
      /(подробно|разберемся|объясни|для чего|как работают|детально|in depth|explain how)/i.test(
        lower
      );

    const avgMsgLen =
      recentUserMessages.reduce((acc, m) => acc + m.trim().length, 0) /
      Math.max(1, recentUserMessages.length);

    let formality: DetectedFormality = priorProfile?.formality ?? "casual_peer";
    if (formalMarkers && !casualMarkers) {
      formality = "polite_formal";
    } else if (casualMarkers) {
      formality = "casual_peer";
    } else if (codeMarkers && avgMsgLen < 120) {
      formality = "technical_direct";
    }

    let verbosity: DetectedVerbosity = priorProfile?.verbosity ?? "balanced";
    if (brevityRequest) {
      verbosity = "concise";
    } else if (deepExplanationRequest) {
      verbosity = "detailed";
    } else if (avgMsgLen < 60 && !deepExplanationRequest) {
      verbosity = "concise";
    }

    const prefersNoFluff = brevityRequest || casualMarkers || (priorProfile?.prefersNoFluff ?? true);
    const prefersCodeFirst = codeMarkers || (priorProfile?.prefersCodeFirst ?? false);
    const confidence = Number(
      Math.min(0.98, 0.55 + Math.min(recentUserMessages.length, 6) * 0.07).toFixed(2)
    );

    return {
      primaryLanguage,
      formality,
      verbosity,
      prefersNoFluff,
      prefersCodeFirst,
      confidence
    };
  }

  /**
   * Composes the final System Prompt combining:
   * 1. Cognitive Role Foundation
   * 2. User's Custom System Prompt from Settings (if set)
   * 3. Dynamic Conversational Style Mirroring (if autoAdaptStyle !== false)
   * 4. Pinned Mandatory User Constraints (0% constraint loss)
   */
  public static composeAdaptiveSystemPrompt(
    input: ComposeSystemPromptInput
  ): ComposedSystemPromptResult {
    const inferredStyle = AdaptivePersonaAndPromptComposer.inferUserCommunicationStyle(
      input.recentUserMessages ?? [],
      input.persistedStyleProfile
    );

    const blocks: string[] = [];

    // 1. Core cognitive foundation
    blocks.push(`[COGNITIVE_ROLE: ${input.role.toUpperCase()}]\n${ROLE_COGNITIVE_FOUNDATIONS[input.role]}`);

    // 2. User-configured Custom System Prompt from settings (highest priority for persona/behavior)
    const customTrimmed = (input.customSystemPrompt ?? "").trim();
    const appliedCustomSystemPrompt = customTrimmed.length > 0;
    if (appliedCustomSystemPrompt) {
      blocks.push(
        `[OWNER_CUSTOM_SYSTEM_PROMPT]\nFollow these explicit owner-configured persona and behavior instructions:\n${customTrimmed}`
      );
    }

    // 3. Automatic conversational adaptation (enabled by default)
    if (input.autoAdaptStyle !== false) {
      const styleLines: string[] = [];
      if (inferredStyle.primaryLanguage === "ru") {
        styleLines.push("- Respond in clear, natural Russian.");
      } else if (inferredStyle.primaryLanguage === "en") {
        styleLines.push("- Respond in clear, natural English.");
      }
      if (inferredStyle.formality === "casual_peer") {
        styleLines.push(
          "- Match the user's collaborative peer tone ('на ты' in Russian when the user addresses you informally), staying warm, direct, and grounded without robotic clichés."
        );
      } else if (inferredStyle.formality === "polite_formal") {
        styleLines.push("- Maintain a respectful, polished professional tone ('на Вы').");
      } else {
        styleLines.push("- Maintain a crisp, engineering-focused technical tone.");
      }

      if (inferredStyle.verbosity === "concise") {
        styleLines.push("- Keep explanations compact and high-signal; lead directly with the answer or result.");
      } else if (inferredStyle.verbosity === "detailed") {
        styleLines.push(
          "- Provide structured, thorough explanations with comparison tables and clear causal breakdowns."
        );
      }

      if (inferredStyle.prefersNoFluff) {
        styleLines.push("- Skip filler openings, meta-roadmaps, and self-congratulatory adjectives.");
      }

      blocks.push(`[ADAPTIVE_COMMUNICATION_STYLE]\n${styleLines.join("\n")}`);
    }

    // 4. Mandatory Pinned Constraints (0% constraint loss guarantee)
    const constraints = (input.mandatoryConstraints ?? []).map((c) => c.trim()).filter(Boolean);
    if (constraints.length > 0) {
      blocks.push(
        `[MANDATORY_ACTIVE_CONSTRAINTS — ZERO_LOSS_ENFORCED]\n${constraints
          .map((c, idx) => `${idx + 1}. ${c}`)
          .join("\n")}`
      );
    }

    return {
      systemPrompt: blocks.join("\n\n"),
      inferredStyle,
      appliedCustomSystemPrompt,
      pinnedConstraintsCount: constraints.length
    };
  }
}
