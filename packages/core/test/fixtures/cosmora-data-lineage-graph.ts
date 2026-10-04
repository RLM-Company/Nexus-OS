import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-04T05:30:00.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const sourceTrustValues = ["system", "owner", "project", "external_untrusted"] as const;

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
  extractor_version: "data-lineage-v1",
  supersedes: null,
  deleted_at: null
});

const sourceTrustNodes = sourceTrustValues.map((value) =>
  node({
    id: `source-trust-${value.replaceAll("_", "-")}`,
    location: `packages/contracts/src/manager-runtime.ts:RuntimeSourceTrustSchema:${value}`
  })
);

const validatorNodes = [
  node({
    id: "entity-artifact-provenance-validator",
    location:
      "packages/contracts/src/manager-runtime-artifact-provenance.ts:validateRuntimeArtifactProvenance"
  }),
  node({
    id: "entity-artifact-task-binding-validator",
    location:
      "packages/contracts/src/manager-runtime-artifact-task-binding.ts:validateRuntimeArtifactTaskBinding"
  }),
  node({
    id: "entity-critic-artifact-validator",
    location:
      "packages/contracts/src/manager-runtime-critic-artifacts.ts:validateCriticVerdictAgainstArtifacts"
  })
] as const;

const claim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claimNodes = [
  claim(
    "claim-lineage-unique-artifact-id",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:duplicate artifact"
  ),
  claim(
    "claim-lineage-same-project",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:project boundary"
  ),
  claim(
    "claim-lineage-no-self-reference",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:self provenance"
  ),
  claim(
    "claim-lineage-known-sources-only",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:unknown source artifact"
  ),
  claim(
    "claim-lineage-no-future-source",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:created later"
  ),
  claim(
    "claim-lineage-acyclic",
    "packages/contracts/src/manager-runtime-artifact-provenance.ts:cycle detection"
  ),
  claim(
    "claim-lineage-artifact-task-exists",
    "packages/contracts/src/manager-runtime-artifact-task-binding.ts:task lookup"
  ),
  claim(
    "claim-lineage-producer-role-matches-task",
    "packages/contracts/src/manager-runtime-artifact-task-binding.ts:assigned_role"
  ),
  claim(
    "claim-lineage-output-kind-declared",
    "packages/contracts/src/manager-runtime-artifact-task-binding.ts:expected_output_kinds"
  ),
  claim(
    "claim-lineage-inputs-declared",
    "packages/contracts/src/manager-runtime-artifact-task-binding.ts:input_artifact_ids"
  ),
  claim(
    "claim-lineage-artifact-after-task",
    "packages/contracts/src/manager-runtime-artifact-task-binding.ts:created_at"
  ),
  claim(
    "claim-lineage-critic-reviews-existing-supported-prior-artifacts",
    "packages/contracts/src/manager-runtime-critic-artifacts.ts:reviewed_artifact_ids"
  )
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
  extractor_version: "data-lineage-v1",
  supersedes: null,
  deleted_at: null
});

const runtimeFile = repositoryStructureFileId("packages/contracts/src/manager-runtime.ts");
const provenanceFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-artifact-provenance.ts"
);
const taskBindingFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-artifact-task-binding.ts"
);
const criticFile = repositoryStructureFileId(
  "packages/contracts/src/manager-runtime-critic-artifacts.ts"
);
const provenanceTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-artifact-provenance.test.ts"
);
const taskBindingTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-artifact-task-binding.test.ts"
);
const criticTest = repositoryStructureFileId(
  "packages/contracts/test/manager-runtime-critic-artifacts.test.ts"
);

