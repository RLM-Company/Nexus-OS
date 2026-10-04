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
    expect(graph.nodes).toHaveLength(590);
    expect(graph.records).toHaveLength(590);
    expect(graph.edges).toHaveLength(1767);

    expect(new Set(graph.nodes.map((node) => `${node.node_id}@${node.node_version}`)).size).toBe(
      590
    );
    expect(new Set(graph.edges.map((edge) => `${edge.edge_id}@${edge.edge_version}`)).size).toBe(
      1767
    );

    expect(() => createIndex()).not.toThrow();
  });

  it("keeps verified D4 governance on main runtime and candidate graph hardening separate", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "D4 private chat persistence forbidden memory governance",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 3,
        max_nodes: 32,
        max_edges: 48,
        max_fan_out: 20,
        max_context_tokens: 5_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("entity-data-class-d4-private-chat");
    expect(ids).toContain("claim-context-private-chat-forbidden");
    expect(ids).toContain(
      repositoryStructureFileId("packages/contracts/src/manager-runtime-state.ts")
    );
    expect(ids).not.toContain("proposal-pr-269-real-knowledge");

    const graph = cosmoraUnifiedKnowledgeGraph();
    const candidate = graph.edges.find(
      (edge) => edge.edge_id === "memory-private-chat-intelligence-kernel"
    );
    expect(candidate).toMatchObject({
      type: "PROPOSES_PERSISTENCE_GUARD_IN",
      verification_status: "discovered",
      from: { id: "claim-context-private-chat-forbidden", version: 1 },
      to: { id: "proposal-pr-269-real-knowledge", version: 1 }
    });
  });

  it("keeps approved-but-unimplemented memory policies explicitly spec-only", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const specOnly = graph.edges.filter((edge) => edge.type === "SPEC_ONLY_UNTIL_IMPLEMENTED");
    const specOnlyClaims = new Set(specOnly.map((edge) => edge.from.id));

    expect(specOnlyClaims).toEqual(
      new Set([
        "claim-memory-global-owner-gated",
        "claim-memory-deletion-protected-trash",
        "claim-memory-training-separate",
        "claim-memory-source-transparency",
        "claim-memory-secrets-excluded",
        "claim-memory-owner-settings-precedence"
      ])
    );

    for (const claimId of specOnlyClaims) {
      expect(
        graph.edges.some((edge) => edge.from.id === claimId && edge.type === "RUNTIME_GUARDED_BY")
      ).toBe(false);
    }
  });

  it("keeps versioned correction support candidate until Package B merges", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const candidateEdges = graph.edges.filter(
      (edge) =>
        edge.from.id === "claim-memory-corrections-versioned" &&
        edge.verification_status === "discovered"
    );

    expect(candidateEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PROPOSES_PARTIAL_ENFORCEMENT_IN",
          to: { id: "proposal-pr-265-intelligence-graph-kernel", version: 1 }
        }),
        expect.objectContaining({
          type: "PROPOSES_TEST_COVERAGE_IN",
          to: { id: "proposal-pr-265-intelligence-graph-kernel", version: 1 }
        })
      ])
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.from.id === "claim-memory-corrections-versioned" &&
          edge.type === "RUNTIME_GUARDED_BY"
      )
    ).toBe(false);
  });

  it("models the complete external auth provider set without inventing providers", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const providers = graph.nodes
      .filter((node) => node.node_id.startsWith("auth-provider-"))
      .map((node) => node.node_id)
      .sort();

    expect(providers).toEqual(["auth-provider-google", "auth-provider-telegram"]);
  });

  it("preserves identity session revocation and expiry as distinct trust failures", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "identity-session-status-active|TRANSITIONS_TO|identity-session-status-revoked"
    );
    expect(pairs).toContain(
      "identity-session-status-active|TRANSITIONS_TO|identity-session-status-expired"
    );
    expect(pairs).toContain(
      "identity-actor-status-disabled|CASCADE_REVOKES|identity-session-status-revoked"
    );
  });

  it("records the exact seven identity audit event types", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const auditTypes = graph.edges
      .filter((edge) => edge.type === "AUDIT_EVENT_FOR")
      .map((edge) => edge.from.id)
      .sort();

    expect(auditTypes).toEqual(
      [
        "identity-audit-actor-disabled",
        "identity-audit-session-expired",
        "identity-audit-session-issued",
        "identity-audit-session-revoked",
        "identity-audit-step-up-consumed",
        "identity-audit-step-up-issued",
        "identity-audit-step-up-rejected"
      ].sort()
    );
  });

  it("grounds raw-token exclusion, owner API identity and one-use Step-Up in tests", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const identityStoreTest = repositoryStructureFileId("packages/db/test/identity-store.test.ts");
    const stepUpStoreTest = repositoryStructureFileId(
      "packages/db/test/step-up-proof-store.test.ts"
    );
    const identityBoundaryTest = repositoryStructureFileId(
      "apps/api/test/identity-boundary.test.ts"
    );

    expect(pairs).toContain(
      `claim-identity-token-never-stored-raw|VERIFIED_BY_TEST|${identityStoreTest}`
    );
    expect(pairs).toContain(
      `claim-step-up-exact-binding-one-use|VERIFIED_BY_TEST|${stepUpStoreTest}`
    );
    expect(pairs).toContain(
      `claim-owner-api-requires-owner-session|VERIFIED_BY_TEST|${identityBoundaryTest}`
    );
    expect(pairs).toContain("entity-step-up-proof|BOUND_TO|entity-identity-session");
  });

  it("models the exact four RuntimeArtifact source-trust classes", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const trust = graph.nodes
      .filter((node) => node.node_id.startsWith("source-trust-"))
      .map((node) => node.node_id)
      .sort();

    expect(trust).toEqual(
      [
        "source-trust-external-untrusted",
        "source-trust-owner",
        "source-trust-project",
        "source-trust-system"
      ].sort()
    );
  });

  it("grounds provenance DAG invariants in the validator and regression suite", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const provenanceTest = repositoryStructureFileId(
      "packages/contracts/test/manager-runtime-artifact-provenance.test.ts"
    );

    for (const claimId of [
      "claim-lineage-same-project",
      "claim-lineage-no-self-reference",
      "claim-lineage-known-sources-only",
      "claim-lineage-no-future-source",
      "claim-lineage-acyclic"
    ]) {
      expect(pairs).toContain(`${claimId}|ENFORCED_BY|entity-artifact-provenance-validator`);
      expect(pairs).toContain(`${claimId}|VERIFIED_BY_TEST|${provenanceTest}`);
    }
  });

  it("binds artifact lineage to declared task inputs, producer role and output kinds", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const taskBindingTest = repositoryStructureFileId(
      "packages/contracts/test/manager-runtime-artifact-task-binding.test.ts"
    );

    for (const claimId of [
      "claim-lineage-artifact-task-exists",
      "claim-lineage-producer-role-matches-task",
      "claim-lineage-output-kind-declared",
      "claim-lineage-inputs-declared",
      "claim-lineage-artifact-after-task"
    ]) {
      expect(pairs).toContain(`${claimId}|ENFORCED_BY|entity-artifact-task-binding-validator`);
      expect(pairs).toContain(`${claimId}|VERIFIED_BY_TEST|${taskBindingTest}`);
    }
  });

  it("limits Critic review lineage to supported prior artifact kinds", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const reviewedKinds = graph.edges
      .filter(
        (edge) =>
          edge.from.id === "entity-critic-artifact-validator" && edge.type === "MAY_REVIEW_KIND"
      )
      .map((edge) => edge.to.id)
      .sort();

    expect(reviewedKinds).toEqual(
      [
        "entity-artifact-kind-analysis",
        "entity-artifact-kind-architecture",
        "entity-artifact-kind-decision",
        "entity-artifact-kind-evidence",
        "entity-artifact-kind-handoff"
      ].sort()
    );
    expect(reviewedKinds).not.toContain("entity-runtime-checkpoint");
  });

  it("models the four persistent model-usage attempt states", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const states = graph.nodes
      .filter((node) => node.node_id.startsWith("usage-attempt-status-"))
      .map((node) => node.node_id)
      .sort();

    expect(states).toEqual(
      [
        "usage-attempt-status-reserved",
        "usage-attempt-status-committed",
        "usage-attempt-status-failed",
        "usage-attempt-status-cancelled"
      ].sort()
    );

    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    expect(pairs).toContain(
      "usage-attempt-status-reserved|TRANSITIONS_TO|usage-attempt-status-committed"
    );
    expect(pairs).toContain(
      "usage-attempt-status-reserved|TRANSITIONS_TO|usage-attempt-status-failed"
    );
    expect(pairs).toContain(
      "usage-attempt-status-reserved|TRANSITIONS_TO|usage-attempt-status-cancelled"
    );
  });

  it("fails project usage limits closed on tokens, cost and missing evidence", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const limitsTest = repositoryStructureFileId("packages/db/test/usage-limits.test.ts");

    for (const claimId of [
      "claim-usage-token-limit-fail-closed",
      "claim-usage-cost-limit-fail-closed",
      "claim-usage-missing-evidence-fail-closed"
    ]) {
      expect(pairs).toContain(`${claimId}|CONSTRAINS|entity-project-usage-limit`);
      expect(pairs).toContain(`${claimId}|VERIFIED_BY_TEST|${limitsTest}`);
    }
  });

  it("reserves Manager usage before routing and counts retries against its budget", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const managerTest = repositoryStructureFileId("apps/api/test/manager-work.test.ts");

    expect(pairs).toContain(
      "entity-model-usage-reservation|PRECEDES|entity-router"
    );
    expect(pairs).toContain(
      "entity-manager-work-budget|RESERVES_THROUGH|entity-model-usage-reservation"
    );
    expect(pairs).toContain(
      `claim-manager-retries-consume-budget|VERIFIED_BY_TEST|${managerTest}`
    );
  });

  it("keeps unknown pricing incompatible with cost-limited routing", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const routerTest = repositoryStructureFileId("packages/model-gateway/test/router.test.ts");

    expect(pairs).toContain(
      "claim-router-cost-limit-needs-known-pricing|CONSTRAINS|entity-model-route-budget"
    );
    expect(pairs).toContain(
      `claim-router-cost-limit-needs-known-pricing|VERIFIED_BY_TEST|${routerTest}`
    );
    expect(pairs).toContain(
      "claim-router-cost-limit-needs-known-pricing|CONSISTENT_WITH|evaluation-model-vibecode-unknown-pricing"
    );
  });

  it("models Manager recovery without automatic replay", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("manager-status-running|SAFE_RECOVERY_TO|manager-status-paused");
    expect(pairs).toContain("manager-status-running|UNCERTAIN_RECOVERY_TO|manager-status-failed");
    expect(pairs).toContain(
      `claim-manager-recovery-no-auto-replay|VERIFIED_BY_TEST|${repositoryStructureFileId(
        "apps/api/test/manager-work.test.ts"
      )}`
    );
  });

  it("separates uncertain RESERVED recovery from safe SUCCEEDED replay", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "claim-policy-reserved-recovery-required|APPLIES_TO|tool-operation-status-reserved"
    );
    expect(pairs).toContain(
      "claim-policy-succeeded-replay-safe|APPLIES_TO|tool-operation-status-succeeded"
    );
    expect(pairs).toContain(
      "tool-operation-status-reserved|COMPLETES_TO|tool-operation-status-succeeded"
    );
  });

  it("preserves one-use confirmation and Step-Up lifecycles", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "confirmation-status-pending|OWNER_APPROVES_TO|confirmation-status-approved"
    );
    expect(pairs).toContain(
      "confirmation-status-approved|ONE_USE_CONSUMPTION_TO|confirmation-status-consumed"
    );
    expect(pairs).toContain("step-up-status-active|CONSUMES_TO|step-up-status-consumed");
    expect(pairs).toContain("step-up-status-active|EXPIRES_TO|step-up-status-expired");
  });

  it("keeps recovery checkpoints from restoring authority", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "RECOVERY_CONSTRAINED_BY" &&
          edge.from.id === "entity-runtime-checkpoint" &&
          edge.to.id === "claim-checkpoint-no-authority-restore"
      )
    ).toBe(true);
  });

  it("encodes all 133 canonical autonomy-matrix cells", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const matrixEdges = graph.edges.filter((edge) => edge.edge_id.startsWith("authority-matrix-"));

    expect(matrixEdges).toHaveLength(133);

    const pairs = new Set(matrixEdges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    expect(pairs).toContain("autonomy-level-a0|RESOLVES_AS_DENY|capability-context-web-read");
    expect(pairs).toContain("autonomy-level-a2|RESOLVES_AS_AUTONOMOUS|capability-workspace-write");
    expect(pairs).toContain(
      "autonomy-level-a3|RESOLVES_AS_AUTONOMOUS|capability-external-communicate"
    );
    expect(pairs).toContain("autonomy-level-a6|RESOLVES_AS_FULL|capability-finance-credit");
  });

  it("marks exactly the seven canonical capabilities that require step-up", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const stepUp = graph.edges
      .filter((edge) => edge.type === "REQUIRES_STEP_UP")
      .map((edge) => edge.from.id)
      .sort();

    expect(stepUp).toEqual(
      [
        "capability-contract-finalize",
        "capability-data-disclose",
        "capability-finance-credit",
        "capability-finance-spend",
        "capability-legal-accept-terms",
        "capability-prompt-permanent",
        "capability-strategy-change"
      ].sort()
    );
  });

  it("keeps conditional authority inside the trusted Tool Runtime resolver", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const conditionTest = repositoryStructureFileId(
      "packages/tool-runtime/test/policy-condition-authority.test.ts"
    );

    expect(pairs).toContain(
      "claim-policy-condition-authority-trusted-only|CONSTRAINS|entity-policy-engine"
    );
    expect(pairs).toContain(
      `claim-policy-condition-authority-trusted-only|VERIFIED_BY_TEST|${conditionTest}`
    );
    expect(pairs).toContain(
      "entity-guarded-tool-runtime|ENFORCES_POLICY_VERDICT_FROM|entity-policy-engine"
    );
  });

  it("grounds bounded delegation in the validator and regression suite", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const delegationTest = repositoryStructureFileId(
      "packages/policy-engine/test/agent-delegation.test.ts"
    );

    expect(pairs).toContain(
      "entity-agent-delegation-validator|ENFORCES|decision-delegation-no-expansion"
    );
    expect(pairs).toContain("entity-agent-delegation-validator|VALIDATES|entity-agent-blueprint");
    expect(pairs).toContain(`entity-agent-delegation-validator|VERIFIED_BY_TEST|${delegationTest}`);
  });

  it("retrieves the checked-in bootstrap ModelVersion from Registry evidence", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "mock manager b0.1 bootstrap model streaming confidential zero cost registry",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 2,
        max_nodes: 24,
        max_edges: 36,
        max_fan_out: 18,
        max_context_tokens: 4_000
      }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("model-version-mock-manager-b0-1");
    expect(ids).toContain("entity-model-registry");
    expect(ids).toContain("doc-model-registry-bootstrap-v1");

    const pairs = new Set(packet.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    expect(pairs).toContain("model-version-mock-manager-b0-1|REGISTERED_IN|entity-model-registry");
    expect(pairs).toContain(
      "evaluation-model-bootstrap-streaming|CONFIRMS_CAPABILITY_FOR|model-version-mock-manager-b0-1"
    );
  });

  it("keeps owner-preview VibeCode models time-bounded and non-confidential", () => {
    const current = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "vibecode gpt 5.5 owner preview non confidential unknown pricing",
      mode: "temporal",
      as_of: "2026-10-10T00:00:00.000Z",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 24, max_edges: 36 }
    });
    const expired = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "vibecode gpt 5.5 owner preview non confidential unknown pricing",
      mode: "temporal",
      as_of: "2026-10-14T00:00:00.000Z",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 24, max_edges: 36 }
    });

    expect(current.nodes.map(({ node }) => node.node_id)).toContain(
      "model-version-vibecode-gpt-5-5"
    );
    expect(expired.nodes.map(({ node }) => node.node_id)).not.toContain(
      "model-version-vibecode-gpt-5-5"
    );

    const pairs = new Set(
      current.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`)
    );
    expect(pairs).toContain(
      "evaluation-model-vibecode-nonconfidential|RESTRICTS_CONFIDENTIAL_USE_FOR|model-version-vibecode-gpt-5-5"
    );
    expect(pairs).toContain(
      "evaluation-model-vibecode-unknown-pricing|MARKS_UNKNOWN_PRICING_FOR|model-version-vibecode-gpt-5-5"
    );
  });

  it("keeps Model Intelligence recommendations outside routing authority", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "entity-model-intelligence-graph|CONSTRAINED_BY|claim-model-intelligence-recommend-only"
    );
    expect(pairs).toContain(
      "claim-model-intelligence-recommend-only|NOT_AUTHORITY_FOR|entity-model-registry"
    );
    expect(pairs).toContain(
      "claim-model-intelligence-recommend-only|NOT_AUTHORITY_FOR|entity-router"
    );
  });

  it("grounds model routing evaluations in the real Router and runtime tests", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    const routerTest = repositoryStructureFileId("packages/model-gateway/test/router.test.ts");
    const runtimeTest = repositoryStructureFileId("apps/api/test/model-runtime.test.ts");

    expect(pairs).toContain(`evaluation-model-router-hard-filter|VERIFIED_BY_TEST|${routerTest}`);
    expect(pairs).toContain(
      `evaluation-model-router-deterministic-score|VERIFIED_BY_TEST|${routerTest}`
    );
    expect(pairs).toContain(
      `evaluation-model-runtime-registry-binding|VERIFIED_BY_TEST|${runtimeTest}`
    );
  });

  it("retrieves Manager persistence invariants from the exact state store", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "Manager work persistent store idempotency optimistic version recovery no replay",
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
    expect(ids).toContain("entity-store-manager-work");
    expect(ids).toContain("entity-manager-work");
    expect(ids).toContain(repositoryStructureFileId("packages/db/src/manager-work-store.ts"));

    const pairs = new Set(packet.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));
    expect(pairs).toContain(
      "entity-store-manager-work|ENFORCES_IDEMPOTENCY_FOR|entity-manager-work"
    );
    expect(pairs).toContain(
      "entity-store-manager-work|USES_OPTIMISTIC_VERSIONING_FOR|entity-manager-work"
    );
    expect(pairs).toContain(
      "entity-store-manager-work|RECOVERS_WITHOUT_AUTOMATIC_REPLAY|entity-manager-work"
    );
  });

  it("keeps usage accounting uncertainty explicit in persistent state", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "entity-store-project-usage|PRESERVES_UNKNOWN_COST_FOR|entity-project-usage"
    );
    expect(pairs).toContain(
      "entity-store-project-usage|USES_OPTIMISTIC_VERSIONING_FOR|entity-project-usage"
    );
  });

  it("keeps persisted agent blueprints distinct from runtime agent instances", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("entity-store-agent-blueprint|PERSISTS|entity-agent-blueprint");
    expect(pairs).toContain("entity-agent-blueprint|BLUEPRINT_FOR|entity-agent-instance");
    expect(pairs).not.toContain("entity-store-agent-blueprint|PERSISTS|entity-agent-instance");
  });

  it("maps identity and chat runtime stores to their safety invariants and tests", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "entity-store-identity|HASHES_SESSION_TOKEN_FOR|entity-identity-session"
    );
    expect(pairs).toContain(
      "entity-store-general-chat-runtime|ATOMICALLY_CLAIMS|entity-general-chat-runtime"
    );
    expect(pairs).toContain(
      `entity-store-identity|VERIFIED_BY_TEST|${repositoryStructureFileId(
        "packages/db/test/identity-store.test.ts"
      )}`
    );
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

  it("can traverse from a semantic Manager constraint into its real implementation", () => {
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
    expect(pairs).toContain("event-ci-fix-record-time|VALIDATED_BY|evaluation-ci-1011-structure");
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

    expect(pairs).toContain("evaluation-ci-1018-e2e|FOUND_ISSUE|feedback-ci-manager-demo-selector");
    expect(pairs).toContain(
      "feedback-ci-manager-demo-selector|RESOLVED_BY|event-ci-fix-manager-demo-selector"
    );
    expect(pairs).toContain(
      "event-ci-fix-manager-demo-selector|VALIDATED_BY|evaluation-ci-1026-green"
    );
  });

  it("maps Manager Work API to identity, work state and runtime control", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("entity-api-manager-work|REQUIRES_IDENTITY|entity-identity-session");
    expect(pairs).toContain("entity-api-manager-work|MANAGES|entity-manager-work");
    expect(pairs).toContain(
      "entity-api-manager-work|CONTROLS_RUNTIME|artifact-manager-work-runtime"
    );
  });

  it("maps General Chat API to persisted chat runtime and Model Gateway dispatch", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain("entity-api-general-chat|MANAGES|entity-general-chat-runtime");
    expect(pairs).toContain("entity-api-general-chat|DISPATCHES_TO|entity-model-gateway");
    expect(pairs).toContain(
      `entity-api-general-chat|VERIFIED_BY_TEST|${repositoryStructureFileId(
        "apps/api/test/general-chat-api.test.ts"
      )}`
    );
  });

  it("keeps high-impact API mutations behind identity and step-up boundaries", () => {
    const graph = cosmoraUnifiedKnowledgeGraph();
    const pairs = new Set(graph.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`));

    expect(pairs).toContain(
      "entity-api-emergency-stop|REQUIRES_STEP_UP_FOR_CLEARANCE|entity-step-up-proof"
    );
    expect(pairs).toContain(
      "entity-api-project-usage|REQUIRES_STEP_UP_FOR_EXPANSION|entity-step-up-proof"
    );
    expect(pairs).toContain(
      "entity-api-autonomy-policy|REQUIRES_STEP_UP_FOR_ESCALATION|entity-step-up-proof"
    );
    expect(pairs).toContain("entity-api-autonomy-policy|ENFORCED_BY|entity-policy-engine");
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
