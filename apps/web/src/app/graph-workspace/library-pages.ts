import type { IntelligenceGraphSummary } from "@cosmora/contracts";
/** A concurrent edit can move a graph across a page boundary; never duplicate or downgrade its metadata. */
export function mergeGraphSummaryPages(
  current: IntelligenceGraphSummary[],
  incoming: IntelligenceGraphSummary[]
): IntelligenceGraphSummary[] {
  const rows = new Map(current.map((row) => [row.graph_id, row]));
  for (const row of incoming) {
    const old = rows.get(row.graph_id);
    if (!old || row.revision >= old.revision) rows.set(row.graph_id, row);
  }
  return [...rows.values()];
}
