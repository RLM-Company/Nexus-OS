import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-04T03:54:43.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const capabilities = [
  "context.web.read",
  "context.project.read",
  "context.global.read",
  "workspace.write",
  "integration.private.use",
  "external.communicate",
  "audience.expand",
  "account.manage",
  "production.deploy",
  "finance.spend",
  "finance.credit",
  "legal.accept_terms",
  "contract.finalize",
  "data.disclose",
  "agent.manage",
  "prompt.temporary",
  "prompt.permanent",
  "strategy.change",
  "sandbox.experiment"
] as const;

const levels = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"] as const;
const modes = ["DENY", "CONFIRM", "SCOPED", "AUTONOMOUS", "FULL"] as const;

const matrix = {
  "context.web.read": [
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "context.project.read": [
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "context.global.read": ["DENY", "SCOPED", "SCOPED", "SCOPED", "SCOPED", "SCOPED", "FULL"],
  "workspace.write": [
    "DENY",
    "DENY",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "integration.private.use": ["DENY", "SCOPED", "SCOPED", "SCOPED", "SCOPED", "AUTONOMOUS", "FULL"],
  "external.communicate": [
    "DENY",
    "DENY",
    "CONFIRM",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "audience.expand": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "AUTONOMOUS", "FULL"],
  "account.manage": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "AUTONOMOUS", "FULL"],
  "production.deploy": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "finance.spend": ["DENY", "DENY", "CONFIRM", "CONFIRM", "AUTONOMOUS", "AUTONOMOUS", "FULL"],
  "finance.credit": ["DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "FULL"],
  "legal.accept_terms": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "contract.finalize": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "data.disclose": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "agent.manage": [
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "prompt.temporary": [
    "DENY",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ],
  "prompt.permanent": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "strategy.change": ["DENY", "DENY", "CONFIRM", "CONFIRM", "CONFIRM", "CONFIRM", "FULL"],
  "sandbox.experiment": [
    "DENY",
    "SCOPED",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "AUTONOMOUS",
    "FULL"
  ]
} as const;

const stepUpCapabilities = [
  "finance.spend",
  "finance.credit",
  "legal.accept_terms",
  "contract.finalize",
  "data.disclose",
  "prompt.permanent",
  "strategy.change"
] as const;

const stepUpPurposes = [
  "autonomy_profile_escalation",
  "critical_tool_confirmation",
  "emergency_stop_clearance",
  "project_usage_limit_expansion"
] as const;

const safeId = (value: string): string =>
  value.replaceAll(".", "-").replaceAll("_", "-").toLowerCase();

const node = (input: {
  id: string;
  kind?: IntelligenceGraphNode["kind"];
  location: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind ?? "Entity",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "authority-capability-v1",
  supersedes: null,
  deleted_at: null
});

const capabilityNodes = capabilities.map((capability) =>
  node({
    id: `capability-${safeId(capability)}`,
    location: `packages/contracts/src/policy.ts:CAPABILITY_IDS:${capability}`
  })
);

const levelNodes = levels.map((level) =>
  node({
    id: `autonomy-level-${level.toLowerCase()}`,
    location: `packages/contracts/src/policy.ts:AUTONOMY_LEVELS:${level}`
  })
);

const modeNodes = modes.map((mode) =>
  node({
    id: `permission-mode-${mode.toLowerCase()}`,
    location: `packages/contracts/src/policy.ts:PermissionModeSchema:${mode}`
  })
);

const purposeNodes = stepUpPurposes.map((purpose) =>
  node({
    id: `step-up-purpose-${safeId(purpose)}`,
    location: `packages/contracts/src/step-up.ts:StepUpPurposeSchema:${purpose}`
  })
);

const authorityNodes = [
  node({
    id: "entity-capability-profile",
    location: "packages/contracts/src/policy.ts:CapabilityProfileSchema"
  }),
  node({
    id: "entity-permission-contract",
    location: "packages/contracts/src/policy.ts:PermissionContractSchema"
  }),
  node({
    id: "entity-guarded-tool-runtime",
    location: "packages/tool-runtime/src/index.ts:GuardedToolRuntime"
  }),
  node({
    id: "entity-agent-delegation-validator",
    location: "packages/policy-engine/src/agent-delegation.ts:validateAgentDelegation"
  })
] as const;

const claimNodes = [
  node({
    id: "claim-policy-strictest-capability-wins",
    kind: "Claim",
    location: "packages/contracts/src/policy.ts:verdictForModes"
  }),
  node({
    id: "claim-policy-condition-authority-trusted-only",
    kind: "Claim",
    location: "packages/tool-runtime/src/index.ts:resolveActiveConditionIds"
  })
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
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
  valid_from: validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "authority-capability-v1",
  supersedes: null,
  deleted_at: null
});

const policyFile = repositoryStructureFileId("packages/contracts/src/policy.ts");
const policyTest = repositoryStructureFileId("packages/contracts/test/policy.test.ts");
const policyEngineFile = repositoryStructureFileId("packages/policy-engine/src/index.ts");
const policyEngineTest = repositoryStructureFileId(
  "packages/policy-engine/test/policy-engine.test.ts"
);
const delegationFile = repositoryStructureFileId("packages/policy-engine/src/agent-delegation.ts");
const delegationTest = repositoryStructureFileId(
  "packages/policy-engine/test/agent-delegation.test.ts"
);
const toolRuntimeFile = repositoryStructureFileId("packages/tool-runtime/src/index.ts");
const toolRuntimeTest = repositoryStructureFileId(
  "packages/tool-runtime/test/tool-runtime.test.ts"
);
const conditionTest = repositoryStructureFileId(
  "packages/tool-runtime/test/policy-condition-authority.test.ts"
);
const stepUpFile = repositoryStructureFileId("packages/contracts/src/step-up.ts");

const matrixEdges = capabilities.flatMap((capability) =>
  levels.map((level, index) => {
    const mode = matrix[capability][index];
    return edge({
      id: `authority-matrix-${safeId(level)}-${safeId(capability)}`,
      type: `RESOLVES_AS_${mode}`,
      from: `autonomy-level-${level.toLowerCase()}`,
      to: `capability-${safeId(capability)}`,
      location: `packages/contracts/src/policy.ts:AUTONOMY_MATRIX:${capability}:${level}=${mode}`
    });
  })
);

const definitionEdges = [
  ...capabilities.map((capability) =>
    edge({
      id: `authority-capability-defined-${safeId(capability)}`,
      type: "DEFINED_IN_FILE",
      from: `capability-${safeId(capability)}`,
      to: policyFile,
      location: `packages/contracts/src/policy.ts:CAPABILITY_IDS:${capability}`
    })
  ),
  ...levels.map((level) =>
    edge({
      id: `authority-level-defined-${level.toLowerCase()}`,
      type: "DEFINED_IN_FILE",
      from: `autonomy-level-${level.toLowerCase()}`,
      to: policyFile,
      location: `packages/contracts/src/policy.ts:AUTONOMY_LEVELS:${level}`
    })
  ),
  ...modes.map((mode) =>
    edge({
      id: `authority-mode-defined-${mode.toLowerCase()}`,
      type: "DEFINED_IN_FILE",
      from: `permission-mode-${mode.toLowerCase()}`,
      to: policyFile,
      location: `packages/contracts/src/policy.ts:PermissionModeSchema:${mode}`
    })
  ),
  ...stepUpPurposes.map((purpose) =>
    edge({
      id: `authority-step-up-purpose-defined-${safeId(purpose)}`,
      type: "DEFINED_IN_FILE",
      from: `step-up-purpose-${safeId(purpose)}`,
      to: stepUpFile,
      location: `packages/contracts/src/step-up.ts:StepUpPurposeSchema:${purpose}`
    })
  )
];

const capabilityEvaluationEdges = capabilities.map((capability) =>
  edge({
    id: `authority-capability-evaluated-${safeId(capability)}`,
    type: "EVALUATED_BY",
    from: `capability-${safeId(capability)}`,
    to: "entity-policy-engine",
    location: `packages/policy-engine/src/index.ts:resolveCapability:${capability}`
  })
);

const stepUpEdges = stepUpCapabilities.map((capability) =>
  edge({
    id: `authority-step-up-capability-${safeId(capability)}`,
    type: "REQUIRES_STEP_UP",
    from: `capability-${safeId(capability)}`,
    to: "entity-step-up-proof",
    location: `packages/contracts/src/policy.ts:STEP_UP_CAPABILITIES:${capability}`
  })
);

const modeRankEdges = modes.slice(0, -1).map((mode, index) =>
  edge({
    id: `authority-mode-rank-${mode.toLowerCase()}`,
    type: "LESS_AUTONOMOUS_THAN",
    from: `permission-mode-${mode.toLowerCase()}`,
    to: `permission-mode-${modes[index + 1]!.toLowerCase()}`,
    location: `packages/contracts/src/policy.ts:PERMISSION_MODE_RANK:${mode}`
  })
);

const structuralEdges: IntelligenceGraphEdge[] = [
  edge({
    id: "authority-profile-defined",
    type: "DEFINED_IN_FILE",
    from: "entity-capability-profile",
    to: policyFile,
    location: "packages/contracts/src/policy.ts:CapabilityProfileSchema"
  }),
  edge({
    id: "authority-profile-evaluated",
    type: "EVALUATED_BY",
    from: "entity-capability-profile",
    to: "entity-policy-engine",
    location: "packages/policy-engine/src/index.ts:evaluatePolicy"
  }),
  edge({
    id: "authority-profile-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-capability-profile",
    to: policyTest,
    location: "packages/contracts/test/policy.test.ts:complete capability profile"
  }),

  edge({
    id: "authority-permission-defined",
    type: "DEFINED_IN_FILE",
    from: "entity-permission-contract",
    to: policyFile,
    location: "packages/contracts/src/policy.ts:PermissionContractSchema"
  }),
  edge({
    id: "authority-permission-evaluated",
    type: "EVALUATED_BY",
    from: "entity-permission-contract",
    to: "entity-policy-engine",
    location: "packages/policy-engine/src/index.ts:activePermissionGrants"
  }),
  edge({
    id: "authority-permission-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-permission-contract",
    to: policyEngineTest,
    location: "packages/policy-engine/test/policy-engine.test.ts:owner permission scope"
  }),

  edge({
    id: "authority-tool-runtime-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-guarded-tool-runtime",
    to: toolRuntimeFile,
    location: "packages/tool-runtime/src/index.ts:GuardedToolRuntime"
  }),
  edge({
    id: "authority-tool-runtime-policy",
    type: "ENFORCES_POLICY_VERDICT_FROM",
    from: "entity-guarded-tool-runtime",
    to: "entity-policy-engine",
    location: "packages/tool-runtime/src/index.ts:evaluatePolicy"
  }),
  edge({
    id: "authority-tool-runtime-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-guarded-tool-runtime",
    to: toolRuntimeTest,
    location: "packages/tool-runtime/test/tool-runtime.test.ts"
  }),

  edge({
    id: "authority-delegation-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-agent-delegation-validator",
    to: delegationFile,
    location: "packages/policy-engine/src/agent-delegation.ts:validateAgentDelegation"
  }),
  edge({
    id: "authority-delegation-no-expansion",
    type: "ENFORCES",
    from: "entity-agent-delegation-validator",
    to: "decision-delegation-no-expansion",
    location: "packages/policy-engine/src/agent-delegation.ts"
  }),
  edge({
    id: "authority-delegation-blueprint",
    type: "VALIDATES",
    from: "entity-agent-delegation-validator",
    to: "entity-agent-blueprint",
    location: "packages/policy-engine/src/agent-delegation.ts:AgentBlueprint"
  }),
  edge({
    id: "authority-delegation-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-agent-delegation-validator",
    to: delegationTest,
    location: "packages/policy-engine/test/agent-delegation.test.ts"
  }),

  edge({
    id: "authority-strictest-defined",
    type: "DEFINED_IN_FILE",
    from: "claim-policy-strictest-capability-wins",
    to: policyFile,
    location: "packages/contracts/src/policy.ts:verdictForModes"
  }),
  edge({
    id: "authority-strictest-governs",
    type: "GOVERNS",
    from: "claim-policy-strictest-capability-wins",
    to: "entity-policy-engine",
    location: "packages/policy-engine/src/index.ts:evaluatePolicy"
  }),
  edge({
    id: "authority-strictest-tested",
    type: "VERIFIED_BY_TEST",
    from: "claim-policy-strictest-capability-wins",
    to: policyEngineTest,
    location: "packages/policy-engine/test/policy-engine.test.ts:strictest capability"
  }),

  edge({
    id: "authority-condition-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-policy-condition-authority-trusted-only",
    to: toolRuntimeFile,
    location: "packages/tool-runtime/src/index.ts:resolveActiveConditionIds"
  }),
  edge({
    id: "authority-condition-policy",
    type: "CONSTRAINS",
    from: "claim-policy-condition-authority-trusted-only",
    to: "entity-policy-engine",
    location: "packages/tool-runtime/src/index.ts:activeConditionIds"
  }),
  edge({
    id: "authority-condition-tested",
    type: "VERIFIED_BY_TEST",
    from: "claim-policy-condition-authority-trusted-only",
    to: conditionTest,
    location: "packages/tool-runtime/test/policy-condition-authority.test.ts"
  }),

  ...stepUpPurposes.map((purpose) =>
    edge({
      id: `authority-step-up-purpose-proof-${safeId(purpose)}`,
      type: "BOUNDS_PROOF_PURPOSE_FOR",
      from: `step-up-purpose-${safeId(purpose)}`,
      to: "entity-step-up-proof",
      location: `packages/contracts/src/step-up.ts:StepUpPurposeSchema:${purpose}`
    })
  ),

  edge({
    id: "authority-policy-engine-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-policy-engine",
    to: policyEngineFile,
    location: "packages/policy-engine/src/index.ts:evaluatePolicy"
  })
];

const nodes = [
  ...capabilityNodes,
  ...levelNodes,
  ...modeNodes,
  ...purposeNodes,
  ...authorityNodes,
  ...claimNodes
];

const edges = [
  ...matrixEdges,
  ...definitionEdges,
  ...capabilityEvaluationEdges,
  ...stepUpEdges,
  ...modeRankEdges,
  ...structuralEdges
];

const records: IntelligenceGraphSearchRecord[] = [
  ...capabilities.map((capability) => ({
    node: { id: `capability-${safeId(capability)}`, version: 1 },
    text: `capability ${capability} autonomy authority policy`,
    excerpt: `Policy capability ${capability} is resolved through the canonical autonomy matrix.`,
    estimated_tokens: 14
  })),
  ...levels.map((level) => ({
    node: { id: `autonomy-level-${level.toLowerCase()}`, version: 1 },
    text: `autonomy level ${level} permission matrix`,
    excerpt: `Autonomy level ${level} maps every capability to a canonical permission mode.`,
    estimated_tokens: 12
  })),
  ...modes.map((mode) => ({
    node: { id: `permission-mode-${mode.toLowerCase()}`, version: 1 },
    text: `permission mode ${mode} authority rank`,
    excerpt: `Permission mode ${mode} participates in the monotonic authority ordering.`,
    estimated_tokens: 10
  })),
  ...purposeNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 10
  })),
  {
    node: { id: "entity-capability-profile", version: 1 },
    text: "capability profile project autonomy grants overrides version",
    excerpt:
      "Project-bound capability profile contains exactly one canonical grant per capability.",
    estimated_tokens: 16
  },
  {
    node: { id: "entity-permission-contract", version: 1 },
    text: "permission contract subject project purpose objects approval step up limits",
    excerpt:
      "Permission contracts are subject/project/purpose/object scoped and carry bounded approval evidence.",
    estimated_tokens: 18
  },
  {
    node: { id: "entity-guarded-tool-runtime", version: 1 },
    text: "guarded tool runtime fail closed confirmation recovery idempotency policy",
    excerpt: "Tool execution is policy-gated, idempotent, confirmation-aware and recovery-safe.",
    estimated_tokens: 18
  },
  {
    node: { id: "entity-agent-delegation-validator", version: 1 },
    text: "agent delegation validator cannot expand capability tool data object budget depth expiry",
    excerpt: "Child agent grants cannot exceed parent authority, budget, scope, depth or expiry.",
    estimated_tokens: 18
  },
  {
    node: { id: "claim-policy-strictest-capability-wins", version: 1 },
    text: "compound policy action strictest capability deny confirm scoped wins",
    excerpt: "A compound action receives the strictest verdict required by any capability.",
    estimated_tokens: 16
  },
  {
    node: { id: "claim-policy-condition-authority-trusted-only", version: 1 },
    text: "conditional policy expansion trusted runtime resolver caller input ignored fail closed",
    excerpt:
      "Conditional expansions come only from the runtime's trusted resolver; failure pauses execution.",
    estimated_tokens: 18
  }
];

export const cosmoraAuthorityCapabilityGraph = () => ({ nodes, edges, records });

export const COSMORA_AUTHORITY_CAPABILITY_NODE_COUNT = nodes.length;
export const COSMORA_AUTHORITY_CAPABILITY_EDGE_COUNT = edges.length;
