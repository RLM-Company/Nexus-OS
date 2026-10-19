import type { IntelligenceGraphEdge } from "@cosmora/contracts";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-01T20:31:01.000Z";

interface CoverageRow {
  id: string;
  from: string;
  testPath: string;
  evidence: string;
}

const rows: readonly CoverageRow[] = [
  {
    id: "coverage-registry-authority",
    from: "decision-registry-authority",
    testPath: "packages/model-gateway/test/router.test.ts",
    evidence: "ModelRegistry rejects duplicate identities and invalid active routing metadata"
  },
  {
    id: "coverage-router-hard-filter",
    from: "decision-hard-filter-before-score",
    testPath: "packages/model-gateway/test/router.test.ts",
    evidence: "ModelRouter rejects missing capability, context and budget before successful routing"
  },
  {
    id: "coverage-routing-fail-closed",
    from: "decision-routing-fail-closed",
    testPath: "packages/model-gateway/test/router.test.ts",
    evidence:
      "ModelRegistry and ModelRouter fail closed for unverified confidential and unavailable routes"
  },
  {
    id: "coverage-route-evidence-freshness",
    from: "decision-route-evidence-freshness",
    testPath: "packages/model-gateway/test/router.test.ts",
    evidence: "ModelRegistry rejects expired and reversed external evidence windows"
  },
  {
    id: "coverage-gateway-fallback-boundary",
    from: "decision-gateway-fallback-boundary",
    testPath: "packages/model-gateway/test/gateway.test.ts",
    evidence:
      "Gateway falls back before first delta and refuses fallback after partial provider output"
  },
  {
    id: "coverage-policy-verdict-modes",
    from: "claim-policy-verdict-modes",
    testPath: "packages/contracts/test/policy.test.ts",
    evidence: "Policy verdict tests cover ALLOW, ALLOW_WITH_LIMITS, NEEDS_CONFIRMATION and DENY"
  },
  {
    id: "coverage-policy-project-profile",
    from: "claim-policy-capability-profile-project",
    testPath: "packages/contracts/test/policy.test.ts",
    evidence: "Policy profile tests cover capability modes and bounded project policy semantics"
  },
  {
    id: "coverage-usage-attempt-accounting",
    from: "claim-usage-attempt-accounting",
    testPath: "packages/db/test/usage-store.test.ts",
    evidence: "Usage store summary covers reserved, committed, failed and cancelled attempt states"
  },
  {
    id: "coverage-usage-unknown-cost",
    from: "claim-usage-unknown-cost",
    testPath: "packages/db/test/usage-store.test.ts",
    evidence: "Usage store keeps unknown committed and reserved cost evidence explicit"
  },
  {
    id: "coverage-usage-versioned-limits",
    from: "claim-usage-limit-versioned",
    testPath: "packages/db/test/usage-limits.test.ts",
    evidence: "Usage limits persist optimistic versions and reject stale writes"
  },
  {
    id: "coverage-usage-fail-closed",
    from: "claim-usage-limit-versioned",
    testPath: "packages/db/test/usage-limits.test.ts",
    evidence: "Usage reservations fail closed before token or cost limits can be oversubscribed"
  },
  {
    id: "coverage-identity-session-contract",
    from: "claim-identity-session-lifecycle",
    testPath: "packages/contracts/test/identity.test.ts",
    evidence: "Identity contract tests cover assurance, expiry and revocation fields"
  },
  {
    id: "coverage-identity-api-boundary",
    from: "claim-identity-session-lifecycle",
    testPath: "apps/api/test/identity-boundary.test.ts",
    evidence:
      "API identity boundary requires valid bearer sessions and enforces revocation and owner isolation"
  },
  {
    id: "coverage-step-up-purpose",
    from: "claim-step-up-purpose-bound",
    testPath: "packages/contracts/test/step-up.test.ts",
    evidence: "Step-up contracts allow only registered security purposes and remain secret-free"
  },
  {
    id: "coverage-step-up-mutation-binding",
    from: "claim-step-up-purpose-bound",
    testPath: "apps/api/test/step-up-challenge.test.ts",
    evidence: "Step-up challenge changes when autonomy authority or project usage ceiling changes"
  },
  {
    id: "coverage-manager-publish-policy",
    from: "claim-manager-publish-workspace-write",
    testPath: "apps/api/test/manager-work.test.ts",
    evidence: "Manager work tests exercise workspace.write publication confirmation"
  },
  {
    id: "coverage-manager-budget-reservation",
    from: "claim-manager-reserves-budget",
    testPath: "apps/api/test/manager-work.test.ts",
    evidence:
      "Manager work tests enforce project usage limits and reserve model usage before dispatch"
  },
  {
    id: "coverage-manager-emergency-stop",
    from: "claim-manager-emergency-stop",
    testPath: "apps/api/test/manager-work.test.ts",
    evidence: "Manager work tests honor Emergency Stop and prevent dispatch"
  },
  {
    id: "coverage-delegation-no-expansion",
    from: "decision-delegation-no-expansion",
    testPath: "packages/policy-engine/test/agent-delegation.test.ts",
    evidence:
      "Delegation tests reject expansion of owner, project, capability, tool, data, object, budget, depth and expiry"
  },
  {
    id: "coverage-context-private-chat",
    from: "claim-context-private-chat-forbidden",
    testPath: "packages/contracts/test/manager-runtime-context-validation.test.ts",
    evidence: "Runtime context validation preserves the D4 no-persistence invariant"
  },
  {
    id: "coverage-context-task-bound",
    from: "claim-context-task-bound",
    testPath: "packages/contracts/test/manager-runtime-context-validation.test.ts",
    evidence: "Runtime context validation rejects task, role and memory-scope widening"
  },
  {
    id: "coverage-context-data-class",
    from: "claim-context-data-class-bound",
    testPath: "packages/contracts/test/manager-runtime-context-validation.test.ts",
    evidence:
      "Runtime context validation rejects disallowed data classes and cross-project artifacts"
  },
  {
    id: "coverage-runtime-provenance",
    from: "claim-runtime-provenance-acyclic",
    testPath: "packages/contracts/test/manager-runtime-artifact-provenance.test.ts",
    evidence:
      "Artifact provenance tests reject cycles, future sources, unknown sources and cross-project provenance"
  },
  {
    id: "coverage-checkpoint-graph-binding",
    from: "claim-checkpoint-bound-graph",
    testPath: "packages/contracts/test/manager-runtime-checkpoint.test.ts",
    evidence:
      "Checkpoint tests require project and task-graph binding with complete unique task state"
  },
  {
    id: "coverage-conflict-resolution",
    from: "claim-conflict-needs-resolution-artifact",
    testPath: "packages/contracts/test/manager-runtime-conflict.test.ts",
    evidence: "Conflict tests require a resolution artifact and timestamp before resolved status"
  },
  {
    id: "coverage-manager-arbitration",
    from: "claim-manager-role-authority",
    testPath: "packages/contracts/test/manager-runtime-conflict.test.ts",
    evidence: "Conflict tests keep arbitration authority exclusive to the Manager role"
  },
  {
    id: "coverage-policy-condition-authority",
    from: "entity-policy-engine",
    testPath: "packages/tool-runtime/test/policy-condition-authority.test.ts",
    evidence:
      "Tool Runtime ignores caller-supplied conditional expansion and accepts only the trusted resolver"
  }
];

const edges: IntelligenceGraphEdge[] = rows.map((row) => ({
  contract_version: 1,
  edge_id: row.id,
  edge_version: 1,
  type: "VERIFIED_BY_TEST",
  from: { id: row.from, version: 1 },
  to: { id: repositoryStructureFileId(row.testPath), version: 1 },
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `${row.testPath}:${row.evidence}`
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "repository-test-coverage-v1",
  supersedes: null,
  deleted_at: null
}));

export const cosmoraTestCoverageGraph = () => ({ nodes: [], edges, records: [] });

export const COSMORA_TEST_COVERAGE_EDGE_COUNT = edges.length;
