import type { WorkDag, WorkDagNodeInput } from "@cosmora/contracts";

export function validateWorkDag(nodes: WorkDagNodeInput[]): void {
  const map = new Map(nodes.map((n) => [n.id, n]));
  if (!nodes.length || nodes.length > 32 || map.size !== nodes.length)
    throw new Error("INVALID_DAG");
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("DAG_CYCLE");
    const node = map.get(id);
    if (!node || new Set(node.depends_on).size !== node.depends_on.length)
      throw new Error("DAG_DEPENDENCY_MISSING");
    visiting.add(id);
    for (const dependency of node.depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of map.keys()) visit(id);
}

export function computeExecutionWaves(nodes: WorkDagNodeInput[]): string[][] {
  if (!nodes.length) return [];
  validateWorkDag(nodes);
  const depMap = new Map(nodes.map((n) => [n.id, new Set(n.depends_on)]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  const remaining = new Set(depMap.keys());

  while (remaining.size > 0) {
    const currentWave: string[] = [];
    for (const nodeId of [...remaining].sort()) {
      const deps = depMap.get(nodeId)!;
      if ([...deps].every((d) => completed.has(d))) {
        currentWave.push(nodeId);
      }
    }
    if (currentWave.length === 0) {
      throw new Error("DAG_CYCLE");
    }
    waves.push(currentWave);
    for (const id of currentWave) {
      completed.add(id);
      remaining.delete(id);
    }
  }
  return waves;
}

export function projectDagStatuses(graph: WorkDag): WorkDag {
  const next = structuredClone(graph);
  if (next.nodes.length > 0) {
    try {
      next.execution_waves = computeExecutionWaves(next.nodes);
    } catch {
      // Keep existing execution_waves if calculation fails
    }
  } else {
    next.execution_waves = [];
  }
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
