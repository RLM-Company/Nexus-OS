/**
 * Kosmora Stage 4 (F097-F128): Knowledge Graph, Memory, RAG & Organizational Intelligence
 * Enforces strict project/workspace/owner isolation, pluggable vector embedding adapter
 * with explicit keyword BM25 fallback reporting, hierarchical document chunking with
 * line-level citations, query cache invalidation, and transitive staleness propagation.
 */

import { createHash } from "node:crypto";
import type { KosmoraCitation } from "./kosmora-protocol.js";

export type KnowledgeNodeType =
  "entity" | "claim" | "decision" | "artifact" | "person" | "policy" | "metric";

export type KnowledgeEdgeRelation =
  "supports" | "contradicts" | "derived_from" | "supersedes" | "owned_by" | "governed_by" | "cites";

export interface EmbeddingAdapter {
  readonly provider_id: string;
  readonly dimensions: number;
  embedText(text: string): number[];
}

export interface KnowledgeNode {
  node_id: string;
  project_id: string;
  workspace_id: string;
  owner_id: string;
  type: KnowledgeNodeType;
  title: string;
  content: string;
  content_sha256: string;
  version: number;
  embedding_vector?: number[] | undefined;
  embedding_provider?: string | undefined;
  confidence: number;
  valid_from: string;
  valid_until?: string;
  stale: boolean;
  stale_reason?: string | undefined;
  citations: KosmoraCitation[];
  tags: string[];
}

export interface KnowledgeEdge {
  edge_id: string;
  project_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: KnowledgeEdgeRelation;
  weight: number;
  created_at: string;
}

export interface HierarchicalDocumentChunk {
  chunk_id: string;
  document_id: string;
  project_id: string;
  workspace_id: string;
  parent_chunk_id?: string;
  level: "document" | "section" | "paragraph";
  heading_path: string[];
  text: string;
  token_count: number;
  start_line: number;
  end_line: number;
  content_sha256: string;
  embedding_vector?: number[] | undefined;
}

export type RetrievalMode = "vector_embedding_adapter" | "keyword_bm25_fallback";

export interface HybridRetrievalResult {
  node_id: string;
  project_id: string;
  workspace_id: string;
  title: string;
  excerpt: string;
  retrieval_mode: RetrievalMode;
  lexical_bm25_score: number;
  vector_cosine_score: number | null;
  graph_centrality_boost: number;
  reranked_final_score: number;
  stale_decay_alert: boolean;
  stale_reason?: string | undefined;
  version: number;
  citations: KosmoraCitation[];
}

export interface ContradictionAuditReport {
  project_id: string;
  contradiction_pairs: Array<{
    node_a_id: string;
    node_b_id: string;
    description: string;
    resolution_recommendation: string;
  }>;
  stale_nodes_flagged: string[];
  freshness_score: number;
}

export class KosmoraIntelligenceGraph {
  private readonly nodes = new Map<string, KnowledgeNode>();
  private readonly edges = new Map<string, KnowledgeEdge>();
  private readonly chunks = new Map<string, HierarchicalDocumentChunk>();
  private readonly searchCache = new Map<string, HybridRetrievalResult[]>();
  private embeddingAdapter: EmbeddingAdapter | undefined;

  constructor(embeddingAdapter?: EmbeddingAdapter) {
    this.embeddingAdapter = embeddingAdapter;
  }

  public setEmbeddingAdapter(adapter: EmbeddingAdapter | undefined): void {
    this.embeddingAdapter = adapter;
    this.searchCache.clear();
  }

  public getRetrievalMode(): RetrievalMode {
    return this.embeddingAdapter ? "vector_embedding_adapter" : "keyword_bm25_fallback";
  }

