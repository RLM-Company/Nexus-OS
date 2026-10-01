import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-01T20:31:01.000Z";

interface ScenarioRow {
  id: string;
  category: string;
  title: string;
  target: string;
  directRunnerTest: boolean;
}

const rows: readonly ScenarioRow[] = [
  {
    id: "runtime-agent-conflict-v1",
    category: "agent_conflict",
    title: "Conflicting analyst and architect outputs block the affected task until arbitration",
    target: "entity-agent-conflict",
    directRunnerTest: false
  },
  {
    id: "runtime-critic-serious-v1",
    category: "critic",
    title: "A serious critic verdict pauses the minimum affected task scope",
    target: "entity-critic-role",
    directRunnerTest: false
  },
  {
    id: "runtime-project-memory-v1",
    category: "memory",
    title: "Project memory exposes only the bounded segment declared by the task",
    target: "entity-runtime-context",
    directRunnerTest: true
  },
  {
    id: "runtime-autonomy-a0-v1",
    category: "autonomy",
    title: "A0 keeps web context denied",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-autonomy-a1-v1",
    category: "autonomy",
    title: "A1 keeps web context scoped",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-autonomy-a2-v1",
    category: "autonomy",
    title: "A2 requires confirmation before external communication",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-autonomy-a3-v1",
    category: "autonomy",
    title: "A3 still requires confirmation for production deployment",
    target: "entity-policy-engine",
    directRunnerTest: true
  },
  {
    id: "runtime-autonomy-a4-v1",
    category: "autonomy",
    title: "A4 allows policy-authorized spending without weakening immutable controls",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-autonomy-a5-v1",
    category: "autonomy",
    title: "A5 keeps first production release confirmation-gated without its condition",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-autonomy-a6-v1",
    category: "autonomy",
    title: "A6 requires verified profile escalation and cannot bypass system safety",
    target: "entity-policy-engine",
    directRunnerTest: false
  },
  {
    id: "runtime-emergency-stop-v1",
    category: "emergency_stop",
    title: "Emergency stop pauses runtime and denies new external operations",
    target: "claim-manager-emergency-stop",
    directRunnerTest: true
  },
  {
    id: "runtime-model-switch-v1",
    category: "model_switch",
    title: "Model switching remains inside the approved routing group",
    target: "entity-router",
    directRunnerTest: false
  },
  {
    id: "runtime-timeout-fallback-v1",
    category: "timeout_fallback",
    title: "Timeout fallback either stays compatible or fails closed",
    target: "decision-gateway-fallback-boundary",
    directRunnerTest: false
  },
  {
    id: "runtime-operation-replay-v1",
    category: "operation_replay",
    title: "Replaying the same operation never creates a second external effect",
    target: "module:packages/tool-runtime",
    directRunnerTest: true
  },
  {
    id: "runtime-project-recovery-v1",
    category: "project_recovery",
    title: "A project restores from its checkpoint without crossing project boundaries",
    target: "entity-runtime-checkpoint",
    directRunnerTest: false
  },
  {
    id: "runtime-prompt-injection-v1",
    category: "prompt_injection",
    title: "Instructions inside retrieved evidence remain data and cannot override authority",
    target: "claim-context-untrusted-data-only",
    directRunnerTest: true
  },
  {
    id: "runtime-memory-poisoning-v1",
    category: "memory_poisoning",
    title: "Unverified claims cannot silently become trusted project memory",
    target: "entity-runtime-context",
    directRunnerTest: false
  },
  {
    id: "runtime-cross-project-leak-v1",
    category: "cross_project_leak",
    title: "Agents cannot see another project's artifacts without authorized scope",
    target: "claim-runtime-project-bound",
    directRunnerTest: false
  },
  {
    id: "runtime-false-critic-v1",
    category: "false_critic",
    title: "False-positive warning cannot create an endless critic stop loop",
    target: "entity-critic-role",
    directRunnerTest: true
  }
];

const node = (row: ScenarioRow): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: `evaluation-${row.id}`,
  node_version: 1,
  kind: "Evaluation",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `packages/contracts/src/manager-runtime-scenarios.ts:${row.id}`
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "runtime-safety-scenario-v1",
  supersedes: null,
  deleted_at: null
});

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  evidence: string;
}): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: input.id,
  edge_version: 1,
  type: input.type,
  from: { id: input.from, version: 1 },
  to: { id: input.to, version: 1 },
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
    location: input.evidence
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "runtime-safety-scenario-v1",
  supersedes: null,
  deleted_at: null
});

const nodes = rows.map(node);
const edges: IntelligenceGraphEdge[] = [];

for (const row of rows) {
  const scenarioNodeId = `evaluation-${row.id}`;
  edges.push(
    edge({
      id: `scenario-evaluates-${row.id}`,
      type: "EVALUATES",
      from: scenarioNodeId,
      to: row.target,
      evidence: `packages/contracts/src/manager-runtime-scenarios.ts:${row.id}`
    }),
    edge({
      id: `scenario-catalog-test-${row.id}`,
      type: "CATALOG_VERIFIED_BY_TEST",
      from: scenarioNodeId,
      to: repositoryStructureFileId("packages/contracts/test/manager-runtime.test.ts"),
      evidence:
        "packages/contracts/test/manager-runtime.test.ts:ships valid release gates for every Step 6 category and all A0-A6 levels"
    })
  );

  if (row.directRunnerTest) {
    edges.push(
      edge({
        id: `scenario-runner-test-${row.id}`,
        type: "EXECUTED_BY_TEST",
        from: scenarioNodeId,
        to: repositoryStructureFileId(
          "packages/core/test/manager-runtime-scenario-runner.test.ts"
        ),
        evidence: `packages/core/test/manager-runtime-scenario-runner.test.ts:${row.id}`
      })
    );
  }
}

edges.push(
  edge({
    id: "scenario-a6-requires-step-up",
    type: "REQUIRES",
    from: "evaluation-runtime-autonomy-a6-v1",
    to: "entity-step-up-proof",
    evidence:
      "packages/contracts/src/manager-runtime-scenarios.ts:runtime-autonomy-a6-v1:a6_requires_verified_step_up"
  })
);

const records: IntelligenceGraphSearchRecord[] = nodes.map((scenarioNode, index) => ({
  node: { id: scenarioNode.node_id, version: 1 },
  text: `${rows[index]!.category} ${rows[index]!.title}`,
  excerpt: rows[index]!.title,
  estimated_tokens: 14
}));

export const cosmoraRuntimeSafetyScenarioGraph = () => ({ nodes, edges, records });

export const COSMORA_RUNTIME_SAFETY_SCENARIO_NODE_COUNT = nodes.length;
export const COSMORA_RUNTIME_SAFETY_SCENARIO_EDGE_COUNT = edges.length;
