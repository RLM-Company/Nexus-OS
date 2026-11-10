import { DatabaseSync } from "node:sqlite";
import type {
  InferredUserStyleProfile
} from "../../core/src/adaptive-persona-and-prompt-composer.js";

export interface OwnerAiIntelligenceSettings {
  ownerId: string;
  customSystemPrompt: string | null;
  autoAdaptStyle: boolean;
  defaultReasoningMode: "auto" | "fast" | "deep_self_refine";
  customTemperature: number | null;
  customTopP: number | null;
  customThinkingBudget: number | null;
  learnedStyleProfile: Partial<InferredUserStyleProfile>;
  updatedAt: string;
}

/**
 * Persistent SQLite Store for Owner AI Intelligence, Custom System Prompt & Adaptive Persona Settings.
 * Stored in `kosmora_ai_intelligence_settings` (isolated from reserved account-settings files).
 */
export class AiIntelligenceSettingsStore {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_ai_intelligence_settings (
        owner_id TEXT PRIMARY KEY NOT NULL,
        custom_system_prompt TEXT,
        auto_adapt_style INTEGER NOT NULL DEFAULT 1,
        default_reasoning_mode TEXT NOT NULL DEFAULT 'auto',
        custom_temperature REAL,
        custom_top_p REAL,
        custom_thinking_budget INTEGER,
        learned_style_profile_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
    `);
  }

  public getSettings(ownerId: string): OwnerAiIntelligenceSettings {
    const row = this.sqlite
      .prepare(
        `SELECT owner_id, custom_system_prompt, auto_adapt_style, default_reasoning_mode,
                custom_temperature, custom_top_p, custom_thinking_budget,
                learned_style_profile_json, updated_at
         FROM kosmora_ai_intelligence_settings WHERE owner_id = ?`
      )
      .get(ownerId) as
      | {
          owner_id: string;
          custom_system_prompt: string | null;
          auto_adapt_style: number;
          default_reasoning_mode: "auto" | "fast" | "deep_self_refine";
          custom_temperature: number | null;
          custom_top_p: number | null;
          custom_thinking_budget: number | null;
          learned_style_profile_json: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return {
        ownerId,
        customSystemPrompt: null,
        autoAdaptStyle: true,
        defaultReasoningMode: "auto",
        customTemperature: null,
        customTopP: null,
        customThinkingBudget: null,
        learnedStyleProfile: {},
        updatedAt: new Date(0).toISOString()
      };
    }

    return {
      ownerId: row.owner_id,
      customSystemPrompt: row.custom_system_prompt,
      autoAdaptStyle: Boolean(row.auto_adapt_style),
      defaultReasoningMode: row.default_reasoning_mode,
      customTemperature: row.custom_temperature,
      customTopP: row.custom_top_p,
      customThinkingBudget: row.custom_thinking_budget,
      learnedStyleProfile: JSON.parse(row.learned_style_profile_json || "{}"),
      updatedAt: row.updated_at
    };
  }

  public updateSettings(
    ownerId: string,
    patch: Partial<{
      customSystemPrompt: string | null;
      autoAdaptStyle: boolean;
      defaultReasoningMode: "auto" | "fast" | "deep_self_refine";
      customTemperature: number | null;
      customTopP: number | null;
      customThinkingBudget: number | null;
      learnedStyleProfile: Partial<InferredUserStyleProfile>;
    }>
  ): OwnerAiIntelligenceSettings {
    const current = this.getSettings(ownerId);

    const nextPrompt =
      patch.customSystemPrompt !== undefined ? patch.customSystemPrompt : current.customSystemPrompt;
    if (nextPrompt !== null && nextPrompt.length > 20_000) {
      throw new Error("CUSTOM_SYSTEM_PROMPT_TOO_LONG: max 20,000 characters");
    }

    const nextTemp =
      patch.customTemperature !== undefined ? patch.customTemperature : current.customTemperature;
    if (nextTemp !== null && (nextTemp < 0 || nextTemp > 1.5)) {
      throw new Error("INVALID_CUSTOM_TEMPERATURE: must be between 0.0 and 1.5");
    }

    const nextTopP = patch.customTopP !== undefined ? patch.customTopP : current.customTopP;
    if (nextTopP !== null && (nextTopP < 0.05 || nextTopP > 1.0)) {
      throw new Error("INVALID_CUSTOM_TOP_P: must be between 0.05 and 1.0");
    }

    const nextThinking =
      patch.customThinkingBudget !== undefined
        ? patch.customThinkingBudget
        : current.customThinkingBudget;
    if (nextThinking !== null && (nextThinking < 0 || nextThinking > 65_536)) {
      throw new Error("INVALID_CUSTOM_THINKING_BUDGET: must be between 0 and 65,536 tokens");
    }

    const nextMode = patch.defaultReasoningMode ?? current.defaultReasoningMode;
    const nextAutoAdapt =
      patch.autoAdaptStyle !== undefined ? patch.autoAdaptStyle : current.autoAdaptStyle;
    const nextLearnedProfile = patch.learnedStyleProfile
      ? { ...current.learnedStyleProfile, ...patch.learnedStyleProfile }
      : current.learnedStyleProfile;

    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_ai_intelligence_settings
          (owner_id, custom_system_prompt, auto_adapt_style, default_reasoning_mode,
           custom_temperature, custom_top_p, custom_thinking_budget,
           learned_style_profile_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
          custom_system_prompt = excluded.custom_system_prompt,
          auto_adapt_style = excluded.auto_adapt_style,
          default_reasoning_mode = excluded.default_reasoning_mode,
          custom_temperature = excluded.custom_temperature,
          custom_top_p = excluded.custom_top_p,
          custom_thinking_budget = excluded.custom_thinking_budget,
          learned_style_profile_json = excluded.learned_style_profile_json,
          updated_at = excluded.updated_at`
      )
      .run(
        ownerId,
        nextPrompt,
        nextAutoAdapt ? 1 : 0,
        nextMode,
        nextTemp,
        nextTopP,
        nextThinking,
        JSON.stringify(nextLearnedProfile),
        now
      );

    return this.getSettings(ownerId);
  }
}
