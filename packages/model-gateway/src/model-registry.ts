import type { ModelRegistryDocument, ModelRegistryEntry } from "@cosmora/contracts";

const entryKey = (entry: Pick<ModelRegistryEntry, "provider_id" | "model_id">): string =>
  `${entry.provider_id}:${entry.model_id}`;

export interface ModelRegistryOptions {
  now?: () => number;
}

export class ModelRegistry {
  readonly #document: ModelRegistryDocument;

  constructor(document: ModelRegistryDocument, options: ModelRegistryOptions = {}) {
    if (document.schema_version !== 1 || !document.registry_version.trim()) {
      throw new Error("Unsupported or invalid model registry document");
    }
    const currentTime = (options.now ?? Date.now)();
    if (!Number.isFinite(currentTime)) throw new Error("Invalid Model Registry clock");
    const keys = new Set<string>();
    for (const entry of document.entries) {
      const key = entryKey(entry);
      if (keys.has(key)) throw new Error(`Duplicate model registry entry: ${key}`);
      keys.add(key);
      if (entry.max_output_tokens > entry.context_window_tokens) {
        throw new Error(`Model output limit exceeds its context window: ${key}`);
      }
      if (
        entry.privacy.confidential_compatible &&
        (entry.privacy.training_usage !== "none" || entry.privacy.retention === "unknown")
      ) {
        throw new Error(`Confidential compatibility is not fully declared: ${key}`);
      }
      if (entry.status !== "active") continue;
      if (!entry.source.verified_at || !entry.source.reference?.trim()) {
        throw new Error(`Active model route is missing verification evidence: ${key}`);
      }
      if (!entry.capabilities.streaming) {
        throw new Error(`Active model route does not support gateway streaming: ${key}`);
      }
      if (entry.protocol !== "mock" && entry.source.kind !== "authorized_discovery") {
        throw new Error(`Active external model route was not authorized through discovery: ${key}`);
      }
      if (entry.protocol !== "mock") {
        if (!entry.source.valid_until) {
          throw new Error(`Active external model route is missing evidence expiry: ${key}`);
        }
        const verifiedAt = Date.parse(entry.source.verified_at);
        const validUntil = Date.parse(entry.source.valid_until);
        if (!Number.isFinite(verifiedAt) || !Number.isFinite(validUntil)) {
          throw new Error(`Model Registry evidence timestamps are invalid: ${key}`);
        }
        if (validUntil <= verifiedAt) {
          throw new Error(`Model Registry evidence expiry is not after verification: ${key}`);
        }
        if (validUntil <= currentTime) {
          throw new Error(`Model Registry evidence has expired: ${key}`);
        }
      }
    }
    this.#document = structuredClone(document);
  }

  get version(): string {
    return this.#document.registry_version;
  }

  list(): readonly ModelRegistryEntry[] {
    return structuredClone(this.#document.entries);
  }

  get(providerId: string, modelId: string): ModelRegistryEntry | null {
    const entry = this.#document.entries.find(
      (candidate) => candidate.provider_id === providerId && candidate.model_id === modelId
    );
    return entry ? structuredClone(entry) : null;
  }
}
