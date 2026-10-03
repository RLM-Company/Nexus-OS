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
    expect(graph.nodes).toHaveLength(403);
    expect(graph.records).toHaveLength(403);
    expect(graph.edges).toHaveLength(1084);

    expect(new Set(graph.nodes.map((node) => `${node.node_id}@${node.node_version}`)).size).toBe(
      403
    );
    expect(new Set(graph.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).size).toBe(
      1084
    );

    expect(() => createIndex()).not.toThrow();
  });

  it("bridges Manager policy knowledge to the exact runtime implementation file", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const managerFile = repositoryStructureFileId("apps/api/src/manager-work-coordinator.ts");

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
    expect(ids).toContain(repositoryStructureFileId("apps/api/src/manager-work-coordinator.ts"));
    expect(ids).toContain("module:packages/tool-runtime");
  });

  it("joins Model Registry semantics to its contract file and implementation module", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const registryContract = repositoryStructureFileId("packages/contracts/src/model-registry.ts");

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
    const modelOptions = repositoryStructureFileId("packages/core/src/model-service-options.ts");

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
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "event-core-model-request-bounds|PRECEDES|event-model-request-contract-bounds"
    );
    expect(pairs).toContain(
      "event-model-request-contract-bounds|PRECEDES|event-stream-metadata-hardening"
    );
    expect(pairs).toContain("event-stream-metadata-hardening|PRECEDES|event-companion-contract");
    expect(pairs).toContain("event-auth-contract|PRECEDES|event-manager-runtime");
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
    expect(ids).toContain(repositoryStructureFileId("packages/core/src/model-service-options.ts"));
    expect(
      packet.edges.some(
        (edge) => edge.type === "CHANGED_FILE" && edge.from.id === "event-core-model-request-bounds"
      )
    ).toBe(true);
  });

  it("keeps open PR proposals separate from verified main knowledge", () => {
    const reviewPacket = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "proposal pr 241 critic verdict binding",
      mode: "local",
      verified_only: false,
      budget: { max_nodes: 10, max_edges: 12, max_fan_out: 8 }
    });

    expect(reviewPacket.nodes.map(({ node }) => node.node_id)).toContain(
      "proposal-pr-241-critic-verdict-binding"
    );
    expect(
      reviewPacket.nodes.find(
        ({ node }) => node.node_id === "proposal-pr-241-critic-verdict-binding"
      )?.node.verification_status
    ).toBe("discovered");
    expect(
      reviewPacket.edges.some(
        (edge) =>
          edge.type === "PROPOSES_CONSTRAINT_FOR" &&
          edge.from.id === "proposal-pr-241-critic-verdict-binding" &&
          edge.to.id === "entity-critic-role"
      )
    ).toBe(true);

    const verifiedPacket = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "proposal pr 241 critic verdict binding",
      mode: "local",
      verified_only: true,
      budget: { max_nodes: 10, max_edges: 12, max_fan_out: 8 }
    });

    expect(
      verifiedPacket.nodes.some(
        ({ node }) => node.node_id === "proposal-pr-241-critic-verdict-binding"
      )
    ).toBe(false);
  });

  it("preserves the open Manager hardening stack without promoting it to main", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "proposal-pr-229-manager-execution|STACKED_BEFORE|proposal-pr-237-verification-consistency"
    );
    expect(pairs).toContain(
      "proposal-pr-241-critic-verdict-binding|STACKED_BEFORE|proposal-pr-243-verification-time-order"
    );
    expect(pairs).toContain(
      "proposal-pr-243-verification-time-order|STACKED_BEFORE|proposal-pr-245-result-time-order"
    );
    expect(pairs).toContain(
      "proposal-pr-229-manager-execution|STACKED_BEFORE|proposal-pr-242-manager-schema-boundaries"
    );

    const candidateEdges = graph.edges.filter(
      (edge) => edge.extractor_version === "github-open-review-v1"
    );
    expect(candidateEdges.length).toBeGreaterThan(0);
    expect(candidateEdges.every((edge) => edge.verification_status === "discovered")).toBe(true);
  });

  it("retrieves verified security hardening from merged main history", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "reject padded environment secrets config hardening",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 16,
        max_edges: 20,
        max_fan_out: 10,
        max_context_tokens: 3_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("event-main-bd7508fc");
    expect(ids).toContain(repositoryStructureFileId("packages/config/src/secrets.ts"));
    expect(
      packet.edges.some(
        (edge) => edge.type === "CHANGED_FILE" && edge.from.id === "event-main-bd7508fc"
      )
    ).toBe(true);
  });

  it("preserves merged hardening chronology before later model-request bounds", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("event-main-5d268cb7|PRECEDES|event-main-9d35d7d9");
    expect(pairs).toContain("event-main-9d8b8207|PRECEDES|event-main-bd66e37c");
    expect(pairs).toContain("event-main-bd7508fc|PRECEDES|event-core-model-request-bounds");
  });

  it("keeps open Settings and push-consent work visible but non-authoritative", () => {
    const reviewPacket = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "proposal pr 257 push consent browser permission notifications",
      mode: "local",
      verified_only: false,
      budget: { max_nodes: 12, max_edges: 16, max_fan_out: 10 }
    });

    expect(reviewPacket.nodes.map(({ node }) => node.node_id)).toContain(
      "proposal-pr-257-push-consent"
    );
    expect(
      reviewPacket.edges.some(
        (edge) =>
          edge.type === "REQUIRES_EXPLICIT_CONSENT_FOR" &&
          edge.from.id === "proposal-pr-257-push-consent" &&
          edge.to.id === "entity-companion-gate"
      )
    ).toBe(true);

    const verifiedPacket = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "proposal pr 257 push consent browser permission notifications",
      mode: "local",
      verified_only: true,
      budget: { max_nodes: 12, max_edges: 16, max_fan_out: 10 }
    });

    expect(
      verifiedPacket.nodes.some(({ node }) => node.node_id === "proposal-pr-257-push-consent")
    ).toBe(false);
  });

  it("preserves the Settings review dependency stack", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "proposal-pr-221-settings-foundation|STACKED_BEFORE|proposal-pr-244-notification-reconcile"
    );
    expect(pairs).toContain(
      "proposal-pr-244-notification-reconcile|STACKED_BEFORE|proposal-pr-257-push-consent"
    );
    expect(pairs).toContain(
      "proposal-pr-248-companion-policy-controls|EXPOSES_CONTROL_FOR|entity-companion-gate"
    );
    expect(pairs).toContain(
      "proposal-pr-254-communication-policy-controls|EXPOSES_CONTROL_FOR|candidate-entity-communication-profile"
    );
  });

  it("traverses from a safety rule to its exact regression test", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "delegation never expands tools data budget permission authority",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 16,
        max_edges: 20,
        max_fan_out: 12,
        max_context_tokens: 3_000
      }
    });

    const delegationTest = repositoryStructureFileId(
      "packages/policy-engine/test/agent-delegation.test.ts"
    );
    expect(packet.nodes.map(({ node }) => node.node_id)).toContain(
      "decision-delegation-no-expansion"
    );
    expect(packet.nodes.map(({ node }) => node.node_id)).toContain(delegationTest);
    expect(
      packet.edges.some(
        (edge) =>
          edge.type === "VERIFIED_BY_TEST" &&
          edge.from.id === "decision-delegation-no-expansion" &&
          edge.to.id === delegationTest
      )
    ).toBe(true);
  });

  it("maps Manager runtime constraints to executable API regressions", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const managerWorkTest = repositoryStructureFileId("apps/api/test/manager-work.test.ts");
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      `claim-manager-publish-workspace-write|VERIFIED_BY_TEST|${managerWorkTest}`
    );
    expect(pairs).toContain(`claim-manager-reserves-budget|VERIFIED_BY_TEST|${managerWorkTest}`);
    expect(pairs).toContain(`claim-manager-emergency-stop|VERIFIED_BY_TEST|${managerWorkTest}`);
  });

  it("maps temporal and privacy rules to their regression suites", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const routerTest = repositoryStructureFileId("packages/model-gateway/test/router.test.ts");
    const contextTest = repositoryStructureFileId(
      "packages/contracts/test/manager-runtime-context-validation.test.ts"
    );
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(`decision-route-evidence-freshness|VERIFIED_BY_TEST|${routerTest}`);
    expect(pairs).toContain(`claim-context-private-chat-forbidden|VERIFIED_BY_TEST|${contextTest}`);
  });

  it("preserves the Intelligence Graph implementation dependency split", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "proposal-pr-265-intelligence-graph-kernel|STACKED_BEFORE|proposal-pr-266-intelligence-graph-retrieval"
    );
    expect(pairs).toContain(
      "proposal-pr-266-intelligence-graph-retrieval|STACKED_BEFORE|proposal-pr-267-model-intelligence"
    );
    expect(pairs).toContain(
      "proposal-pr-267-model-intelligence|STACKED_BEFORE|proposal-pr-268-synthetic-scale"
    );
    expect(pairs).toContain(
      "proposal-pr-266-intelligence-graph-retrieval|STACKED_BEFORE|proposal-pr-269-real-knowledge"
    );
    expect(pairs).not.toContain(
      "proposal-pr-264-intelligence-graph-architecture|STACKED_BEFORE|proposal-pr-265-intelligence-graph-kernel"
    );
  });

  it("keeps real knowledge explicitly separate from the synthetic scale benchmark", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "SEPARATES_REAL_KNOWLEDGE_FROM" &&
          edge.from.id === "proposal-pr-269-real-knowledge" &&
          edge.to.id === "proposal-pr-268-synthetic-scale"
      )
    ).toBe(true);
  });

  it("retrieves ordinary-chat background implementation and regression evidence", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "ordinary chat background runtime coordinator",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 16,
        max_edges: 20,
        max_fan_out: 12,
        max_context_tokens: 3_000
      }
    });

    const coordinator = repositoryStructureFileId(
      "apps/api/src/general-chat-background-run-coordinator.ts"
    );
    const regression = repositoryStructureFileId(
      "apps/api/test/general-chat-background-run-coordinator.test.ts"
    );
    const ids = packet.nodes.map(({ node }) => node.node_id);

    expect(ids).toContain("event-product-general-chat-background");
    expect(ids).toContain("entity-general-chat-runtime");
    expect(ids).toContain(coordinator);
    expect(ids).toContain(regression);
  });

  it("links the read-only model status surface to the Model Registry", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("event-product-model-status|PRODUCES|entity-model-status-surface");
    expect(pairs).toContain("entity-model-status-surface|OBSERVES|entity-model-registry");
  });

  it("preserves the product-hardening chronology around the local alpha", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("event-product-live-model-smoke|PRECEDES|event-product-non-api-alpha");
    expect(pairs).toContain("event-product-core-runtime-docs|PRECEDES|event-main-5d268cb7");
    expect(pairs).toContain("event-main-5d268cb7|PRECEDES|event-product-web-runtime-boundaries");
  });

  it("traverses real agent collaboration through shared artifact kinds", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "researcher evidence",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 24,
        max_edges: 32,
        max_fan_out: 16,
        max_context_tokens: 4_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("entity-researcher-role");
    expect(ids).toContain("entity-artifact-kind-evidence");
    expect(ids).toContain("entity-analyst-role");
    expect(ids).toContain("entity-critic-role");

    const pairs = new Set(packet.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    expect(pairs).toContain(
      "entity-researcher-role|EMITS_ARTIFACT_KIND|entity-artifact-kind-evidence"
    );
    expect(pairs).toContain(
      "entity-analyst-role|ACCEPTS_ARTIFACT_KIND|entity-artifact-kind-evidence"
    );
    expect(pairs).toContain(
      "entity-critic-role|ACCEPTS_ARTIFACT_KIND|entity-artifact-kind-evidence"
    );
  });

  it("keeps all five runtime roles under the shared authority boundary", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const constrained = graph.edges.filter(
      (edge) =>
        edge.type === "CONSTRAINED_BY" && edge.to.id === "claim-runtime-roles-no-authority-bypass"
    );

    expect(new Set(constrained.map((edge) => edge.from.id))).toEqual(
      new Set([
        "entity-manager-role",
        "entity-architect-role",
        "entity-researcher-role",
        "entity-analyst-role",
        "entity-critic-role"
      ])
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "VERIFIED_BY_TEST" &&
          edge.from.id === "claim-runtime-roles-no-authority-bypass" &&
          edge.to.id ===
            repositoryStructureFileId("packages/contracts/test/manager-runtime.test.ts")
      )
    ).toBe(true);
  });

  it("preserves Manager delegation and Critic review authority without policy bypass", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("entity-manager-role|CAN_DELEGATE_WITHIN|entity-runtime-task-graph");
    expect(pairs).toContain("entity-critic-role|CAN_REVIEW|entity-runtime-artifact");
  });

  it("retrieves Emergency Stop release-gate evidence through the scenario graph", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "Emergency stop pauses runtime denies new external operations",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 16,
        max_edges: 20,
        max_fan_out: 12,
        max_context_tokens: 3_000
      }
    });

    const runnerTest = repositoryStructureFileId(
      "packages/core/test/manager-runtime-scenario-runner.test.ts"
    );
    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("evaluation-runtime-emergency-stop-v1");
    expect(ids).toContain("claim-manager-emergency-stop");
    expect(ids).toContain(runnerTest);
    expect(
      packet.edges.some(
        (edge) =>
          edge.type === "EXECUTED_BY_TEST" &&
          edge.from.id === "evaluation-runtime-emergency-stop-v1" &&
          edge.to.id === runnerTest
      )
    ).toBe(true);
  });

  it("keeps A6 scenario dependent on verified step-up evidence", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("evaluation-runtime-autonomy-a6-v1|EVALUATES|entity-policy-engine");
    expect(pairs).toContain("evaluation-runtime-autonomy-a6-v1|REQUIRES|entity-step-up-proof");
  });

  it("maps prompt-injection and cross-project scenarios to their exact safety rules", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "evaluation-runtime-prompt-injection-v1|EVALUATES|claim-context-untrusted-data-only"
    );
    expect(pairs).toContain(
      "evaluation-runtime-cross-project-leak-v1|EVALUATES|claim-runtime-project-bound"
    );
  });

  it("preserves the CI failure-to-fix learning chain", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "evaluation-ci-1007-temporal|FOUND_ISSUE|feedback-ci-record-vs-source-time"
    );
    expect(pairs).toContain(
      "feedback-ci-record-vs-source-time|RESOLVED_BY|event-ci-fix-record-time"
    );
    expect(pairs).toContain(
      "event-ci-fix-record-time|VALIDATED_BY|evaluation-ci-1011-structure"
    );
  });

  it("records the final green gate as evidence for PR 269", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const green = graph.nodes.find((node) => node.node_id === "evaluation-ci-1026-green");

    expect(green?.verification_status).toBe("verified");
    expect(green?.source_ref.location).toContain("conclusion=success");
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "CONFIRMS_GREEN_GATE_FOR" &&
          edge.from.id === "evaluation-ci-1026-green" &&
          edge.to.id === "proposal-pr-269-real-knowledge"
      )
    ).toBe(true);
  });

  it("remembers the E2E selector failure and its fix", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "evaluation-ci-1018-e2e|FOUND_ISSUE|feedback-ci-manager-demo-selector"
    );
    expect(pairs).toContain(
      "feedback-ci-manager-demo-selector|RESOLVED_BY|event-ci-fix-manager-demo-selector"
    );
    expect(pairs).toContain(
      "event-ci-fix-manager-demo-selector|VALIDATED_BY|evaluation-ci-1026-green"
    );
  });

  it("keeps every bridge evidence-grounded and specifically typed", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const bridgeEdges = graph.edges.filter(
      (edge) => edge.extractor_version === "repository-bridge-v1"
    );

    expect(bridgeEdges).toHaveLength(30);
    expect(bridgeEdges.every((edge) => edge.evidence_ref.location.includes("/"))).toBe(true);
    expect(bridgeEdges.some((edge) => edge.type === "RELATES_TO")).toBe(false);
  });
});