  /**
   * F097-F101: Add or update an enterprise knowledge graph node with project/owner isolation.
   */
  public upsertNode(
    node: Omit<
      KnowledgeNode,
      | "embedding_vector"
      | "embedding_provider"
      | "stale"
      | "version"
      | "content_sha256"
      | "workspace_id"
      | "owner_id"
    > & {
      workspace_id?: string;
      owner_id?: string;
      version?: number;
      stale?: boolean;
      stale_reason?: string | undefined;
    }
  ): KnowledgeNode {
    if (!node.project_id || node.project_id.trim().length === 0) {
      throw new Error("KnowledgeNode requires a non-empty project_id for tenant/project isolation");
    }
    if (!node.node_id || node.node_id.trim().length === 0) {
      throw new Error("KnowledgeNode requires a non-empty node_id");
    }

    const existing = this.nodes.get(node.node_id);
    if (existing && existing.project_id !== node.project_id) {
      throw new Error(
        `Project isolation violation: node '${node.node_id}' belongs to project '${existing.project_id}', cannot overwrite from project '${node.project_id}'`
      );
    }

    const fullText = `${node.title}\n${node.content}`;
    const contentSha256 = createHash("sha256").update(fullText).digest("hex");
    const isContentChanged = existing !== undefined && existing.content_sha256 !== contentSha256;
    const nextVersion = existing
      ? isContentChanged
        ? existing.version + 1
        : (node.version ?? existing.version)
      : (node.version ?? 1);

    let embeddingVector: number[] | undefined;
    let embeddingProvider: string | undefined;
    if (this.embeddingAdapter) {
      embeddingVector = this.embeddingAdapter.embedText(fullText);
      embeddingProvider = this.embeddingAdapter.provider_id;
    }

    const enriched: KnowledgeNode = {
      ...node,
      workspace_id: node.workspace_id ?? existing?.workspace_id ?? "ws_default",
      owner_id: node.owner_id ?? existing?.owner_id ?? "system",
      content_sha256: contentSha256,
      version: nextVersion,
      embedding_vector: embeddingVector,
      embedding_provider: embeddingProvider,
      stale: node.stale ?? false,
      stale_reason: node.stale_reason
    };

    this.nodes.set(enriched.node_id, enriched);
    this.invalidateProjectCache(enriched.project_id);

    // If an existing source node changed its content, automatically mark downstream claims/artifacts as stale
    if (isContentChanged) {
      this.invalidateSourceAndPropagateStaleness(
        enriched.node_id,
        enriched.project_id,
        `Upstream source '${enriched.node_id}' updated to v${nextVersion}`
      );
      // Re-mark the updated source node itself as fresh after propagating staleness to dependents
      enriched.stale = false;
      enriched.stale_reason = undefined;
      this.nodes.set(enriched.node_id, enriched);
    }

    return enriched;
  }

