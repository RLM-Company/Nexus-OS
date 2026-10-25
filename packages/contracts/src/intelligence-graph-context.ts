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

/** Freshness describes a saved revision, never the truth of its claims. */
export type IntelligenceGraphSavedContextStatus = {
  graph_revision: number;
  materials_version: number;
} & (
  | { status: "missing"; current_sha256: null; saved: null }
  | { status: "unrecognized"; current_sha256: string; saved: null }
  | {
      status: "current" | "stale";
      current_sha256: string;
      saved: { revision: number; query: string };
    }
);

export function isIntelligenceGraphSavedContextStatus(
  value: unknown
): value is IntelligenceGraphSavedContextStatus {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(v.graph_revision) ||
    (v.graph_revision as number) < 1 ||
    !Number.isSafeInteger(v.materials_version) ||
    (v.materials_version as number) < 0
  )
    return false;
  if (v.status === "missing") return v.current_sha256 === null && v.saved === null;
  if (typeof v.current_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.current_sha256))
    return false;
  if (v.status === "unrecognized") return v.saved === null;
  if (
    (v.status !== "current" && v.status !== "stale") ||
    v.saved === null ||
    typeof v.saved !== "object"
  )
    return false;
  const saved = v.saved as Record<string, unknown>;
  return (
    Number.isSafeInteger(saved.revision) &&
    (saved.revision as number) >= 1 &&
    (v.status === "current"
      ? saved.revision === v.graph_revision
      : (saved.revision as number) < (v.graph_revision as number)) &&
    typeof saved.query === "string" &&
    saved.query.trim().length > 0 &&
    saved.query.length <= 500
  );
}
