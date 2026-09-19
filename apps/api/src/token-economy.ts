export type TokenEconomySettings = { enabled: boolean };

/** Browser-local preferences are mirrored for the active API process only. */
export class TokenEconomyStore {
  readonly #settingsByOwner = new Map<string, TokenEconomySettings>();

  get(ownerId: string): TokenEconomySettings {
    return this.#settingsByOwner.get(ownerId) ?? { enabled: false };
  }

  set(ownerId: string, settings: TokenEconomySettings): TokenEconomySettings {
    const normalized = { enabled: settings.enabled === true };
    this.#settingsByOwner.set(ownerId, normalized);
    return normalized;
  }
}