  /**
   * Update a source node's content and propagate staleness to all dependent claims/nodes.
   */
  public updateSourceDocument(
    projectId: string,
    nodeId: string,
    newContent: string,
    actorId = "system"
  ): {
    updated_node: KnowledgeNode;
    invalidated_dependents: string[];
  } {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`KnowledgeNode '${nodeId}' not found`);
    }
    if (existing.project_id !== projectId) {
      throw new Error(
        `Project isolation violation: node '${nodeId}' does not belong to project '${projectId}'`
      );
    }

    const updated = this.upsertNode({
      ...existing,
      owner_id: actorId,
      content: newContent,
      valid_from: new Date().toISOString()
    });

    const dependents = this.invalidateSourceAndPropagateStaleness(
      nodeId,
      projectId,
      `Source document '${nodeId}' modified at v${updated.version}`
    ).filter((id) => id !== nodeId);

    // Keep source node fresh
    updated.stale = false;
    updated.stale_reason = undefined;
    this.nodes.set(nodeId, updated);
    this.invalidateProjectCache(projectId);

    return {
      updated_node: updated,
      invalidated_dependents: dependents
    };
  }

  public addEdge(edge: KnowledgeEdge): KnowledgeEdge {
    const fromNode = this.nodes.get(edge.from_node_id);
    const toNode = this.nodes.get(edge.to_node_id);
    if (!fromNode || !toNode) {
      throw new Error(
        `Cannot create edge '${edge.edge_id}': both from_node_id ('${edge.from_node_id}') and to_node_id ('${edge.to_node_id}') must exist`
      );
    }
    if (fromNode.project_id !== edge.project_id || toNode.project_id !== edge.project_id) {
      throw new Error(
        `Project isolation violation: cannot link nodes across different projects ('${fromNode.project_id}' -> '${toNode.project_id}')`
      );
    }
    this.edges.set(edge.edge_id, edge);
    this.invalidateProjectCache(edge.project_id);
    return edge;
  }

  /**
   * F105: Hierarchical Document Chunking (Document -> Section -> Paragraph) with line numbers
   */
  public ingestHierarchicalDocument(
    documentId: string,
    projectId: string,
    markdownText: string,
    workspaceId = "ws_default"
  ): HierarchicalDocumentChunk[] {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("projectId is required for document ingestion");
    }

    // Remove previous chunks of the same document within this project
    for (const [cid, chunk] of this.chunks.entries()) {
      if (chunk.project_id === projectId && chunk.document_id === documentId) {
        this.chunks.delete(cid);
      }
    }

    const lines = markdownText.replace(/\r\n/g, "\n").split("\n");
    const created: HierarchicalDocumentChunk[] = [];

    const rootChunkId = `${projectId}:${documentId}:root`;
    created.push({
      chunk_id: rootChunkId,
      document_id: documentId,
      project_id: projectId,
      workspace_id: workspaceId,
      level: "document",
      heading_path: [documentId],
      text: markdownText.slice(0, 500),
      token_count: Math.ceil(markdownText.length / 4),
      start_line: 1,
      end_line: lines.length,
      content_sha256: createHash("sha256").update(markdownText).digest("hex"),
      embedding_vector: this.embeddingAdapter?.embedText(markdownText.slice(0, 500))
    });

    let currentHeading = "Introduction";
    let currentSectionChunkId = `${projectId}:${documentId}:sec_0`;
    let paragraphIndex = 0;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("#")) {
        currentHeading = trimmed.replace(/^#+\s*/, "");
        currentSectionChunkId = `${projectId}:${documentId}:sec_${idx + 1}`;
        created.push({
          chunk_id: currentSectionChunkId,
          document_id: documentId,
          project_id: projectId,
          workspace_id: workspaceId,
          parent_chunk_id: rootChunkId,
          level: "section",
          heading_path: [documentId, currentHeading],
          text: trimmed,
          token_count: Math.ceil(trimmed.length / 4),
          start_line: idx + 1,
          end_line: idx + 1,
          content_sha256: createHash("sha256").update(trimmed).digest("hex"),
          embedding_vector: this.embeddingAdapter?.embedText(trimmed)
        });
      } else {
        paragraphIndex += 1;
        const paraId = `${projectId}:${documentId}:para_${paragraphIndex}`;
        created.push({
          chunk_id: paraId,
          document_id: documentId,
          project_id: projectId,
          workspace_id: workspaceId,
          parent_chunk_id: currentSectionChunkId,
          level: "paragraph",
          heading_path: [documentId, currentHeading],
          text: trimmed,
          token_count: Math.ceil(trimmed.length / 4),
          start_line: idx + 1,
          end_line: idx + 1,
          content_sha256: createHash("sha256").update(trimmed).digest("hex"),
          embedding_vector: this.embeddingAdapter?.embedText(trimmed)
        });
      }
    });

    for (const chunk of created) {
      this.chunks.set(chunk.chunk_id, chunk);
    }

    this.invalidateProjectCache(projectId);
    return created;
  }

  /**
   * F102, F106-F108: Project-Isolated Retrieval with Real Embedding Adapter or Explicit Keyword Fallback
   */
  public searchProjectMemory(
    projectId: string,
    query: string,
    topK = 5,
    options?: {
      workspace_id?: string;
      include_stale?: boolean;
    }
  ): HybridRetrievalResult[] {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("searchProjectMemory requires a non-empty projectId");
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const mode = this.getRetrievalMode();
    const includeStale = options?.include_stale ?? true;
    const workspaceFilter = options?.workspace_id;
    const cacheKey = `${projectId}::${workspaceFilter ?? "*"}::${mode}::${includeStale}::${topK}::${normalizedQuery}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return cached.map((item) => ({ ...item }));
    }

    const queryTokens = normalizedQuery
      .toLowerCase()
      .split(/[^a-z0-9а-яё]+/i)
      .filter((t) => t.length >= 2);
    const queryVector = this.embeddingAdapter
      ? this.embeddingAdapter.embedText(normalizedQuery)
      : undefined;

    // Strictly filter nodes to the requested projectId (and workspace_id if provided)
    const projectNodes = [...this.nodes.values()].filter((node) => {
      if (node.project_id !== projectId) return false;
      if (workspaceFilter && node.workspace_id !== workspaceFilter) return false;
      if (!includeStale && node.stale) return false;
      return true;
    });

    const results: HybridRetrievalResult[] = [];

    for (const node of projectNodes) {
      const textLower = `${node.title} ${node.content} ${node.tags.join(" ")}`.toLowerCase();
      let matchedTokens = 0;
      let termFrequencyBoost = 0;
      for (const token of queryTokens) {
        if (textLower.includes(token)) {
          matchedTokens += 1;
          const occurrences = textLower.split(token).length - 1;
          termFrequencyBoost += Math.min(0.25, occurrences * 0.08);
        }
      }

      const tokenCoverage = queryTokens.length > 0 ? matchedTokens / queryTokens.length : 0;
      const bm25Score = Number(Math.min(1, tokenCoverage * 0.8 + termFrequencyBoost).toFixed(4));

      let cosineScore: number | null = null;
      if (queryVector && node.embedding_vector) {
        cosineScore = Number(this.cosineSimilarity(queryVector, node.embedding_vector).toFixed(4));
      }

      // Filter out completely unrelated nodes in keyword fallback mode if query has tokens
      if (mode === "keyword_bm25_fallback" && queryTokens.length > 0 && matchedTokens === 0) {
        continue;
      }

      const connectedEdges = [...this.edges.values()].filter(
        (e) =>
          e.project_id === projectId &&
          (e.from_node_id === node.node_id || e.to_node_id === node.node_id)
      );
      const centralityBoost = Number(Math.min(0.25, connectedEdges.length * 0.05).toFixed(4));
      const stalePenalty = node.stale ? 0.35 : 0;

      const baseSemanticScore =
        mode === "vector_embedding_adapter" && cosineScore !== null
          ? bm25Score * 0.4 + cosineScore * 0.45
          : bm25Score * 0.85;

      const finalScore = Number(
        Math.max(0, baseSemanticScore + centralityBoost * 0.15 - stalePenalty).toFixed(4)
      );

      const ensuredCitations: KosmoraCitation[] =
        node.citations.length > 0
          ? node.citations
          : [
              {
                citation_id: `cit_node_${node.node_id}_v${node.version}`,
                source_type: "knowledge_graph_node",
                uri: `kosmora://graph/${node.project_id}/nodes/${node.node_id}?v=${node.version}`,
                title: node.title,
                excerpt: node.content.slice(0, 200),
                confidence: node.confidence,
                verified_at: node.valid_from
              }
            ];

      results.push({
        node_id: node.node_id,
        project_id: node.project_id,
        workspace_id: node.workspace_id,
        title: node.title,
        excerpt: node.content.slice(0, 240),
        retrieval_mode: mode,
        lexical_bm25_score: bm25Score,
        vector_cosine_score: cosineScore,
        graph_centrality_boost: centralityBoost,
        reranked_final_score: finalScore,
        stale_decay_alert: node.stale,
        stale_reason: node.stale_reason,
        version: node.version,
        citations: ensuredCitations
      });
    }

    const sorted = results
      .sort((a, b) => b.reranked_final_score - a.reranked_final_score)
      .slice(0, Math.max(1, topK));

    this.searchCache.set(cacheKey, sorted);
    return sorted.map((item) => ({ ...item }));
  }

  /**
   * F100, F111, F123: Propagate staleness across dependent claims when an upstream artifact changes.
   * Respects project boundaries and traverses `derived_from`, `cites`, and `supports` relations.
   */
  public invalidateSourceAndPropagateStaleness(
    sourceNodeId: string,
    projectId?: string,
    reason = "Upstream source modified"
  ): string[] {
    const rootNode = this.nodes.get(sourceNodeId);
    if (!rootNode) {
      return [];
    }
    const effectiveProjectId = projectId ?? rootNode.project_id;
    if (rootNode.project_id !== effectiveProjectId) {
      throw new Error(
        `Project isolation violation: node '${sourceNodeId}' belongs to '${rootNode.project_id}', not '${effectiveProjectId}'`
      );
    }

    const invalidated: string[] = [];
    const queue: string[] = [sourceNodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (node && node.project_id === effectiveProjectId) {
        node.stale = true;
        node.stale_reason = reason;
        invalidated.push(currentId);
      }

      for (const edge of this.edges.values()) {
        if (edge.project_id !== effectiveProjectId) continue;
        // Dependent node -> (derived_from | cites) -> currentId
        if (
          (edge.relation === "derived_from" || edge.relation === "cites") &&
          edge.to_node_id === currentId
        ) {
          queue.push(edge.from_node_id);
        }
        // currentId -> (supports) -> Dependent claim
        if (edge.relation === "supports" && edge.from_node_id === currentId) {
          queue.push(edge.to_node_id);
        }
      }
    }

    this.invalidateProjectCache(effectiveProjectId);
    return invalidated;
  }

  /**
   * F103, F123: Contradiction & Knowledge Decay Audit within a project
   */
  public auditKnowledgeIntegrity(projectId: string): ContradictionAuditReport {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("projectId is required for auditKnowledgeIntegrity");
    }

    const contradictions: ContradictionAuditReport["contradiction_pairs"] = [];
    for (const edge of this.edges.values()) {
      if (edge.project_id === projectId && edge.relation === "contradicts") {
        const a = this.nodes.get(edge.from_node_id);
        const b = this.nodes.get(edge.to_node_id);
        if (a && b && a.project_id === projectId && b.project_id === projectId) {
          contradictions.push({
            node_a_id: a.node_id,
            node_b_id: b.node_id,
            description: `Claim '${a.title}' directly contradicts '${b.title}'`,
            resolution_recommendation:
              a.valid_from >= b.valid_from
                ? `Supersede '${b.node_id}' with newer evidence from '${a.node_id}'`
                : `Supersede '${a.node_id}' with newer evidence from '${b.node_id}'`
          });
        }
      }
    }

    const projectNodes = [...this.nodes.values()].filter((n) => n.project_id === projectId);
    const staleNodes = projectNodes.filter((n) => n.stale).map((n) => n.node_id);
    const total = Math.max(1, projectNodes.length);
    const freshnessScore = Number(((total - staleNodes.length) / total).toFixed(2));

    return {
      project_id: projectId,
      contradiction_pairs: contradictions,
      stale_nodes_flagged: staleNodes,
      freshness_score: freshnessScore
    };
  }

  public getProjectNodes(projectId: string): KnowledgeNode[] {
    return [...this.nodes.values()].filter((n) => n.project_id === projectId);
  }

  public getProjectChunks(projectId: string, documentId?: string): HierarchicalDocumentChunk[] {
    return [...this.chunks.values()].filter(
      (c) => c.project_id === projectId && (!documentId || c.document_id === documentId)
    );
  }

  private invalidateProjectCache(projectId: string): void {
    for (const key of this.searchCache.keys()) {
      if (key.startsWith(`${projectId}::`)) {
        this.searchCache.delete(key);
      }
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < len; i++) {
      const va = a[i] ?? 0;
      const vb = b[i] ?? 0;
      dot += va * vb;
      magA += va * va;
      magB += vb * vb;
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }
}
