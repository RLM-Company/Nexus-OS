import { DatabaseSync } from "node:sqlite";

export interface LearnedImplicitPreference {
  preferenceId: string;
  ownerId: string;
  category: "formatting" | "verbosity" | "code_style" | "grounding" | "workflow";
  directive: string;
  confidence: number;
  observationCount: number;
  updatedAt: string;
}

export interface FeedbackObservationResult {
  sentiment: "positive_reinforcement" | "corrective_feedback" | "neutral";
  extractedPreferences: LearnedImplicitPreference[];
}

/**
 * Long-Term User Preference & Implicit Feedback Learner.
 * Extracts implicit behavioral preferences and corrective rules from natural user replies
 * (e.g., "без воды", "в один файл", "с таблицей", "хорошо работаем") and persists them in SQLite
 * with Exponential Moving Average (EMA) confidence updates.
 */
export class ImplicitFeedbackPreferenceLearner {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_user_implicit_preferences (
        preference_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        category TEXT NOT NULL,
        directive TEXT NOT NULL,
        confidence REAL NOT NULL,
        observation_count INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, directive)
      );
    `);
  }

  public observeUserMessage(ownerId: string, userMessage: string): FeedbackObservationResult {
    const lower = userMessage.toLowerCase();

    const isPositive =
      /(отлично|хорошо работаем|супер|идеально|давай дальше|продолжаем|красава|great job|perfect)/i.test(
        lower
      );
    const isCorrective =
      /(слишком длинно|без воды|короче|переделай|не так|ошибка|в один файл|в отдельный пакет|too long|no fluff)/i.test(
        lower
      );

    const candidateRules: Array<{
      category: LearnedImplicitPreference["category"];
      directive: string;
      initialConfidence: number;
    }> = [];

    if (/(без воды|короче|слишком длинно|кратко|no fluff|concise)/i.test(lower)) {
      candidateRules.push({
        category: "verbosity",
        directive: "Eliminate introductory filler and keep explanations compact and direct.",
        initialConfidence: 0.85
      });
    }

    if (/(в один файл|в один пакет|единый пакет|single package|all-in-one)/i.test(lower)) {
      candidateRules.push({
        category: "workflow",
        directive: "Package deliverables into a single unified archive with one-command deployment.",
        initialConfidence: 0.88
      });
    }

    if (/(в отдельный пакет|отдельно от|separate package)/i.test(lower)) {
      candidateRules.push({
        category: "workflow",
        directive: "Isolate newly requested post-cutoff features into a dedicated standalone package.",
        initialConfidence: 0.9
      });
    }

    if (/(таблиц|сравни|в виде таблицы|markdown table)/i.test(lower)) {
      candidateRules.push({
        category: "formatting",
        directive: "Present multi-attribute comparisons using compact Markdown tables.",
        initialConfidence: 0.82
      });
    }

    if (/(без заглушек|полный код|без todo|no placeholders)/i.test(lower)) {
      candidateRules.push({
        category: "code_style",
        directive: "Always emit complete, runnable code with zero TODO stubs or placeholders.",
        initialConfidence: 0.92
      });
    }

    // If positive reinforcement, boost confidence of all existing preferences for this owner
    if (isPositive && !isCorrective) {
      this.sqlite
        .prepare(
          `UPDATE kosmora_user_implicit_preferences
           SET confidence = MIN(0.99, ROUND(confidence + 0.04, 4)),
               observation_count = observation_count + 1,
               updated_at = ?
           WHERE owner_id = ?`
        )
        .run(new Date().toISOString(), ownerId);
    }

    const extractedPreferences: LearnedImplicitPreference[] = [];
    for (const rule of candidateRules) {
      const saved = this.upsertPreference(ownerId, rule.category, rule.directive, rule.initialConfidence);
      extractedPreferences.push(saved);
    }

    const sentiment: FeedbackObservationResult["sentiment"] = isCorrective
      ? "corrective_feedback"
      : isPositive
        ? "positive_reinforcement"
        : "neutral";

    return {
      sentiment,
      extractedPreferences
    };
  }

  public upsertPreference(
    ownerId: string,
    category: LearnedImplicitPreference["category"],
    directive: string,
    observedConfidence = 0.8
  ): LearnedImplicitPreference {
    const existing = this.sqlite
      .prepare(
        `SELECT preference_id, confidence, observation_count
         FROM kosmora_user_implicit_preferences
         WHERE owner_id = ? AND directive = ?`
      )
      .get(ownerId, directive) as
      | { preference_id: string; confidence: number; observation_count: number }
      | undefined;

    const now = new Date().toISOString();
    if (!existing) {
      const prefId = `pref_${ownerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const conf = Number(Math.min(0.99, Math.max(0.1, observedConfidence)).toFixed(4));
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_user_implicit_preferences
            (preference_id, owner_id, category, directive, confidence, observation_count, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        )
        .run(prefId, ownerId, category, directive, conf, now);

      return {
        preferenceId: prefId,
        ownerId,
        category,
        directive,
        confidence: conf,
        observationCount: 1,
        updatedAt: now
      };
    }

    // EMA confidence reinforcement
    const nextCount = existing.observation_count + 1;
    const nextConf = Number(
      Math.min(0.99, existing.confidence * 0.7 + observedConfidence * 0.3 + 0.03).toFixed(4)
    );

    this.sqlite
      .prepare(
        `UPDATE kosmora_user_implicit_preferences
         SET confidence = ?, observation_count = ?, updated_at = ?
         WHERE preference_id = ?`
      )
      .run(nextConf, nextCount, now, existing.preference_id);

    return {
      preferenceId: existing.preference_id,
      ownerId,
      category,
      directive,
      confidence: nextConf,
      observationCount: nextCount,
      updatedAt: now
    };
  }

  public listActivePreferences(ownerId: string, minConfidence = 0.6): LearnedImplicitPreference[] {
    const rows = this.sqlite
      .prepare(
        `SELECT preference_id, owner_id, category, directive, confidence, observation_count, updated_at
         FROM kosmora_user_implicit_preferences
         WHERE owner_id = ? AND confidence >= ?
         ORDER BY confidence DESC, observation_count DESC`
      )
      .all(ownerId, minConfidence) as Array<{
      preference_id: string;
      owner_id: string;
      category: LearnedImplicitPreference["category"];
      directive: string;
      confidence: number;
      observation_count: number;
      updated_at: string;
    }>;

    return rows.map((r) => ({
      preferenceId: r.preference_id,
      ownerId: r.owner_id,
      category: r.category,
      directive: r.directive,
      confidence: r.confidence,
      observationCount: r.observation_count,
      updatedAt: r.updated_at
    }));
  }
}
