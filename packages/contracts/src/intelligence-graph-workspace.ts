import type {
  IntelligenceGraphConflict,
  IntelligenceGraphEvidenceRef,
  IntelligenceGraphEdge,
  IntelligenceGraphNode,
  IntelligenceGraphVersionRef
} from "./intelligence-graph.js";
import {
  IntelligenceGraphConflictSchema,
  validateIntelligenceGraphConflict
} from "./intelligence-graph.js";
import { Value } from "typebox/value";

export interface IntelligenceGraphWorkspaceRecord {
  node: IntelligenceGraphVersionRef;
  text: string;
  excerpt: string;
  estimated_tokens: number;
}

export interface IntelligenceGraphWorkspace {
  graph_id: string;
  owner_id: string;
  project_id: string;
  title: string;
  revision: number;
  created_at: string;
  updated_at: string;
  restored_from_revision: number | null;
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
  records: IntelligenceGraphWorkspaceRecord[];
  /** Absent in older snapshots. References pin exact versions, including superseded content. */
  conflicts?: IntelligenceGraphConflict[];
  /** Internal allocator floor retained after restores; version numbers may have gaps. */
  version_floor?: number;
}

/** Versions allocated by this workspace never exceed its revision; restores reserve a fresh range. */
export function validateIntelligenceGraphWorkspaceVersionState(
  graph: Pick<
    IntelligenceGraphWorkspace,
    | "revision"
    | "version_floor"
    | "nodes"
    | "edges"
    | "created_at"
    | "updated_at"
    | "restored_from_revision"
  >
): string[] {
  const issues: string[] = [];
  if (!Number.isSafeInteger(graph.revision) || graph.revision < 1)
    issues.push("Invalid workspace revision");
  if (
    graph.version_floor !== undefined &&
    (!Number.isSafeInteger(graph.version_floor) ||
      graph.version_floor < 1 ||
      graph.version_floor > graph.revision)
  )
    issues.push("Invalid restored version floor");
  if (
    graph.restored_from_revision !== null &&
    (!Number.isSafeInteger(graph.restored_from_revision) ||
      graph.restored_from_revision < 1 ||
      graph.restored_from_revision >= graph.revision)
  )
    issues.push("Invalid restored revision reference");
  const validTime = (v: string) => {
    if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return false;
    const canonical = new Date(v).toISOString();
    return canonical === v || canonical.replace(".000Z", "Z") === v;
  };
  if (
    !validTime(graph.created_at) ||
    !validTime(graph.updated_at) ||
    Date.parse(graph.updated_at) < Date.parse(graph.created_at)
  )
    issues.push("Invalid workspace clock");
  if (
    graph.nodes.some(
      (n) =>
        !Number.isSafeInteger(n.node_version) ||
        n.node_version < 1 ||
        n.node_version > graph.revision ||
        !validTime(n.created_at) ||
        Date.parse(n.created_at) > Date.parse(graph.updated_at)
    ) ||
    graph.edges.some(
      (e) =>
        !Number.isSafeInteger(e.edge_version) ||
        e.edge_version < 1 ||
        e.edge_version > graph.revision ||
        !validTime(e.created_at) ||
        Date.parse(e.created_at) > Date.parse(graph.updated_at)
    )
  )
    issues.push("Node/edge version or creation time exceeds workspace revision");
  return issues;
}

/** Shared by edits/restores and full privacy export; malformed snapshots fail closed. */
export function validateIntelligenceGraphWorkspaceConflicts(
  graph: Pick<
    IntelligenceGraphWorkspace,
    "owner_id" | "project_id" | "nodes" | "conflicts" | "updated_at"
  >
): string[] {
  if (graph.conflicts === undefined) return [];
  if (!Array.isArray(graph.conflicts) || graph.conflicts.length > 50)
    return ["Invalid conflict list or conflict limit exceeded"];
  const ids = new Set<string>();
  const issues: string[] = [];
  for (const conflict of graph.conflicts) {
    if (!Value.Check(IntelligenceGraphConflictSchema, conflict)) {
      issues.push("Invalid conflict structure");
      continue;
    }
    if (ids.has(conflict.conflict_id)) issues.push("Duplicate conflict ID");
    ids.add(conflict.conflict_id);
    if (
      conflict.position_refs.length > 20 ||
      new Set(conflict.position_refs.map((r) => r.id)).size !== conflict.position_refs.length
    )
      issues.push("Conflict requires 2–20 distinct Claim identities");
    if (
      ![
        graph.updated_at,
        conflict.created_at,
        ...(conflict.resolved_at === null ? [] : [conflict.resolved_at])
      ].every((t) => Number.isFinite(Date.parse(t))) ||
      Date.parse(conflict.created_at) > Date.parse(graph.updated_at) ||
      (conflict.resolved_at !== null &&
        Date.parse(conflict.resolved_at) > Date.parse(graph.updated_at))
    )
      issues.push("Conflict time exceeds workspace time");
    issues.push(
      ...validateIntelligenceGraphConflict({
        ownerId: graph.owner_id,
        projectId: graph.project_id,
        nodes: graph.nodes,
        conflict
      })
    );
  }
  return issues;
}

