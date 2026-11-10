import { DatabaseSync } from "node:sqlite";
import { AiIntelligenceSettingsStore } from "../../../packages/db/src/ai-intelligence-settings-store.js";
import {
  CognitiveTurnOrchestrator,
  type PrepareCognitiveTurnInput
} from "../../../packages/core/src/cognitive-turn-orchestrator.js";

/**
 * Owner-isolated API Handler for Kosmora AI Intelligence Settings & Live Cognitive Turn Preview.
 * Lives in `apps/api/src/ai-intelligence-routes.ts` (outside reserved `account-settings/**`).
 */
export class AiIntelligenceApiController {
  private readonly store: AiIntelligenceSettingsStore;

  constructor(sqlite: DatabaseSync) {
    this.store = new AiIntelligenceSettingsStore(sqlite);
  }

  public handleGetSettings(actorOwnerId: string, requestedOwnerId: string) {
    if (!actorOwnerId || actorOwnerId !== requestedOwnerId) {
      return {
        statusCode: 403,
        headers: { "Cache-Control": "no-store" },
        body: { error: "FORBIDDEN_OWNER_MISMATCH" }
      };
    }

    return {
      statusCode: 200,
      headers: { "Cache-Control": "no-store" },
      body: this.store.getSettings(actorOwnerId)
    };
  }

  public handleUpdateSettings(
    actorOwnerId: string,
    requestedOwnerId: string,
    patch: Parameters<AiIntelligenceSettingsStore["updateSettings"]>[1]
  ) {
    if (!actorOwnerId || actorOwnerId !== requestedOwnerId) {
      return {
        statusCode: 403,
        headers: { "Cache-Control": "no-store" },
        body: { error: "FORBIDDEN_OWNER_MISMATCH" }
      };
    }

    try {
      const updated = this.store.updateSettings(actorOwnerId, patch);
      return {
        statusCode: 200,
        headers: { "Cache-Control": "no-store" },
        body: updated
      };
    } catch (err) {
      return {
        statusCode: 400,
        headers: { "Cache-Control": "no-store" },
        body: { error: err instanceof Error ? err.message : "INVALID_AI_SETTINGS" }
      };
    }
  }

  /**
   * Simulates and previews the full Cognitive Turn preparation for an owner,
   * automatically persisting any newly inferred user style traits into their profile.
   */
  public handlePrepareCognitiveTurn(
    actorOwnerId: string,
    turnInput: Omit<PrepareCognitiveTurnInput, "ownerSettings">
  ) {
    const ownerSettings = this.store.getSettings(actorOwnerId);
    const prepared = CognitiveTurnOrchestrator.prepareTurn({
      ...turnInput,
      ownerSettings
    });

    if (ownerSettings.autoAdaptStyle) {
      this.store.updateSettings(actorOwnerId, {
        learnedStyleProfile: prepared.inferredStyle
      });
    }

    return {
      statusCode: 200,
      headers: { "Cache-Control": "no-store" },
      body: prepared
    };
  }
}
