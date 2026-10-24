import type {
  IntelligenceGraphEvidenceAudit,
  IntelligenceGraphVersionRef,
  IntelligenceGraphWorkspace
} from "@cosmora/contracts";

const key = (ref: IntelligenceGraphVersionRef) => `${ref.id}@${ref.version}`;
const active = (status: string) => status !== "deleted" && status !== "superseded";
const byRef = <T extends { ref: IntelligenceGraphVersionRef }>(a: T, b: T) =>
  a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : a.ref.version - b.ref.version;

/** The service validates and scopes this saved revision before building the reading. */
export function buildIntelligenceGraphEvidenceAudit(
  graph: IntelligenceGraphWorkspace
): IntelligenceGraphEvidenceAudit {
  const nodes = new Map(
    graph.nodes.map((n) => [key({ id: n.node_id, version: n.node_version }), n])
  );
  const records = new Map(graph.records.map((r) => [key(r.node), r]));
  const claims: IntelligenceGraphEvidenceAudit["claims"] = graph.nodes
    .filter((n) => n.kind === "Claim" && active(n.verification_status))
    .map((n) => {
      const ref = { id: n.node_id, version: n.node_version };
      const record = records.get(key(ref));
      if (!record) throw new Error("Missing claim record for evidence audit");
      const supports: IntelligenceGraphEvidenceAudit["claims"][number]["supports"] = graph.edges
        .filter(
          (e) => e.type === "SUPPORTS" && active(e.verification_status) && key(e.to) === key(ref)
        )
        .map((e) => {
          const from = nodes.get(key(e.from));
          const fromRecord = records.get(key(e.from));
          if (!from || !fromRecord || !active(from.verification_status))
            throw new Error("Unavailable supporting endpoint for evidence audit");
          let citation: IntelligenceGraphEvidenceAudit["claims"][number]["supports"][number]["citation"] =
            null;
          if (e.evidence_excerpt !== undefined) {
            const source = { id: e.evidence_ref.source_id, version: e.evidence_ref.source_version };
            const sourceNode = nodes.get(key(source));
            const sourceRecord = records.get(key(source));
            if (
              !sourceNode ||
              !sourceRecord ||
              !["Source", "Document"].includes(sourceNode.kind) ||
              !e.evidence_excerpt.trim() ||
              !sourceRecord.excerpt.includes(e.evidence_excerpt)
            )
              throw new Error("Invalid quoted source for evidence audit");
            citation = {
              source,
              label: sourceRecord.text,
              status: sourceNode.verification_status,
              location: e.evidence_ref.location,
              quote: e.evidence_excerpt,
              historical: !active(sourceNode.verification_status)
            };
          }
          return {
            ref: { id: e.edge_id, version: e.edge_version },
            from: e.from,
            from_label: fromRecord.text,
            status: e.verification_status,
            citation
          };
        })
        .sort(byRef);
      return {
        ref,
        label: record.text,
        status: n.verification_status,
        coverage: supports.some((s) => s.citation && !s.citation.historical)
          ? ("current_citation" as const)
          : supports.some((s) => s.citation)
            ? ("historical_citation" as const)
            : ("no_citation" as const),
        supports
      };
    })
    .sort(byRef);
  const supports = claims.flatMap((c) => c.supports);
  return {
    format: "kosmora.graph-evidence-audit.v1",
    usage:
      "Проверка наличия точных цитат на входящих SUPPORTS. Не подтверждает достоверность утверждений, качество источников или смысловую связь с цитатой.",
    graph: {
      id: graph.graph_id,
      revision: graph.revision,
      title: graph.title,
      updated_at: graph.updated_at
    },
    statistics: {
      claims: claims.length,
      with_current_citations: claims.filter((c) => c.coverage === "current_citation").length,
      with_historical_citations_only: claims.filter((c) => c.coverage === "historical_citation")
        .length,
      without_citations: claims.filter((c) => c.coverage === "no_citation").length,
      support_links: supports.length,
      uncited_support_links: supports.filter((s) => !s.citation).length,
      historical_citations: supports.filter((s) => s.citation?.historical).length
    },
    claims
  };
}