const edges: IntelligenceGraphEdge[] = [
  ...sourceTrustNodes.flatMap((item) => [
    edge({
      id: `lineage-source-trust-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: runtimeFile,
      location: item.source_ref.location
    }),
    edge({
      id: `lineage-source-trust-classifies-${item.node_id}`,
      type: "CLASSIFIES_SOURCE_FOR",
      from: item.node_id,
      to: "entity-runtime-artifact",
      location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactSchema.source_trust"
    })
  ]),

  edge({
    id: "lineage-provenance-validator-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-artifact-provenance-validator",
    to: provenanceFile,
    location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
  }),
  edge({
    id: "lineage-provenance-validator-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-artifact-provenance-validator",
    to: provenanceTest,
    location: "packages/contracts/test/manager-runtime-artifact-provenance.test.ts"
  }),
  edge({
    id: "lineage-task-binding-validator-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-artifact-task-binding-validator",
    to: taskBindingFile,
    location: "packages/contracts/src/manager-runtime-artifact-task-binding.ts"
  }),
  edge({
    id: "lineage-task-binding-validator-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-artifact-task-binding-validator",
    to: taskBindingTest,
    location: "packages/contracts/test/manager-runtime-artifact-task-binding.test.ts"
  }),
  edge({
    id: "lineage-critic-validator-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-critic-artifact-validator",
    to: criticFile,
    location: "packages/contracts/src/manager-runtime-critic-artifacts.ts"
  }),
  edge({
    id: "lineage-critic-validator-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-critic-artifact-validator",
    to: criticTest,
    location: "packages/contracts/test/manager-runtime-critic-artifacts.test.ts"
  }),

  edge({
    id: "lineage-runtime-artifact-has-provenance",
    type: "HAS_PROVENANCE_VALIDATED_BY",
    from: "entity-runtime-artifact",
    to: "entity-artifact-provenance-validator",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactSchema.source_artifact_ids"
  }),
  edge({
    id: "lineage-runtime-artifact-bound-task",
    type: "BOUND_TO_TASK_BY",
    from: "entity-runtime-artifact",
    to: "entity-artifact-task-binding-validator",
    location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactSchema.task_id"
  }),
  edge({
    id: "lineage-task-binding-target",
    type: "VALIDATES_AGAINST",
    from: "entity-artifact-task-binding-validator",
    to: "entity-runtime-task-graph",
    location: "packages/contracts/src/manager-runtime-artifact-task-binding.ts"
  }),
  edge({
    id: "lineage-critic-validates-reviewed",
    type: "VALIDATES_REVIEW_LINEAGE_FOR",
    from: "entity-critic-artifact-validator",
    to: "entity-critic-role",
    location: "packages/contracts/src/manager-runtime-critic-artifacts.ts"
  }),
  edge({
    id: "lineage-external-untrusted-data-only",
    type: "CONSTRAINED_BY",
    from: "source-trust-external-untrusted",
    to: "claim-context-untrusted-data-only",
    location: "packages/contracts/src/manager-runtime.ts:instruction_treatment=data_only"
  }),
  edge({
    id: "lineage-acyclic-refines-runtime-claim",
    type: "REFINES",
    from: "claim-lineage-acyclic",
    to: "claim-runtime-provenance-acyclic",
    location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
  }),
  edge({
    id: "lineage-project-refines-runtime-claim",
    type: "REFINES",
    from: "claim-lineage-same-project",
    to: "claim-runtime-provenance-acyclic",
    location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
  })
];

const provenanceClaims = [
  "claim-lineage-unique-artifact-id",
  "claim-lineage-same-project",
  "claim-lineage-no-self-reference",
  "claim-lineage-known-sources-only",
  "claim-lineage-no-future-source",
  "claim-lineage-acyclic"
] as const;

for (const claimId of provenanceClaims) {
  edges.push(
    edge({
      id: `lineage-${claimId}-guard`,
      type: "ENFORCED_BY",
      from: claimId,
      to: "entity-artifact-provenance-validator",
      location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
    }),
    edge({
      id: `lineage-${claimId}-test`,
      type: "VERIFIED_BY_TEST",
      from: claimId,
      to: provenanceTest,
      location: "packages/contracts/test/manager-runtime-artifact-provenance.test.ts"
    }),
    edge({
      id: `lineage-${claimId}-artifact`,
      type: "CONSTRAINS",
      from: claimId,
      to: "entity-runtime-artifact",
      location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
    })
  );
}

const taskClaims = [
  "claim-lineage-artifact-task-exists",
  "claim-lineage-producer-role-matches-task",
  "claim-lineage-output-kind-declared",
  "claim-lineage-inputs-declared",
  "claim-lineage-artifact-after-task"
] as const;

for (const claimId of taskClaims) {
  edges.push(
    edge({
      id: `lineage-${claimId}-guard`,
      type: "ENFORCED_BY",
      from: claimId,
      to: "entity-artifact-task-binding-validator",
      location: "packages/contracts/src/manager-runtime-artifact-task-binding.ts"
    }),
    edge({
      id: `lineage-${claimId}-test`,
      type: "VERIFIED_BY_TEST",
      from: claimId,
      to: taskBindingTest,
      location: "packages/contracts/test/manager-runtime-artifact-task-binding.test.ts"
    }),
    edge({
      id: `lineage-${claimId}-task-graph`,
      type: "CONSTRAINS",
      from: claimId,
      to: "entity-runtime-task-graph",
      location: "packages/contracts/src/manager-runtime-artifact-task-binding.ts"
    })
  );
}

edges.push(
  edge({
    id: "lineage-critic-claim-guard",
    type: "ENFORCED_BY",
    from: "claim-lineage-critic-reviews-existing-supported-prior-artifacts",
    to: "entity-critic-artifact-validator",
    location: "packages/contracts/src/manager-runtime-critic-artifacts.ts"
  }),
  edge({
    id: "lineage-critic-claim-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-lineage-critic-reviews-existing-supported-prior-artifacts",
    to: criticTest,
    location: "packages/contracts/test/manager-runtime-critic-artifacts.test.ts"
  }),
  edge({
    id: "lineage-critic-claim-role",
    type: "CONSTRAINS",
    from: "claim-lineage-critic-reviews-existing-supported-prior-artifacts",
    to: "entity-critic-role",
    location: "packages/contracts/src/manager-runtime-critic-artifacts.ts"
  }),
  edge({
    id: "lineage-critic-reviews-architecture",
    type: "MAY_REVIEW_KIND",
    from: "entity-critic-artifact-validator",
    to: "entity-artifact-kind-architecture",
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts"
  }),
  edge({
    id: "lineage-critic-reviews-evidence",
    type: "MAY_REVIEW_KIND",
    from: "entity-critic-artifact-validator",
    to: "entity-artifact-kind-evidence",
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts"
  }),
  edge({
    id: "lineage-critic-reviews-analysis",
    type: "MAY_REVIEW_KIND",
    from: "entity-critic-artifact-validator",
    to: "entity-artifact-kind-analysis",
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts"
  }),
  edge({
    id: "lineage-critic-reviews-decision",
    type: "MAY_REVIEW_KIND",
    from: "entity-critic-artifact-validator",
    to: "entity-artifact-kind-decision",
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts"
  }),
  edge({
    id: "lineage-critic-reviews-handoff",
    type: "MAY_REVIEW_KIND",
    from: "entity-critic-artifact-validator",
    to: "entity-artifact-kind-handoff",
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.accepts"
  })
);

const nodes = [...sourceTrustNodes, ...validatorNodes, ...claimNodes];

const records: IntelligenceGraphSearchRecord[] = nodes.map((item) => ({
  node: { id: item.node_id, version: 1 },
  text: item.node_id.replaceAll("-", " "),
  excerpt: item.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraDataLineageGraph = () => ({ nodes, edges, records });

export const COSMORA_DATA_LINEAGE_NODE_COUNT = nodes.length;
export const COSMORA_DATA_LINEAGE_EDGE_COUNT = edges.length;
