import type {
  IntelligenceGraphEdge,
  IntelligenceGraphNode,
  IntelligenceGraphVersionRef
} from "./intelligence-graph.js";

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
}

export interface IntelligenceGraphRevisionInfo {
  revision: number;
  created_at: string;
  summary: string;
  restored_from_revision: number | null;
}

/** Every implementation must enforce owner AND project on every read and write. */
export interface IntelligenceGraphWorkspaceRepository {
  create(record: IntelligenceGraphWorkspace): IntelligenceGraphWorkspace | null;
  get(ownerId: string, projectId: string, graphId: string): IntelligenceGraphWorkspace | null;
  list(ownerId: string, projectId: string, limit: number): IntelligenceGraphWorkspace[];
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
