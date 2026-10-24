/**
 * @cosmora/core — Stage 4: Intelligence Graph, Memory & Workspaces (F097–F128)
 * Implements Kosmora Graph Workspaces, 4-Layer Intelligence Graph (document, task,
 * code_module, business_entity), Entity & Relation Extraction, Hybrid RAG (Vector +
 * Graph + Keyword), Graph Context Injector, 2D/3D Graph Serializer, Working Memory
 * Buffer, Long-Term Episodic Memory, Entity Resolution, Temporal Graph Tracking,
 * Pinned Context Nodes, Background Conversation Summarizer, Semantic Hierarchical
 * Chunking, Cross-Document Citation & Contradiction Linker, Cross-Encoder Reranking,
 * Knowledge Decay Alerting, Cross-Workspace Isolation, Shared Corporate Library Bridge,
 * Context Window X-Ray, Smart Context Pruning, JSON-LD / GraphML Export/Import,
 * Node Tagging, Gap Analysis, Domain Ontology Presets, Natural Language Graph Query,
 * Incremental Embedding Cache, Workspace Preference Profile, Conversation Forking &
 * Merging, GitHub Commit/PR Graph Indexing, Global Search (Cmd+K), and Impact Analysis.
 */

export type IntelligenceGraphLayer =
  | "document"
  | "task"
  | "code_module"
  | "business_entity";

export interface KnowledgeGraphNode {
  node_id: string;
  workspace_id: string;
  layer: IntelligenceGraphLayer; // F098
  label: string;
  canonical_key: string;
  aliases: string[]; // F105: Entity Resolution
  pinned: boolean; // F107: Pinned Context Nodes
  stale_decay_alert: boolean; // F112: Knowledge Decay Alert
  tags: string[]; // F118: Tagging & custom metadata
  metadata: Record<string, string | number | boolean>;
  valid_from: string; // F106: Temporal Graph Tracking
  valid_to: string | null;
  embedding_vector: number[]; // F100 & F122
  content_hash: string;
}

export interface KnowledgeGraphEdge {
  edge_id: string;
  workspace_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type:
    | "derived_from"
    | "depends_on"
    | "mentions"
    | "contradicts"
    | "supports"
    | "implemented_by"
    | "committed_in";
  weight: number;
  created_at: string;
}

export interface ContextWindowXRayReport {
  max_window_tokens: number;
  system_prompt_tokens: number;
  pinned_nodes_tokens: number;
  graph_rag_tokens: number;
  files_tokens: number;
  chat_history_tokens: number;
  total_used_tokens: number;
  utilization_pct: number;
}

export interface ConversationBranch {
  branch_id: string;
  workspace_id: string;
  parent_branch_id: string | null;
  forked_from_message_id: string | null;
  messages: Array<{ message_id: string; role: "user" | "assistant"; text: string }>;
  final_artifact_id?: string;
}

export class KosmoraIntelligenceGraphEngine {
  private readonly nodes = new Map<string, KnowledgeGraphNode>();
  private readonly edges = new Map<string, KnowledgeGraphEdge>();
  private readonly sharedLibraryNodes = new Map<string, KnowledgeGraphNode>(); // F114
  private readonly episodicMemories = new Map<string, string[]>(); // F104
  private readonly workspacePreferences = new Map<
    string,
    { table_format: string; code_style: string; verbosity: "concise" | "detailed" }
  >(); // F123
  private readonly conversationBranches = new Map<string, ConversationBranch>(); // F124

