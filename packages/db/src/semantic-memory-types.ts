import type { ContextMemoryBundle, ContextMemoryEvidence, MemoryTarget } from "@cosmora/contracts";
import type { ContextMemoryStore } from "./context-memory-store.js";

export type SemanticSource = { evidence: ContextMemoryEvidence; text: string; fingerprint: string };
export type SemanticIndexInfo = NonNullable<ContextMemoryBundle["semantic_retrieval"]>["index"];
export interface IndexedMemoryRecall {
  resolve(
    store: ContextMemoryStore,
    target: MemoryTarget,
    owner: string,
    query: string,
    excluded: readonly string[],
    budget: number,
    signal?: AbortSignal
  ): Promise<ContextMemoryBundle>;
}
