import type { ModelRegistryDocument, ModelRegistryEntry } from "@cosmora/contracts";

const entryKey = (entry: Pick<ModelRegistryEntry, "provider_id" | "model_id">): string =>
  `${entry.provider_id}:${entry.model_id}`;

export class ModelRegistry {
  readonly #document: ModelRegistryDocument;

  constructor(document: ModelRegistryDocument) {
    if (document.schema_version !== 1 || !document.registry_version.trim()) {
      throw new Error("Unsupported or invalid model registry document");
    }
    const keys = new Set<string>();
    for (const entry of document.entries) {
      const key = entryKey(entry);
      if (keys.has(key)) throw new Error(`Duplicate model registry entry: ${key}`);
      keys.add(key);
      if (entry.max_output_tokens > entry.context_window_tokens) {
        throw new Error(`Model output limit exceeds its context window: ${key}`);
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
