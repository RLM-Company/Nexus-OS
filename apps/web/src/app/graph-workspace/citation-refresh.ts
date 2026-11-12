import type { GraphForComparison } from "./revision-diff";

type Ref = { id: string; version: number };
type Source = { ref: Ref; label: string; text: string; status: string };
export type CitationRefreshPreview = {
  edge: Ref;
  quote: string;
  target: { ref: Ref; label: string; text: string };
  previous: Source;
  latest: Source | null;
  state: "ready" | "quote_missing" | "source_unavailable" | "already_current";
};
export type CitationRefreshOperation = {
  kind: "cite_edge";
  edge_id: string;
  source: Ref;
  location: string;
  excerpt: string;
};
const active = (status: string) => status !== "deleted" && status !== "superseded";
const equal = (a: Ref, b: Ref) => a.id === b.id && a.version === b.version;

/** Uses only the already loaded revision; the write is independently checked by the server. */
export function prepareCitationRefresh(
  graph: GraphForComparison,
  ref: Ref
): CitationRefreshPreview {
  const edges = graph.edges.filter(
    (e) => e.edge_id === ref.id && e.edge_version === ref.version && active(e.verification_status)
  );
  const edge = edges[0];
  if (
    edges.length !== 1 ||
    !edge ||
    edge.type !== "SUPPORTS" ||
    !edge.evidence_ref ||
    !edge.evidence_excerpt?.trim()
  )
    throw new Error("Выбранная действующая связь с цитатой недоступна. Загрузите граф заново.");
  const sourceId = edge.evidence_ref.source_id;
  const previousRef = { id: sourceId, version: edge.evidence_ref.source_version };
  const source = (node: GraphForComparison["nodes"][number]): Source => {
    const ref = { id: node.node_id, version: node.node_version };
    const records = graph.records.filter((r) => equal(r.node, ref));
    if (!["Source", "Document"].includes(node.kind) || records.length !== 1)
      throw new Error("Точный текст версии источника недоступен.");
    return {
      ref,
      label: records[0]!.text,
      text: records[0]!.excerpt,
      status: node.verification_status
    };
  };
  const previousNodes = graph.nodes.filter((n) =>
    equal({ id: n.node_id, version: n.node_version }, previousRef)
  );
  if (previousNodes.length !== 1) throw new Error("Прежняя версия источника недоступна.");
  const previous = source(previousNodes[0]!);
  if (!previous.text.includes(edge.evidence_excerpt))
    throw new Error("Цитата не совпала с прежней версией источника.");
  const candidates = graph.nodes.filter(
    (n) => n.node_id === sourceId && active(n.verification_status)
  );
  if (candidates.length > 1)
    throw new Error("Версия источника неоднозначна. Загрузите граф заново.");
  const latest = candidates[0] ? source(candidates[0]) : null;
  if (latest && latest.ref.version < previous.ref.version)
    throw new Error("Порядок версий источника нарушен.");
  const targets = graph.nodes.filter((n) =>
    equal({ id: n.node_id, version: n.node_version }, edge.to)
  );
  const targetRecords = graph.records.filter((r) => equal(r.node, edge.to));
  if (
    targets.length !== 1 ||
    !active(targets[0]!.verification_status) ||
    targetRecords.length !== 1
  )
    throw new Error("Точный текст поддерживаемого узла недоступен.");
  return {
    edge: { ...ref },
    quote: edge.evidence_excerpt,
    target: { ref: { ...edge.to }, label: targetRecords[0]!.text, text: targetRecords[0]!.excerpt },
    previous,
    latest,
    state: !latest
      ? "source_unavailable"
      : equal(latest.ref, previous.ref)
        ? "already_current"
        : latest.text.includes(edge.evidence_excerpt)
          ? "ready"
          : "quote_missing"
  };
}

export function citationRefreshOperation(
  preview: CitationRefreshPreview,
  location: string,
  reviewed: boolean,
  replacement?: string
): CitationRefreshOperation {
  const normalized = location.trim();
  // A new location must be entered deliberately; line references can move after an edit.
  if (
    !reviewed ||
    !normalized ||
    normalized.length > 256 ||
    [...normalized].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error("Укажите место в новой версии источника и подтвердите сверку.");
  const quote = replacement ?? preview.quote;
  if (
    !["ready", "quote_missing"].includes(preview.state) ||
    (preview.state === "quote_missing" && replacement === undefined) ||
    !preview.latest ||
    preview.latest.ref.version <= preview.previous.ref.version ||
    !quote.trim() ||
    quote.length > 1000 ||
    !preview.latest.text.includes(quote)
  )
    throw new Error(
      "Для этой цитаты нельзя выбрать новую версию. Выделите точный фрагмент источника."
    );
  return {
    kind: "cite_edge",
    edge_id: preview.edge.id,
    source: { ...preview.latest.ref },
    location: normalized,
    excerpt: quote
  };
}
