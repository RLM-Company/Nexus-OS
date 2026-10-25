import { verifyF097Module } from "./f097-kosmora-graph-workspaces.js";
import { verifyF098Module } from "./f098-intelligence-graph-layers.js";
import { verifyF099Module } from "./f099-entity-relation-extractor.js";
import { verifyF100Module } from "./f100-hybrid-vector-graph-keyword-rag.js";
import { verifyF101Module } from "./f101-graph-context-prompt-injector.js";
import { verifyF102Module } from "./f102-interactive-2d-3d-graph-navigator.js";
import { verifyF103Module } from "./f103-working-memory-session-buffer.js";
import { verifyF104Module } from "./f104-episodic-workspace-memory.js";
import { verifyF105Module } from "./f105-entity-deduplication-resolver.js";
import { verifyF106Module } from "./f106-temporal-knowledge-graph-tracker.js";
import { verifyF107Module } from "./f107-pinned-core-context-nodes.js";
import { verifyF108Module } from "./f108-background-dialogue-summarizer.js";
import { verifyF109Module } from "./f109-hierarchical-semantic-chunker.js";
import { verifyF110Module } from "./f110-cross-document-citation-linker.js";
import { verifyF111Module } from "./f111-cross-encoder-search-reranker.js";
import { verifyF112Module } from "./f112-knowledge-decay-alerter.js";
import { verifyF113Module } from "./f113-cross-workspace-memory-isolation.js";
import { verifyF114Module } from "./f114-global-shared-knowledge-bridge.js";
import { verifyF115Module } from "./f115-context-window-xray-inspector.js";
import { verifyF116Module } from "./f116-smart-context-pruner.js";
import { verifyF117Module } from "./f117-subgraph-jsonld-graphml-porter.js";
import { verifyF118Module } from "./f118-node-tagging-custom-metadata.js";
import { verifyF119Module } from "./f119-graph-gap-analyzer.js";
import { verifyF120Module } from "./f120-domain-ontology-generator.js";
import { verifyF121Module } from "./f121-natural-language-graph-querier.js";
import { verifyF122Module } from "./f122-incremental-embedding-cache.js";
import { verifyF123Module } from "./f123-workspace-preference-profiler.js";
import { verifyF124Module } from "./f124-conversation-tree-forking.js";
import { verifyF125Module } from "./f125-parallel-chat-branch-merger.js";
import { verifyF126Module } from "./f126-github-commit-pr-graph-indexer.js";
import { verifyF127Module } from "./f127-global-cmdk-omni-search.js";
import { verifyF128Module } from "./f128-graph-change-impact-analyzer.js";

// Stage Barrel Export for packages/core/src/stage4-intelligence-graph (32 feature modules)
export * from "./stage-kernel.js";
export * from "./f097-kosmora-graph-workspaces.js";
export * from "./f098-intelligence-graph-layers.js";
export * from "./f099-entity-relation-extractor.js";
export * from "./f100-hybrid-vector-graph-keyword-rag.js";
export * from "./f101-graph-context-prompt-injector.js";
export * from "./f102-interactive-2d-3d-graph-navigator.js";
export * from "./f103-working-memory-session-buffer.js";
export * from "./f104-episodic-workspace-memory.js";
export * from "./f105-entity-deduplication-resolver.js";
export * from "./f106-temporal-knowledge-graph-tracker.js";
export * from "./f107-pinned-core-context-nodes.js";
export * from "./f108-background-dialogue-summarizer.js";
export * from "./f109-hierarchical-semantic-chunker.js";
export * from "./f110-cross-document-citation-linker.js";
export * from "./f111-cross-encoder-search-reranker.js";
export * from "./f112-knowledge-decay-alerter.js";
export * from "./f113-cross-workspace-memory-isolation.js";
export * from "./f114-global-shared-knowledge-bridge.js";
export * from "./f115-context-window-xray-inspector.js";
export * from "./f116-smart-context-pruner.js";
export * from "./f117-subgraph-jsonld-graphml-porter.js";
export * from "./f118-node-tagging-custom-metadata.js";
export * from "./f119-graph-gap-analyzer.js";
export * from "./f120-domain-ontology-generator.js";
export * from "./f121-natural-language-graph-querier.js";
export * from "./f122-incremental-embedding-cache.js";
export * from "./f123-workspace-preference-profiler.js";
export * from "./f124-conversation-tree-forking.js";
export * from "./f125-parallel-chat-branch-merger.js";
export * from "./f126-github-commit-pr-graph-indexer.js";
export * from "./f127-global-cmdk-omni-search.js";
export * from "./f128-graph-change-impact-analyzer.js";

export function verifyStage_stage4_intelligence_graph(): Array<{ featureId: string; passed: boolean; executionId: string; provenanceDigest: string }> {
  return [
    verifyF097Module(),
    verifyF098Module(),
    verifyF099Module(),
    verifyF100Module(),
    verifyF101Module(),
    verifyF102Module(),
    verifyF103Module(),
    verifyF104Module(),
    verifyF105Module(),
    verifyF106Module(),
    verifyF107Module(),
    verifyF108Module(),
    verifyF109Module(),
    verifyF110Module(),
    verifyF111Module(),
    verifyF112Module(),
    verifyF113Module(),
    verifyF114Module(),
    verifyF115Module(),
    verifyF116Module(),
    verifyF117Module(),
    verifyF118Module(),
    verifyF119Module(),
    verifyF120Module(),
    verifyF121Module(),
    verifyF122Module(),
    verifyF123Module(),
    verifyF124Module(),
    verifyF125Module(),
    verifyF126Module(),
    verifyF127Module(),
    verifyF128Module()
  ];
}
