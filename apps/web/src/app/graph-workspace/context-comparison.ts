import type { IntelligenceGraphModelContext } from "@cosmora/contracts";

export interface ContextChange {
  kind: "metadata" | "node" | "edge" | "conflict";
  label: string;
  before: string | null;
  after: string | null;
}
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
};
const text = (value: unknown) => JSON.stringify(canonical(value), null, 2);
const ref = (value: { ref: { id: string; version: number } }) =>
  `${value.ref.id}@${value.ref.version}`;

/** Include all versions/statuses/citations, even superseded evidence. Never infer truth. */
export function compareGraphContexts(
  before: IntelligenceGraphModelContext,
  after: IntelligenceGraphModelContext
): ContextChange[] {
  if (
    before.format !== "kosmora.graph-context.v1" ||
    after.format !== before.format ||
    before.graph.id !== after.graph.id
  )
    throw new Error("Нельзя сравнивать снимки разных графов или форматов.");
  const changes: ContextChange[] = [];
  const metadata = (body: IntelligenceGraphModelContext) =>
    Object.fromEntries(
      Object.entries(body).filter(([key]) => !["nodes", "edges", "conflicts"].includes(key))
    );
  if (text(metadata(before)) !== text(metadata(after)))
    changes.push({
      kind: "metadata",
      label: "Сведения о снимке и ограничения",
      before: text(metadata(before)),
      after: text(metadata(after))
    });
  const group = <T>(
    kind: ContextChange["kind"],
    left: T[],
    right: T[],
    key: (item: T) => string
  ) => {
    const index = (items: T[]) => {
      const result = new Map(items.map((item) => [key(item), text(item)]));
      if (result.size !== items.length) throw new Error("В снимке повторяются ссылки на записи.");
      return result;
    };
    const a = index(left),
      b = index(right);
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(id) ?? null,
        next = b.get(id) ?? null;
      if (old !== next) changes.push({ kind, label: id, before: old, after: next });
    }
  };
  group("node", before.nodes, after.nodes, ref);
  group("edge", before.edges, after.edges, ref);
  group("conflict", before.conflicts, after.conflicts, (c) => c.conflict_id);
  return changes;
}