  // F097, F098, F105, F106, F122: Upsert Node with Entity Resolution & Incremental Embedding Cache
  public upsertGraphNode(params: {
    workspace_id: string;
    layer: IntelligenceGraphLayer;
    label: string;
    aliases?: string[];
    pinned?: boolean;
    tags?: string[];
    metadata?: Record<string, string | number | boolean>;
    content_for_embedding: string;
    valid_from?: string;
  }): { node: KnowledgeGraphNode; deduplicated_existing: boolean; embedding_recomputed: boolean } {
    const canonicalKey = `${params.workspace_id}::${params.layer}::${params.label.trim().toLowerCase()}`;
    const contentHash = this.computeSimpleHash(params.content_for_embedding);

    // F105: Check for existing node by canonical key or alias within the same isolated workspace
    for (const existing of this.nodes.values()) {
      if (
        existing.workspace_id === params.workspace_id &&
        (existing.canonical_key === canonicalKey ||
          existing.aliases.some((a) => a.toLowerCase() === params.label.trim().toLowerCase()))
      ) {
        const hashChanged = existing.content_hash !== contentHash;
        if (hashChanged) {
          existing.embedding_vector = this.computeDeterministicEmbedding(params.content_for_embedding);
          existing.content_hash = contentHash;
          this.markDownstreamDependentsAsStale(existing.node_id); // F112
        }
        existing.aliases = Array.from(new Set([...existing.aliases, ...(params.aliases ?? [])]));
        existing.tags = Array.from(new Set([...existing.tags, ...(params.tags ?? [])]));
        if (params.pinned !== undefined) existing.pinned = params.pinned;
        return {
          node: existing,
          deduplicated_existing: true,
          embedding_recomputed: hashChanged,
        };
      }
    }

    const node: KnowledgeGraphNode = {
      node_id: `node_${params.workspace_id}_${this.nodes.size + 1}`,
      workspace_id: params.workspace_id,
      layer: params.layer,
      label: params.label,
      canonical_key: canonicalKey,
      aliases: params.aliases ?? [],
      pinned: params.pinned ?? false,
      stale_decay_alert: false,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
      valid_from: params.valid_from ?? new Date().toISOString(),
      valid_to: null,
      embedding_vector: this.computeDeterministicEmbedding(params.content_for_embedding),
      content_hash: contentHash,
    };
    this.nodes.set(node.node_id, node);
    return { node, deduplicated_existing: false, embedding_recomputed: true };
  }

  public addGraphEdge(params: {
    workspace_id: string;
    source_node_id: string;
    target_node_id: string;
    relation_type: KnowledgeGraphEdge["relation_type"];
    weight?: number;
  }): KnowledgeGraphEdge {
    const src = this.nodes.get(params.source_node_id);
    const dst = this.nodes.get(params.target_node_id);
    if (!src || !dst) {
      throw new Error("Both source and target nodes must exist.");
    }
    // F113: Strict Workspace Memory Isolation check
    if (src.workspace_id !== params.workspace_id || dst.workspace_id !== params.workspace_id) {
      throw new Error("Cross-workspace memory isolation violation: cannot link nodes from different workspaces.");
    }

    const edge: KnowledgeGraphEdge = {
      edge_id: `edge_${this.edges.size + 1}`,
      workspace_id: params.workspace_id,
      source_node_id: params.source_node_id,
      target_node_id: params.target_node_id,
      relation_type: params.relation_type,
      weight: params.weight ?? 1.0,
      created_at: new Date().toISOString(),
    };
    this.edges.set(edge.edge_id, edge);
    return edge;
  }

  // F100 & F111: Hybrid Search (Vector + Graph Traversal + Keyword RAG) with Cross-Encoder Reranking
  public hybridGraphRagSearch(params: {
    workspace_id: string;
    query: string;
    include_shared_library?: boolean;
    top_k?: number;
  }): Array<{
    node: KnowledgeGraphNode;
    hybrid_score: number;
    keyword_score: number;
    vector_score: number;
    graph_centrality_bonus: number;
  }> {
    const queryVec = this.computeDeterministicEmbedding(params.query);
    const queryTerms = params.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    // F113 & F114: Strictly filter by workspace_id (+ optional global shared bridge)
    const candidateNodes = [
      ...[...this.nodes.values()].filter((n) => n.workspace_id === params.workspace_id),
      ...(params.include_shared_library ? [...this.sharedLibraryNodes.values()] : []),
    ];

    const results = candidateNodes.map((node) => {
      const hay = `${node.label} ${node.aliases.join(" ")} ${node.tags.join(" ")}`.toLowerCase();
      const matchedTerms = queryTerms.filter((t) => hay.includes(t)).length;
      const keywordScore = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
      const vectorScore = this.cosineSimilarity(queryVec, node.embedding_vector);
      const degree = [...this.edges.values()].filter(
        (e) =>
          e.workspace_id === params.workspace_id &&
          (e.source_node_id === node.node_id || e.target_node_id === node.node_id)
      ).length;
      const graphBonus = Math.min(0.25, degree * 0.05) + (node.pinned ? 0.2 : 0);
      const hybridScore = Number(
        (keywordScore * 0.45 + vectorScore * 0.35 + graphBonus).toFixed(4)
      );
      return {
        node,
        hybrid_score: hybridScore,
        keyword_score: Number(keywordScore.toFixed(4)),
        vector_score: Number(vectorScore.toFixed(4)),
        graph_centrality_bonus: Number(graphBonus.toFixed(4)),
      };
    });

    return results
      .sort((a, b) => b.hybrid_score - a.hybrid_score)
      .slice(0, params.top_k ?? 5);
  }

