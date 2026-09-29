import { describe, expect, it } from "vitest";
import { IntelligenceGraphIndex } from "../src/index.js";
import {
  COSMORA_UNIFIED_BRIDGE_COUNT,
  cosmoraUnifiedKnowledgeGraph
} from "./fixtures/cosmora-unified-knowledge-graph.js";
import { repositoryStructureFileId } from "./fixtures/cosmora-repository-structure-graph.js";

const createIndex = () => {
  const graph = cosmoraUnifiedKnowledgeGraph();
  return new IntelligenceGraphIndex({
    ownerId: "owner-cosmora",
    projectId: "project-nexus-os",
    ...graph
  });
};

describe("unified Cosmora Intelligence Graph", () => {
  it("assembles semantic and structural knowledge into one validated graph", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();

    expect(COSMORA_UNIFIED_BRIDGE_COUNT).toBe(30);
    expect(graph.nodes).toHaveLength(286);
    expect(graph.records).toHaveLength(286);
    expect(graph.edges).toHaveLength(775);

    expect(
      new Set(graph.nodes.map((node) => `${node.node_id}@${node.node_version}`)).size
    ).toBe(286);
    expect(
      new Set(graph.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).size
    ).toBe(775);

    expect(() => createIndex()).not.toThrow();
  });

  it("bridges Manager policy knowledge to the exact runtime implementation file", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const managerFile = repositoryStructureFileId(
      "apps/api/src/manager-work-coordinator.ts"
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "IMPLEMENTED_IN_FILE" &&
          edge.from.id === "artifact-manager-work-runtime" &&
          edge.to.id === managerFile
      )
    ).toBe(true);

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "IMPORTS_MODULE" &&
          edge.from.id === managerFile &&
          edge.to.id === "module:packages/tool-runtime"
      )
    ).toBe(true);
  });

  it("can traverse from a semantic Manager constraint into real code dependencies", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "Manager publish files requires workspace write capability Policy Engine",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 3,
        max_nodes: 60,
        max_edges: 100,
        max_fan_out: 40,
        max_context_tokens: 8_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("claim-manager-publish-workspace-write");
    expect(ids).toContain("artifact-manager-work-runtime");
    expect(ids).toContain(
      repositoryStructureFileId("apps/api/src/manager-work-coordinator.ts")
    );
    expect(ids).toContain("module:packages/tool-runtime");
  });

  it("joins Model Registry semantics to its contract file and implementation module", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const registryContract = repositoryStructureFileId(
      "packages/contracts/src/model-registry.ts"
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "DEFINED_IN_FILE" &&
          edge.from.id === "entity-model-registry" &&
          edge.to.id === registryContract
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "IMPLEMENTED_BY_MODULE" &&
          edge.from.id === "entity-model-registry" &&
          edge.to.id === "module:packages/model-gateway"
      )
    ).toBe(true);
  });

  it("joins runtime context safety rules to their concrete contract files", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const runtimeState = repositoryStructureFileId(
      "packages/contracts/src/manager-runtime-state.ts"
    );
    const contextValidation = repositoryStructureFileId(
      "packages/contracts/src/manager-runtime-context-validation.ts"
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "DEFINED_IN_FILE" &&
          edge.from.id === "entity-runtime-context" &&
          edge.to.id === runtimeState
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "RESOLVES_TO_FILE" &&
          edge.from.id === "doc-runtime-context-validation" &&
          edge.to.id === contextValidation
      )
    ).toBe(true);
  });

  it("joins durable state concepts to the stores that persist them", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const expected = [
      ["entity-manager-work", "packages/db/src/manager-work-store.ts"],
      ["entity-project-usage", "packages/db/src/usage-store.ts"],
      ["entity-identity-session", "packages/db/src/identity-store.ts"],
      ["entity-step-up-proof", "packages/db/src/step-up-proof-store.ts"]
    ] as const;

    for (const [semanticId, path] of expected) {
      expect(
        graph.edges.some(
          (edge) =>
            edge.type === "PERSISTED_BY" &&
            edge.from.id === semanticId &&
            edge.to.id === repositoryStructureFileId(path)
        )
      ).toBe(true);
    }
  });

  it("connects implementation history to the exact files changed by real commits", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const managerCoordinator = repositoryStructureFileId(
      "apps/api/src/manager-work-coordinator.ts"
    );
    const authContract = repositoryStructureFileId("packages/contracts/src/auth.ts");
    const modelOptions = repositoryStructureFileId(
      "packages/core/src/model-service-options.ts"
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "CHANGED_FILE" &&
          edge.from.id === "event-manager-runtime" &&
          edge.to.id === managerCoordinator
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "CHANGED_FILE" &&
          edge.from.id === "event-auth-contract" &&
          edge.to.id === authContract
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "CHANGED_FILE" &&
          edge.from.id === "event-core-model-request-bounds" &&
          edge.to.id === modelOptions
      )
    ).toBe(true);
  });

  it("preserves the recent hardening chronology as real work experience", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(
      graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`)
    );

    expect(pairs).toContain(
      "event-core-model-request-bounds|PRECEDES|event-model-request-contract-bounds"
    );
    expect(pairs).toContain(
      "event-model-request-contract-bounds|PRECEDES|event-stream-metadata-hardening"
    );
    expect(pairs).toContain(
      "event-stream-metadata-hardening|PRECEDES|event-companion-contract"
    );
    expect(pairs).toContain(
      "event-auth-contract|PRECEDES|event-manager-runtime"
    );
  });

  it("retrieves concrete files from a real hardening event", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "core direct model request limits manager chat hardening",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 1,
        max_nodes: 12,
        max_edges: 12,
        max_fan_out: 8,
        max_context_tokens: 2_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("event-core-model-request-bounds");
    expect(ids).toContain(
      repositoryStructureFileId("packages/core/src/model-service-options.ts")
    );
    expect(
      packet.edges.some(
        (edge) =>
          edge.type === "CHANGED_FILE" &&
          edge.from.id === "event-core-model-request-bounds"
      )
    ).toBe(true);
  });

  it("keeps every bridge evidence-grounded and specifically typed", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const bridgeEdges = graph.edges.filter((edge) =>
      edge.extractor_version === "repository-bridge-v1"
    );

    expect(bridgeEdges).toHaveLength(30);
    expect(bridgeEdges.every((edge) => edge.evidence_ref.location.includes("/"))).toBe(
      true
    );
    expect(bridgeEdges.some((edge) => edge.type === "RELATES_TO")).toBe(false);
  });
});
