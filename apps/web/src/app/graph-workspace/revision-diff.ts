type Ref = { id: string; version: number };
export interface GraphConflict {
  conflict_id: string;
  subject_ref: Ref;
  position_refs: Ref[];
  status: "open" | "resolved";
  resolution_ref: Ref | null;
  created_at: string;
  resolved_at: string | null;
}
export interface GraphForComparison {
  title: string;
  nodes: {
    node_id: string;
    node_version: number;
    kind: string;
    verification_status: string;
    created_at?: string;
  }[];
  edges: {
    edge_id: string;
    edge_version: number;
    type: string;
    from: Ref;
    to: Ref;
    verification_status: string;
    evidence_ref?: { source_id: string; source_version: number; location: string };
    evidence_excerpt?: string;
  }[];
  records: { node: Ref; text: string; excerpt: string }[];
  conflicts?: GraphConflict[];
}
export interface GraphRevisionChange {
  kind: "title" | "node" | "edge" | "conflict";
  id: string;
  before: string | null;
  after: string | null;
}
const active = (status: string) => !["deleted", "superseded"].includes(status);
/** Literal content for React text rendering; navigation paths never imply logical proof. */
export function compareGraphRevisions(
  before: GraphForComparison,
  after: GraphForComparison
): GraphRevisionChange[] {
  const nodeText = (g: GraphForComparison) =>
    new Map(
      g.nodes
        .filter((n) => active(n.verification_status))
        .map((n) => {
          const record = g.records.find(
            (r) => r.node.id === n.node_id && r.node.version === n.node_version
          );
          return [
            n.node_id,
            `${n.kind} · ${n.verification_status} · v${n.node_version}\n${record?.text ?? n.node_id}\n${record?.excerpt ?? ""}`
          ];
        })
    );
  const edgeText = (g: GraphForComparison) =>
    new Map(
      g.edges
        .filter((e) => active(e.verification_status))
        .map((e) => [
          e.edge_id,
          `${e.type} · ${e.verification_status} · v${e.edge_version}\n${e.from.id}@${e.from.version} → ${e.to.id}@${e.to.version}${e.evidence_excerpt === undefined ? "" : `\nИсточник: ${e.evidence_ref?.source_id}@${e.evidence_ref?.source_version}, ${e.evidence_ref?.location}\nЦитата: ${e.evidence_excerpt}`}`
        ])
    );
  const changes: GraphRevisionChange[] =
    before.title === after.title
      ? []
      : [{ kind: "title", id: "title", before: before.title, after: after.title }];
  const conflictText = (g: GraphForComparison) =>
    new Map(
      (g.conflicts ?? []).map((c) => [
        c.conflict_id,
        `${c.status}\nТема: ${c.subject_ref.id}@${c.subject_ref.version}\nПозиции: ${c.position_refs
          .map((r) => `${r.id}@${r.version}`)
          .sort()
          .join(
            ", "
          )}\nРешение: ${c.resolution_ref ? `${c.resolution_ref.id}@${c.resolution_ref.version}` : "—"}\n${c.created_at} → ${c.resolved_at ?? "—"}`
      ])
    );
  for (const [kind, left, right] of [
    ["node", nodeText(before), nodeText(after)],
    ["edge", edgeText(before), edgeText(after)],
    ["conflict", conflictText(before), conflictText(after)]
  ] as const) {
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id) ?? null,
        b = right.get(id) ?? null;
      if (a !== b) changes.push({ kind, id, before: a, after: b });
    }
  }
  return changes;
}