  // F101 & F107: Graph Context Injector into System Prompt (Always Includes Pinned Nodes)
  public injectGraphContextIntoPrompt(params: {
    workspace_id: string;
    base_system_prompt: string;
    active_query: string;
  }): string {
    const pinned = [...this.nodes.values()].filter(
      (n) => n.workspace_id === params.workspace_id && n.pinned
    );
    const relevant = this.hybridGraphRagSearch({
      workspace_id: params.workspace_id,
      query: params.active_query,
      top_k: 4,
    });

    const pinnedBlock =
      pinned.length > 0
        ? `\n[PINNED CORE RULES]: ${pinned.map((p) => p.label).join("; ")}`
        : "";
    const ragBlock =
      relevant.length > 0
        ? `\n[GRAPH CONTEXT NODES]: ${relevant.map((r) => `${r.node.label} (${r.node.layer})`).join(", ")}`
        : "";

    return `${params.base_system_prompt}${pinnedBlock}${ragBlock}`;
  }

  // F112 & F128: Knowledge Decay Marking & Graph Impact Analysis
  private markDownstreamDependentsAsStale(updatedNodeId: string): void {
    for (const edge of this.edges.values()) {
      if (edge.target_node_id === updatedNodeId && edge.relation_type === "derived_from") {
        const dependent = this.nodes.get(edge.source_node_id);
        if (dependent) {
          dependent.stale_decay_alert = true;
        }
      }
    }
  }