export interface IntelligenceGraphRevisionInfo {
  revision: number;
  created_at: string;
  summary: string;
  restored_from_revision: number | null;
}

/** A bounded deterministic reading of one saved revision; organizational review is not proof. */
export interface IntelligenceGraphWorkspaceExplanation {
  search_version: string;
  graph_id: string;
  graph_title: string;
  revision: number;
  graph_updated_at: string;
  query: string;
  readiness: "grounded_context" | "review_required" | "abstain";
  concerns: string[];
  matched_nodes: {
    id: string;
    version: number;
    kind: string;
    status: string;
    label: string;
    detail: string | null;
    source: IntelligenceGraphEvidenceRef;
    known: boolean;
  }[];
  relationships: {
    edge_id: string;
    version: number;
    from: string;
    to: string;
    relation: string;
    description: string;
    verified: boolean;
    status: string;
    source: IntelligenceGraphEvidenceRef;
    quote: string | null;
    source_status: string | null;
    note: string;
  }[];
  conflicts: Pick<
    IntelligenceGraphConflict,
    | "conflict_id"
    | "subject_ref"
    | "position_refs"
    | "status"
    | "resolution_ref"
    | "created_at"
    | "resolved_at"
  >[];
  conflict_nodes: {
    ref: IntelligenceGraphVersionRef;
    kind: string;
    status: string;
    label: string;
    detail: string | null;
  }[];
  stale_conflict_ids: string[];
  conflict_review: {
    relevant: number;
    returned: number;
    returned_nodes: number;
    max_conflicts: number;
    max_nodes: number;
    truncated: boolean;
  };
  paths: {
    seed: IntelligenceGraphVersionRef;
    target: IntelligenceGraphVersionRef;
    edges: IntelligenceGraphVersionRef[];
  }[];
  budget: {
    max_depth: number;
    max_nodes: number;
    max_edges: number;
    max_fan_out: number;
    max_context_tokens: number;
    visited_nodes: number;
    returned_edges: number;
    estimated_context_tokens: number;
    truncated: boolean;
    matched_candidates?: number;
    unreturned_candidates?: number;
  };
  truncated: boolean;
  explanation: string;
}

export interface IntelligenceGraphWorkspaceReport {
  format: "kosmora.intelligence-graph-report.v1";
  reading: IntelligenceGraphWorkspaceExplanation;
}

/** Every implementation must enforce owner AND project on every read and write. */
export interface IntelligenceGraphWorkspaceRepository {
  create(record: IntelligenceGraphWorkspace): IntelligenceGraphWorkspace | null;
  getImportReceipt(
    ownerId: string,
    projectId: string,
    creationKey: string
  ): IntelligenceGraphImportReceipt | null;
  createImported(
    record: IntelligenceGraphWorkspace,
    creationKey: string,
    packageSha256: string
  ): IntelligenceGraphImportResult | null;
  get(ownerId: string, projectId: string, graphId: string): IntelligenceGraphWorkspace | null;
  list(ownerId: string, projectId: string, limit: number): IntelligenceGraphWorkspace[];
  listPage(
    ownerId: string,
    projectId: string,
    query: IntelligenceGraphLibraryQuery
  ): { items: IntelligenceGraphSummary[]; has_more: boolean };
  getRevision(
    ownerId: string,
    projectId: string,
    graphId: string,
    revision: number
  ): IntelligenceGraphWorkspace | null;
  listRevisions(
    ownerId: string,
    projectId: string,
    graphId: string,
    limit: number
  ): IntelligenceGraphRevisionInfo[];
  save(
    record: IntelligenceGraphWorkspace,
    expectedRevision: number,
    summary: string
  ): IntelligenceGraphWorkspace | null;
}

export interface IntelligenceGraphImportReceipt {
  creation_key: string;
  package_sha256: string;
  graph_id: string | null;
}
export type IntelligenceGraphImportResult =
  | { kind: "created" | "replayed"; graph: IntelligenceGraphWorkspace }
  | { kind: "conflict" }
  | { kind: "deleted" }
  | { kind: "limit" };

export interface IntelligenceGraphSummary {
  graph_id: string;
  title: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface IntelligenceGraphLibraryQuery {
  limit: number;
  query: string;
  before?: { updated_at: string; graph_id: string };
}
