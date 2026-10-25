import type { IntelligenceGraphVersionRef } from "./intelligence-graph.js";

/** Citation coverage is a structural reading, never an assessment of truth. */
export interface IntelligenceGraphEvidenceAudit {
  format: "kosmora.graph-evidence-audit.v1";
  usage: string;
  graph: { id: string; revision: number; title: string; updated_at: string };
  statistics: {
    claims: number;
    with_current_citations: number;
    with_historical_citations_only: number;
    without_citations: number;
    support_links: number;
    uncited_support_links: number;
    historical_citations: number;
  };
  claims: {
    ref: IntelligenceGraphVersionRef;
    label: string;
    status: string;
    coverage: "current_citation" | "historical_citation" | "no_citation";
    supports: {
      ref: IntelligenceGraphVersionRef;
      from: IntelligenceGraphVersionRef;
      from_label: string;
      status: string;
      citation: null | {
        source: IntelligenceGraphVersionRef;
        label: string;
        status: string;
        location: string;
        quote: string;
        historical: boolean;
      };
    }[];
  }[];
}
