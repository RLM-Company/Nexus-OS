import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-03T08:57:16.000Z";
const specificationAt = "2026-08-24T00:00:00.000Z";
const runtimeSnapshotAt = "2026-09-26T11:00:05.000Z";

const node = (input: {
  id: string;
  kind: IntelligenceGraphNode["kind"];
  location: string;
  validFrom?: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind,
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: input.validFrom ?? specificationAt,
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
  extractor_version: "memory-governance-v1",
  supersedes: null,
  deleted_at: null
});

const constitution = node({
  id: "doc-memory-learning-constitution-v1-1",
  kind: "Document",
  location: "docs/constitution/drafts/memory-learning-constitution-v1.md"
});

const governance = node({
  id: "entity-memory-governance",
  kind: "Entity",
  location: "docs/constitution/drafts/memory-learning-constitution-v1.md:status"
});

const dataClasses = [
  node({
    id: "entity-data-class-d0-public",
    kind: "Entity",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema:D0_PUBLIC",
    validFrom: runtimeSnapshotAt
  }),
  node({
    id: "entity-data-class-d1-project",
    kind: "Entity",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema:D1_PROJECT",
    validFrom: runtimeSnapshotAt
  }),
  node({
    id: "entity-data-class-d2-confidential",
    kind: "Entity",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema:D2_CONFIDENTIAL",
    validFrom: runtimeSnapshotAt
  }),
  node({
    id: "entity-data-class-d3-restricted",
    kind: "Entity",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema:D3_RESTRICTED",
    validFrom: runtimeSnapshotAt
  }),
  node({
    id: "entity-data-class-d4-private-chat",
    kind: "Entity",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema:D4_PRIVATE_CHAT",
    validFrom: runtimeSnapshotAt
  })
] as const;

const specClaim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claims = [
  specClaim(
    "claim-memory-corrections-versioned",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:13.1"
  ),
  specClaim(
    "claim-memory-global-owner-gated",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:4,5"
  ),
  specClaim(
    "claim-memory-deletion-protected-trash",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:13.2"
  ),
  specClaim(
    "claim-memory-training-separate",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:12"
  ),
  specClaim(
    "claim-memory-source-transparency",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:13.4"
  ),
  specClaim(
    "claim-memory-secrets-excluded",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:2"
  ),
  specClaim(
    "claim-memory-owner-settings-precedence",
    "docs/constitution/drafts/memory-learning-constitution-v1.md:11"
  )
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
  validFrom?: string;
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
  valid_from: input.validFrom ?? specificationAt,
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
  extractor_version: "memory-governance-v1",
  supersedes: null,
  deleted_at: null
});

