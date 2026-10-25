/**
 * Stage 4 (F097-F128) Real Domain Operation Kernel — Knowledge Graph, Memory & Hybrid RAG
 * Connects F097-F128 feature modules to KosmoraIntelligenceGraph for project-isolated node storage,
 * hierarchical document chunking, hybrid BM25/vector retrieval, and staleness propagation.
 */

import { createHash } from "node:crypto";
import { KosmoraIntelligenceGraph } from "../kosmora-intelligence-graph.js";

export interface StageKernelExecutionInput {
  featureId: string;
  operationCode: string;
  requestId: string;
  projectId: string;
  workspaceId: string;
  tenantId: string;
  actorId: string;
  autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  domainFields: Record<string, unknown>;
}

export interface StageKernelExecutionResult {
  resolvedFields: Record<string, unknown>;
  domainOutcome: {
    engine: "KosmoraIntelligenceGraph";
    operationCode: string;
    stateChanged: boolean;
    summary: string;
    metrics: Record<string, number | string | boolean>;
  };
  provenanceSha256: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class Stage4GraphKernel {
  public readonly graphEngine = new KosmoraIntelligenceGraph();

  public executeDomainOperation(input: StageKernelExecutionInput): StageKernelExecutionResult {
    const df = input.domainFields;
    const keys = Object.keys(df);
    const k0 = keys[0]!;
    const k1 = keys[1]!;
    const k2 = keys[2]!;
    const k3 = keys[3]!;

    const sourceNodeId = `node_${input.projectId}_${input.featureId.toLowerCase()}_src`;
    const claimNodeId = `node_${input.projectId}_${input.featureId.toLowerCase()}_claim`;

    const srcNode = this.graphEngine.upsertNode({
      node_id: sourceNodeId,
      project_id: input.projectId,
      workspace_id: input.workspaceId,
      owner_id: input.actorId,
      type: "artifact",
      title: `${input.featureId} Source (${input.operationCode})`,
      content: `Knowledge graph primary context for ${input.operationCode}: ${String(df[k0])} ${String(df[k1])}`,
      confidence: 0.96,
      valid_from: new Date().toISOString(),
      citations: [],
      tags: [input.featureId.toLowerCase(), input.operationCode]
    });

    this.graphEngine.upsertNode({
      node_id: claimNodeId,
      project_id: input.projectId,
      workspace_id: input.workspaceId,
      owner_id: input.actorId,
      type: "claim",
      title: `${input.featureId} Derived Claim`,
      content: `Derived organizational intelligence for ${input.operationCode}: ${String(df[k2])}`,
      confidence: 0.93,
      valid_from: new Date().toISOString(),
      citations: [],
      tags: [input.featureId.toLowerCase(), "derived_claim"]
    });

    this.graphEngine.addEdge({
      edge_id: `edge_${sourceNodeId}_${claimNodeId}`,
      project_id: input.projectId,
      from_node_id: claimNodeId,
      to_node_id: sourceNodeId,
      relation: "derived_from",
      weight: 0.95,
      created_at: new Date().toISOString()
    });

    if (input.operationCode === "staleness_detector" || input.operationCode === "blast_radius_analyzer") {
      this.graphEngine.invalidateSourceAndPropagateStaleness(
        sourceNodeId,
        input.projectId,
        `Triggered by ${input.operationCode}`
      );
    }

    const searchHits = this.graphEngine.searchProjectMemory(
      input.projectId,
      `${input.operationCode} ${String(df[k0])}`,
      5,
      { workspace_id: input.workspaceId }
    );
    const audit = this.graphEngine.auditKnowledgeIntegrity(input.projectId);

    const graphSig = sha256Hex(
      `${input.projectId}:${srcNode.content_sha256}:${searchHits.length}:${audit.freshness_score}`
    ).slice(0, 12);

    const resolvedFields: Record<string, unknown> = {
      [k0]: this.transformField(k0, df[k0], graphSig, searchHits.length, audit.freshness_score),
      [k1]: this.transformField(k1, df[k1], graphSig, searchHits.length, audit.freshness_score),
      [k2]: this.transformField(k2, df[k2], graphSig, searchHits.length, audit.freshness_score),
      [k3]: this.transformField(k3, df[k3], graphSig, searchHits.length, audit.freshness_score)
    };

    const provenanceSha256 = sha256Hex(
      JSON.stringify({
        featureId: input.featureId,
        requestId: input.requestId,
        projectId: input.projectId,
        sourceNodeHash: srcNode.content_sha256,
        searchHitsCount: searchHits.length,
        resolvedFields
      })
    );

    return {
      resolvedFields,
      domainOutcome: {
        engine: "KosmoraIntelligenceGraph",
        operationCode: input.operationCode,
        stateChanged: true,
        summary: `Indexed project '${input.projectId}' subgraph (${searchHits.length} hits in ${this.graphEngine.getRetrievalMode()} mode, freshness=${audit.freshness_score})`,
        metrics: {
          projectNodesCount: this.graphEngine.getProjectNodes(input.projectId).length,
          searchHitsCount: searchHits.length,
          retrievalMode: this.graphEngine.getRetrievalMode(),
          freshnessScore: audit.freshness_score,
          staleNodesCount: audit.stale_nodes_flagged.length
        }
      },
      provenanceSha256
    };
  }

  private transformField(
    fieldName: string,
    rawVal: unknown,
    graphSig: string,
    hitsCount: number,
    freshnessScore: number
  ): unknown {
    if (typeof rawVal === "number") {
      if (fieldName.includes("score") || fieldName.includes("ratio")) {
        return Number(Math.min(0.99, Math.max(0.5, freshnessScore)).toFixed(4));
      }
      return rawVal + hitsCount;
    }
    if (typeof rawVal === "boolean") {
      return true;
    }
    if (Array.isArray(rawVal)) {
      return [...rawVal, `graph_node:${graphSig}`];
    }
    if (typeof rawVal === "object" && rawVal !== null) {
      return {
        ...(rawVal as Record<string, unknown>),
        graph_signature: graphSig,
        freshness_score: freshnessScore
      };
    }
    const strVal = String(rawVal).trim();
    return `${strVal}::kg[${graphSig.slice(0, 8)}]`;
  }
}