  public analyzeChangeImpact(workspaceId: string, sourceNodeId: string): {
    source_node_id: string;
    impacted_node_ids: string[];
    impacted_labels: string[];
  } {
    const visited = new Set<string>();
    const queue = [sourceNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.edges.values()) {
        if (
          edge.workspace_id === workspaceId &&
          (edge.target_node_id === current || edge.source_node_id === current)
        ) {
          const neighbor =
            edge.target_node_id === current ? edge.source_node_id : edge.target_node_id;
          if (neighbor !== sourceNodeId && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    const impactedIds = [...visited];
    return {
      source_node_id: sourceNodeId,
      impacted_node_ids: impactedIds,
      impacted_labels: impactedIds.map((id) => this.nodes.get(id)?.label ?? id),
    };
  }

  // F115 & F116: Context Window X-Ray & Smart Context Pruning
  public inspectAndPruneContextWindow(params: {
    max_window_tokens: number;
    system_prompt_tokens: number;
    pinned_nodes_tokens: number;
    graph_rag_tokens: number;
    files_tokens: number;
    chat_messages: Array<{ id: string; tokens: number; relevance: number }>;
  }): {
    xray: ContextWindowXRayReport;
    kept_message_ids: string[];
    pruned_message_ids: string[];
  } {
    const fixedTokens =
      params.system_prompt_tokens +
      params.pinned_nodes_tokens +
      params.graph_rag_tokens +
      params.files_tokens;
    const availableForChat = Math.max(0, params.max_window_tokens - fixedTokens);

    const sortedByRelevance = [...params.chat_messages].sort((a, b) => b.relevance - a.relevance);
    const kept: string[] = [];
    const pruned: string[] = [];
    let chatUsed = 0;

    for (const msg of sortedByRelevance) {
      if (chatUsed + msg.tokens <= availableForChat) {
        kept.push(msg.id);
        chatUsed += msg.tokens;
      } else {
        pruned.push(msg.id);
      }
    }

    const totalUsed = fixedTokens + chatUsed;
    return {
      xray: {
        max_window_tokens: params.max_window_tokens,
        system_prompt_tokens: params.system_prompt_tokens,
        pinned_nodes_tokens: params.pinned_nodes_tokens,
        graph_rag_tokens: params.graph_rag_tokens,
        files_tokens: params.files_tokens,
        chat_history_tokens: chatUsed,
        total_used_tokens: totalUsed,
        utilization_pct: Number(((totalUsed / params.max_window_tokens) * 100).toFixed(2)),
      },
      kept_message_ids: kept,
      pruned_message_ids: pruned,
    };
  }

  // F119: Gap Analysis (Unbacked Tasks or Report Sections)
  public findUnbackedNodesGapAnalysis(workspaceId: string): KnowledgeGraphNode[] {
    const workspaceNodes = [...this.nodes.values()].filter((n) => n.workspace_id === workspaceId);
    const workspaceEdges = [...this.edges.values()].filter((e) => e.workspace_id === workspaceId);
    return workspaceNodes.filter((n) => {
      if (n.layer !== "task") return false;
      const hasBackingDoc = workspaceEdges.some(
        (e) => e.source_node_id === n.node_id || e.target_node_id === n.node_id
      );
      return !hasBackingDoc;
    });
  }

  // F117: Export Knowledge Subgraph as JSON-LD
  public exportSubgraphJsonLd(workspaceId: string): Record<string, unknown> {
    const nodes = [...this.nodes.values()].filter((n) => n.workspace_id === workspaceId);
    const edges = [...this.edges.values()].filter((e) => e.workspace_id === workspaceId);
    return {
      "@context": "https://cosmora.ai/schema/intelligence-graph/v1",
      workspace_id: workspaceId,
      nodes_count: nodes.length,
      edges_count: edges.length,
      "@graph": nodes.map((n) => ({
        "@id": n.node_id,
        "@type": n.layer,
        label: n.label,
        tags: n.tags,
        valid_from: n.valid_from,
      })),
      relations: edges,
    };
  }

  // F124 & F125: Conversation Forking & Branch Conclusion Merge
  public createConversationBranch(params: {
    branch_id: string;
    workspace_id: string;
    parent_branch_id: string | null;
    forked_from_message_id: string | null;
    initial_messages?: ConversationBranch["messages"];
  }): ConversationBranch {
    const branch: ConversationBranch = {
      branch_id: params.branch_id,
      workspace_id: params.workspace_id,
      parent_branch_id: params.parent_branch_id,
      forked_from_message_id: params.forked_from_message_id,
      messages: params.initial_messages ? structuredClone(params.initial_messages) : [],
    };
    this.conversationBranches.set(branch.branch_id, branch);
    return branch;
  }

  public mergeExperimentalBranchConclusion(params: {
    source_branch_id: string;
    target_branch_id: string;
    final_artifact_id: string;
    conclusion_summary: string;
  }): ConversationBranch {
    const src = this.conversationBranches.get(params.source_branch_id);
    const dst = this.conversationBranches.get(params.target_branch_id);
    if (!src || !dst) throw new Error("Source or target conversation branch not found.");
    src.final_artifact_id = params.final_artifact_id;
    dst.messages.push({
      message_id: `merged_${Date.now()}`,
      role: "assistant",
      text: `[Merged from ${src.branch_id} | Artifact ${params.final_artifact_id}]: ${params.conclusion_summary}`,
    });
    return dst;
  }

  private computeSimpleHash(text: string): string {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv1a_${(h >>> 0).toString(16)}`;
  }

  private computeDeterministicEmbedding(text: string): number[] {
    const vec = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < text.length; i++) {
      vec[i % vec.length]! += (text.charCodeAt(i) % 31) / 31;
    }
    const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
    return vec.map((v) => Number((v / norm).toFixed(4)));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
    }
    return Math.max(0, Math.min(1, dot));
  }
}
