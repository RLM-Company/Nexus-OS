import type {
  ProjectMemoryEntry,
  ProjectMemorySnapshot,
  WorkIntelligenceGraphAdapter
} from "@cosmora/contracts";

export function boundedProjectMemory(
  entries: ProjectMemoryEntry[],
  maxCharacters = 8000
): ProjectMemorySnapshot {
  const items: ProjectMemoryEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = JSON.stringify(entry).length;
    if (items.length >= 12 || used + cost > maxCharacters) continue;
    items.push(entry);
    used += cost;
  }
  return { items, omitted: entries.length - items.length };
}

/** Optional injection point for another branch's graph. No writes, no authority. */
export async function readWorkGraphContext(
  adapter: WorkIntelligenceGraphAdapter | undefined,
  input: { project_id: string; owner_id: string; query: string; signal: AbortSignal }
): Promise<ProjectMemorySnapshot> {
  if (!adapter) return { items: [], omitted: 0 };
  if (adapter.contract_version !== "kosmora-work-v1") throw new Error("GRAPH_CONTRACT_MISMATCH");
  const result = await adapter.read({ ...input, query: input.query.slice(0, 500), limit: 12 });
  if (
    result.project_id !== input.project_id ||
    result.entries.length > 12 ||
    result.entries.some((e) => e.project_id !== input.project_id || e.content.length > 4000)
  )
    throw new Error("GRAPH_SCOPE_MISMATCH");
  return boundedProjectMemory(result.entries);
}
