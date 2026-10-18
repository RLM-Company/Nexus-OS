import type { GraphForComparison } from "./revision-diff";
export type NavigationNode = GraphForComparison["nodes"][number] & {
  label: string;
  detail: string;
  x: number;
  y: number;
};
export type NavigationEdge = GraphForComparison["edges"][number];
const key = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
const live = (status: string) => !["superseded", "deleted"].includes(status);
/** A deterministic bounded view, not a similarity score or a generated relationship. */
export function layoutGraph(
  graph: GraphForComparison,
  focusId: string | null,
  neighboursOnly: boolean
) {
  const active = graph.nodes.filter((n) => live(n.verification_status)).slice(0, 150);
  const refs = new Set(active.map((n) => key({ id: n.node_id, version: n.node_version })));
  const edges = graph.edges
    .filter((e) => live(e.verification_status) && refs.has(key(e.from)) && refs.has(key(e.to)))
    .slice(0, 300);
  const neighbours = new Set<string>();
  if (focusId)
    for (const edge of edges) {
      if (edge.from.id === focusId) neighbours.add(edge.to.id);
      if (edge.to.id === focusId) neighbours.add(edge.from.id);
    }
  const records = new Map(graph.records.map((r) => [key(r.node), r]));
  const included = active
    .filter(
      (n) => !focusId || !neighboursOnly || n.node_id === focusId || neighbours.has(n.node_id)
    )
    .sort((a, b) => a.node_id.localeCompare(b.node_id, "en"));
  const nodes: NavigationNode[] = included.map((node, i) => {
    const record = records.get(key({ id: node.node_id, version: node.node_version }));
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius =
      node.node_id === focusId || included.length === 1
        ? 0
        : 60 + 360 * Math.sqrt((i + 1) / included.length);
    return {
      ...node,
      label: record?.text ?? node.node_id,
      detail: record?.excerpt ?? "",
      x: 500 + radius * Math.cos(angle),
      y: 340 + radius * 0.65 * Math.sin(angle)
    };
  });
  const ids = new Set(nodes.map((n) => n.node_id));
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.from.id) && ids.has(e.to.id)),
    neighbours: [...neighbours].sort(),
    omitted: active.length - nodes.length
  };
}

export interface GraphNavigationPath {
  nodes: string[];
  steps: { edge: NavigationEdge; backwards: boolean }[];
}
/** Shortest recorded navigation path, with explicit reverse traversal, never an inferred edge. */
export function findGraphNavigationPath(
  graph: GraphForComparison,
  from: string,
  to: string,
  direction: "outgoing" | "either",
  maxDepth = 6
): GraphNavigationPath | null {
  if (!["outgoing", "either"].includes(direction)) throw new Error("Invalid direction");
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 6)
    throw new Error("Depth must be 0-6");
  const model = layoutGraph(graph, null, false);
  const ids = new Set(model.nodes.map((n) => n.node_id));
  if (!ids.has(from) || !ids.has(to)) return null;
  const queue: GraphNavigationPath[] = [{ nodes: [from], steps: [] }];
  const seen = new Set([from]);
  const edges = [...model.edges].sort((a, b) => a.edge_id.localeCompare(b.edge_id, "en"));
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i]!,
      cursor = path.nodes.at(-1)!;
    if (cursor === to) return path;
    if (path.steps.length >= maxDepth) continue;
    for (const edge of edges) {
      const backwards = edge.to.id === cursor && edge.from.id !== cursor;
      const next =
        edge.from.id === cursor
          ? edge.to.id
          : direction === "either" && backwards
            ? edge.from.id
            : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push({ nodes: [...path.nodes, next], steps: [...path.steps, { edge, backwards }] });
    }
  }
  return null;
}

/** Structural observations about recorded links only. No truth verdict, automatic repair or mutation. */
export function inspectGraphStructure(graph: GraphForComparison) {
  const model = layoutGraph(graph, null, false),
    ids = model.nodes.map((n) => n.node_id);
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  const dependencies = new Map(ids.map((id) => [id, new Set<string>()]));
  const sources = new Set(
    model.nodes.filter((n) => ["Source", "Document"].includes(n.kind)).map((n) => n.node_id)
  );
  for (const edge of model.edges) {
    adjacency.get(edge.from.id)?.add(edge.to.id);
    adjacency.get(edge.to.id)?.add(edge.from.id);
    if (edge.type === "DEPENDS_ON") dependencies.get(edge.from.id)?.add(edge.to.id);
  }
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const component = [id];
    seen.add(id);
    for (let i = 0; i < component.length; i++)
      for (const next of adjacency.get(component[i]!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          component.push(next);
        }
    components.push(component.sort());
  }
  let counter = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    onStack = new Set<string>(),
    dependencyCycles: string[][] = [];
  const visit = (id: string) => {
    index.set(id, counter);
    low.set(id, counter++);
    stack.push(id);
    onStack.add(id);
    for (const next of dependencies.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, index.get(next)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const group: string[] = [];
    let next: string;
    do {
      next = stack.pop()!;
      onStack.delete(next);
      group.push(next);
    } while (next !== id);
    if (group.length > 1 || dependencies.get(id)?.has(id)) dependencyCycles.push(group.sort());
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return {
    components,
    isolated: ids.filter((id) => adjacency.get(id)?.size === 0),
    dependencyCycles,
    contradictions: model.edges.filter((e) => e.type === "CONTRADICTS"),
    claimsWithoutSourceLinks: model.nodes
      .filter(
        (n) =>
          n.kind === "Claim" && ![...(adjacency.get(n.node_id) ?? [])].some((id) => sources.has(id))
      )
      .map((n) => n.node_id)
  };
}
