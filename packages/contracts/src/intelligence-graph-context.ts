import type { ChatTextAttachment } from "./chat-attachments.js";
import type { IntelligenceGraphVersionRef } from "./intelligence-graph.js";
import type { IntelligenceGraphWorkspaceExplanation } from "./intelligence-graph-workspace.js";

export const INTELLIGENCE_GRAPH_CONTEXT_FORMAT = "kosmora.graph-context.v1" as const;
export const INTELLIGENCE_GRAPH_CONTEXT_LIMITS = {
  characters: 8000,
  bytes: 16000,
  nodes: 40,
  edges: 24
} as const;
export interface IntelligenceGraphModelContext {
  format: typeof INTELLIGENCE_GRAPH_CONTEXT_FORMAT;
  usage: string;
  graph: { id: string; revision: number; title: string; updated_at: string };
  query: string;
  search_version: string;
  readiness: IntelligenceGraphWorkspaceExplanation["readiness"];
  concerns: string[];
  retrieval_truncated: boolean;
  omitted_nodes: number;
  omitted_edges: number;
  nodes: {
    ref: IntelligenceGraphVersionRef;
    kind: string;
    status: string;
    label: string;
    detail: string;
  }[];
  edges: {
    ref: IntelligenceGraphVersionRef;
    type: string;
    from: IntelligenceGraphVersionRef;
    to: IntelligenceGraphVersionRef;
    status: string;
    source?: { ref: IntelligenceGraphVersionRef; location: string; quote: string; status: string };
  }[];
  conflicts: IntelligenceGraphWorkspaceExplanation["conflicts"];
  stale_conflict_ids: string[];
}
export interface IntelligenceGraphContextPreview {
  attachment: ChatTextAttachment;
  sha256: string;
  statistics: {
    nodes: number;
    edges: number;
    conflicts: number;
    omitted_nodes: number;
    omitted_edges: number;
    characters: number;
    bytes: number;
    retrieval_truncated: boolean;
  };
}
export interface IntelligenceGraphContextState {
  materials_version: number;
  current_sha256: string | null;
  already_applied: boolean;
  can_apply: boolean;
  retained_files: string[];
}
