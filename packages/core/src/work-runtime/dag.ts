import { validateWorkDag, type WorkDag, type WorkDagNodeInput } from "@cosmora/contracts";
export { validateWorkDag } from "@cosmora/contracts";
export function projectDagStatuses(graph: WorkDag): WorkDag {
  const next = structuredClone(graph);
  next.execution_waves = computeExecutionWaves(next.nodes);
  for (const node of next.nodes) {
    if (
      ["completed", "failed", "cancelled", "running"].includes(node.status) ||
      node.attempts.length
    )
      continue;
    const unmet = node.depends_on.filter(
      (id) => next.nodes.find((n) => n.id === id)?.status !== "completed"
    );
    node.blocked_reason =
      next.mode !== "active"
        ? "PROJECT_" + next.mode.toUpperCase()
        : unmet.length
          ? "DEPENDENCIES:" + unmet.join(",")
          : null;
    node.status =
      next.mode === "cancelled" ? "cancelled" : node.blocked_reason ? "blocked" : "pending";
  }
  return next;
}

/** Stable dependency waves. The current executor remains sequential. */
export function computeExecutionWaves(nodes: WorkDagNodeInput[]): string[][] {
  validateWorkDag(nodes);
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size) {
    const wave = [...remaining.values()]
      .filter((node) => node.depends_on.every((id) => completed.has(id)))
      .map((node) => node.id);
    if (!wave.length) throw new Error("DAG_CYCLE");
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      completed.add(id);
    }
  }
  return waves;
}