const runtimeDataClassFile = repositoryStructureFileId("packages/contracts/src/manager-runtime.ts");
const runtimeStateFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-state.ts"
);
const runtimeContextValidationFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-context-validation.ts"
);
const runtimeProvenanceFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-artifact-provenance.ts"
);
const intelligenceGraphFile = repositoryStructureFileId(
  "packages/contracts/src/intelligence-graph.ts"
);
const runtimeStateTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-state.test.ts"
);
const runtimeContextTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-context-validation.test.ts"
);
const runtimeProvenanceTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-artifact-provenance.test.ts"
);
const intelligenceGraphTest = repositoryStructureFileId(
  "packages/contracts/test/intelligence-graph.test.ts"
);

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "memory-governance-specified-by",
    type: "SPECIFIED_BY",
    from: governance.node_id,
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:status"
  }),

  ...dataClasses.flatMap((dataClass, index) => [
    edge({
      id: `memory-governance-defines-data-class-${index + 1}`,
      type: "DEFINES_DATA_CLASS",
      from: governance.node_id,
      to: dataClass.node_id,
      location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema",
      validFrom: runtimeSnapshotAt
    }),
    edge({
      id: `memory-data-class-defined-in-${index + 1}`,
      type: "DEFINED_IN_FILE",
      from: dataClass.node_id,
      to: runtimeDataClassFile,
      location: "packages/contracts/src/manager-runtime.ts:RuntimeDataClassSchema",
      validFrom: runtimeSnapshotAt
    })
  ]),

  edge({
    id: "memory-d4-private-chat-applies-rule",
    type: "SUBJECT_TO",
    from: "entity-data-class-d4-private-chat",
    to: "claim-context-private-chat-forbidden",
    location: "packages/contracts/src/manager-runtime-state.ts:private_chat_persistence",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-private-chat-specified",
    type: "SPECIFIED_BY",
    from: "claim-context-private-chat-forbidden",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:6"
  }),
  edge({
    id: "memory-private-chat-runtime-state",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-context-private-chat-forbidden",
    to: runtimeStateFile,
    location: "packages/contracts/src/manager-runtime-state.ts:validateRuntimeContextEnvelope",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-private-chat-intelligence-kernel",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-context-private-chat-forbidden",
    to: intelligenceGraphFile,
    location: "packages/contracts/src/intelligence-graph.ts:D4_PRIVATE_CHAT persistence rejection",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-private-chat-runtime-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-context-private-chat-forbidden",
    to: runtimeStateTest,
    location: "packages/contracts/test/manager-runtime-state.test.ts:blocks D4 write-back",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-private-chat-graph-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-context-private-chat-forbidden",
    to: intelligenceGraphTest,
    location: "packages/contracts/test/intelligence-graph.test.ts:rejects D4 private chat data",
    validFrom: runtimeSnapshotAt
  }),

  edge({
    id: "memory-project-isolation-specified",
    type: "SPECIFIED_BY",
    from: "claim-runtime-project-bound",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:1,4"
  }),
  edge({
    id: "memory-project-isolation-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-runtime-project-bound",
    to: runtimeContextValidationFile,
    location: "packages/contracts/src/manager-runtime-context-validation.ts:project boundary",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-project-isolation-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-runtime-project-bound",
    to: runtimeContextTest,
    location: "packages/contracts/test/manager-runtime-context-validation.test.ts:cross-project",
    validFrom: runtimeSnapshotAt
  }),

  edge({
    id: "memory-untrusted-data-specified",
    type: "SPECIFIED_BY",
    from: "claim-context-untrusted-data-only",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:13.5"
  }),
  edge({
    id: "memory-untrusted-data-runtime-state",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-context-untrusted-data-only",
    to: runtimeStateFile,
    location:
      "packages/contracts/src/manager-runtime-state.ts:untrusted_instruction_treatment=data_only",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-untrusted-data-runtime-validation",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-context-untrusted-data-only",
    to: runtimeContextValidationFile,
    location: "packages/contracts/src/manager-runtime-context-validation.ts:instruction_treatment",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-untrusted-data-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-context-untrusted-data-only",
    to: runtimeStateTest,
    location: "packages/contracts/test/manager-runtime-state.test.ts:instruction-safe",
    validFrom: runtimeSnapshotAt
  }),

  edge({
    id: "memory-provenance-specified",
    type: "SPECIFIED_BY",
    from: "claim-runtime-provenance-acyclic",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:2,13.4"
  }),
  edge({
    id: "memory-provenance-runtime",
    type: "RUNTIME_GUARDED_BY",
    from: "claim-runtime-provenance-acyclic",
    to: runtimeProvenanceFile,
    location: "packages/contracts/src/manager-runtime-artifact-provenance.ts",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-provenance-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-runtime-provenance-acyclic",
    to: runtimeProvenanceTest,
    location: "packages/contracts/test/manager-runtime-artifact-provenance.test.ts",
    validFrom: runtimeSnapshotAt
  }),

  edge({
    id: "memory-corrections-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-corrections-versioned",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:13.1"
  }),
  edge({
    id: "memory-corrections-partial-enforcement",
    type: "PARTIALLY_ENFORCED_BY",
    from: "claim-memory-corrections-versioned",
    to: intelligenceGraphFile,
    location: "packages/contracts/src/intelligence-graph.ts:supersedes validation",
    validFrom: runtimeSnapshotAt
  }),
  edge({
    id: "memory-corrections-graph-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-memory-corrections-versioned",
    to: intelligenceGraphTest,
    location: "packages/contracts/test/intelligence-graph.test.ts:versioned correction",
    validFrom: runtimeSnapshotAt
  }),

  edge({
    id: "memory-global-gated-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-global-owner-gated",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:4,5"
  }),
  edge({
    id: "memory-global-gated-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-global-owner-gated",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  }),
  edge({
    id: "memory-deletion-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-deletion-protected-trash",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:13.2"
  }),
  edge({
    id: "memory-deletion-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-deletion-protected-trash",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  }),
  edge({
    id: "memory-training-separate-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-training-separate",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:12"
  }),
  edge({
    id: "memory-training-separate-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-training-separate",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  }),
  edge({
    id: "memory-d4-excluded-training",
    type: "EXCLUDED_FROM_TRAINING_BY",
    from: "entity-data-class-d4-private-chat",
    to: "claim-memory-training-separate",
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:6,10"
  }),
  edge({
    id: "memory-source-transparency-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-source-transparency",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:13.4"
  }),
  edge({
    id: "memory-source-transparency-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-source-transparency",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  }),
  edge({
    id: "memory-secrets-excluded-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-secrets-excluded",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:2"
  }),
  edge({
    id: "memory-secrets-excluded-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-secrets-excluded",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  }),
  edge({
    id: "memory-settings-precedence-specified",
    type: "SPECIFIED_BY",
    from: "claim-memory-owner-settings-precedence",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:11"
  }),
  edge({
    id: "memory-settings-precedence-spec-only",
    type: "SPEC_ONLY_UNTIL_IMPLEMENTED",
    from: "claim-memory-owner-settings-precedence",
    to: constitution.node_id,
    location: "docs/constitution/drafts/memory-learning-constitution-v1.md:14"
  })
];

const nodes = [constitution, governance, ...dataClasses, ...claims];

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: constitution.node_id, version: 1 },
    text: "memory learning constitution owner approved specification not runtime",
    excerpt:
      "Owner-approved Memory Constitution v1.1 defines project memory, privacy, learning and deletion rules but is not itself runtime policy.",
    estimated_tokens: 24
  },
  {
    node: { id: governance.node_id, version: 1 },
    text: "memory governance project isolation private chat provenance deletion training",
    excerpt:
      "Governance layer distinguishes owner-approved memory rules from the subset guarded by current runtime contracts.",
    estimated_tokens: 22
  },
  ...dataClasses.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 12
  })),
  ...claims.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 14
  }))
];

export const cosmoraMemoryGovernanceGraph = () => ({ nodes, edges, records });

export const COSMORA_MEMORY_GOVERNANCE_NODE_COUNT = nodes.length;
export const COSMORA_MEMORY_GOVERNANCE_EDGE_COUNT = edges.length;
