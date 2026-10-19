import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-04T04:17:00.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const actorKinds = ["owner", "system", "agent"] as const;
const actorStatuses = ["active", "disabled"] as const;
const sessionStatuses = ["active", "revoked", "expired"] as const;
const assurances = ["local", "single_factor", "multi_factor"] as const;
const authProviders = ["google", "telegram"] as const;
const verificationStatuses = ["pending", "verified", "failed", "revoked"] as const;
const auditTypes = [
  "session.issued",
  "session.revoked",
  "session.expired",
  "actor.disabled",
  "step_up.issued",
  "step_up.consumed",
  "step_up.rejected"
] as const;

const safeId = (value: string): string =>
  value.replaceAll(".", "-").replaceAll("_", "-").toLowerCase();

const node = (input: {
  id: string;
  location: string;
  kind?: IntelligenceGraphNode["kind"];
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
  extractor_version: "identity-trust-v1",
  supersedes: null,
  deleted_at: null
});

const actorKindNodes = actorKinds.map((value) =>
  node({
    id: `identity-actor-kind-${safeId(value)}`,
    location: `packages/contracts/src/identity.ts:ActorKindSchema:${value}`
  })
);
const actorStatusNodes = actorStatuses.map((value) =>
  node({
    id: `identity-actor-status-${safeId(value)}`,
    location: `packages/contracts/src/identity.ts:ActorStatusSchema:${value}`
  })
);
const sessionStatusNodes = sessionStatuses.map((value) =>
  node({
    id: `identity-session-status-${safeId(value)}`,
    location: `packages/contracts/src/identity.ts:SessionStatusSchema:${value}`
  })
);
const assuranceNodes = assurances.map((value) =>
  node({
    id: `identity-assurance-${safeId(value)}`,
    location: `packages/contracts/src/identity.ts:AuthenticationAssuranceSchema:${value}`
  })
);
const providerNodes = authProviders.map((value) =>
  node({
    id: `auth-provider-${safeId(value)}`,
    location: `packages/contracts/src/auth.ts:AuthProviderSchema:${value}`
  })
);
const verificationNodes = verificationStatuses.map((value) =>
  node({
    id: `auth-verification-${safeId(value)}`,
    location: `packages/contracts/src/auth.ts:AuthVerificationStatusSchema:${value}`
  })
);
const auditNodes = auditTypes.map((value) =>
  node({
    id: `identity-audit-${safeId(value)}`,
    kind: "Event",
    location: `packages/contracts/src/identity.ts:IdentityAuditEventSchema:${value}`
  })
);

const trustNodes = [
  node({
    id: "entity-identity-actor",
    location: "packages/contracts/src/identity.ts:IdentityActorSchema"
  }),
  node({
    id: "entity-external-identity",
    location: "packages/contracts/src/auth.ts:ExternalIdentitySchema"
  }),
  node({
    id: "entity-auth-session-bootstrap",
    location: "packages/contracts/src/auth.ts:AuthSessionBootstrapSchema"
  }),
  node({
    id: "entity-identity-audit-log",
    location: "packages/contracts/src/identity.ts:IdentityAuditEventSchema"
  }),
  node({
    id: "claim-identity-token-never-stored-raw",
    kind: "Claim",
    location: "packages/db/src/identity-store.ts:hashIdentitySessionToken"
  }),
  node({
    id: "claim-step-up-exact-binding-one-use",
    kind: "Claim",
    location: "packages/db/src/step-up-proof-store.ts:consumeProof"
  }),
  node({
    id: "claim-owner-api-requires-owner-session",
    kind: "Claim",
    location: "apps/api/test/identity-boundary.test.ts:owner API boundary"
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
  extractor_version: "identity-trust-v1",
  supersedes: null,
  deleted_at: null
});

const identityFile = repositoryStructureFileId("packages/contracts/src/identity.ts");
const authFile = repositoryStructureFileId("packages/contracts/src/auth.ts");
const identityStoreFile = repositoryStructureFileId("packages/db/src/identity-store.ts");
const stepUpStoreFile = repositoryStructureFileId("packages/db/src/step-up-proof-store.ts");
const identityStoreTest = repositoryStructureFileId("packages/db/test/identity-store.test.ts");
const stepUpStoreTest = repositoryStructureFileId("packages/db/test/step-up-proof-store.test.ts");
const identityBoundaryTest = repositoryStructureFileId("apps/api/test/identity-boundary.test.ts");

const definitionEdges: IntelligenceGraphEdge[] = [
  ...actorKindNodes.map((item) =>
    edge({
      id: `identity-kind-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: identityFile,
      location: item.source_ref.location
    })
  ),
  ...actorStatusNodes.map((item) =>
    edge({
      id: `identity-actor-status-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: identityFile,
      location: item.source_ref.location
    })
  ),
  ...sessionStatusNodes.map((item) =>
    edge({
      id: `identity-session-status-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: identityFile,
      location: item.source_ref.location
    })
  ),
  ...assuranceNodes.map((item) =>
    edge({
      id: `identity-assurance-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: identityFile,
      location: item.source_ref.location
    })
  ),
  ...providerNodes.map((item) =>
    edge({
      id: `identity-provider-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: authFile,
      location: item.source_ref.location
    })
  ),
  ...verificationNodes.map((item) =>
    edge({
      id: `identity-verification-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: authFile,
      location: item.source_ref.location
    })
  ),
  ...auditNodes.map((item) =>
    edge({
      id: `identity-audit-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: identityFile,
      location: item.source_ref.location
    })
  )
];

const semanticEdges: IntelligenceGraphEdge[] = [
  ...actorKindNodes.map((item) =>
    edge({
      id: `identity-actor-kind-${item.node_id}`,
      type: "ALLOWED_KIND_FOR",
      from: item.node_id,
      to: "entity-identity-actor",
      location: "packages/contracts/src/identity.ts:IdentityActorSchema.kind"
    })
  ),
  ...actorStatusNodes.map((item) =>
    edge({
      id: `identity-actor-state-${item.node_id}`,
      type: "ALLOWED_STATUS_FOR",
      from: item.node_id,
      to: "entity-identity-actor",
      location: "packages/contracts/src/identity.ts:IdentityActorSchema.status"
    })
  ),
  ...sessionStatusNodes.map((item) =>
    edge({
      id: `identity-session-state-${item.node_id}`,
      type: "ALLOWED_STATUS_FOR",
      from: item.node_id,
      to: "entity-identity-session",
      location: "packages/contracts/src/identity.ts:IdentitySessionSchema.status"
    })
  ),
  ...assuranceNodes.map((item) =>
    edge({
      id: `identity-assurance-session-${item.node_id}`,
      type: "ASSURANCE_LEVEL_FOR",
      from: item.node_id,
      to: "entity-identity-session",
      location: "packages/contracts/src/identity.ts:IdentitySessionSchema.assurance"
    })
  ),
  ...providerNodes.map((item) =>
    edge({
      id: `identity-provider-external-${item.node_id}`,
      type: "PROVIDER_FOR",
      from: item.node_id,
      to: "entity-external-identity",
      location: "packages/contracts/src/auth.ts:ExternalIdentitySchema.provider"
    })
  ),
  ...verificationNodes.map((item) =>
    edge({
      id: `identity-verification-external-${item.node_id}`,
      type: "VERIFICATION_STATUS_FOR",
      from: item.node_id,
      to: "entity-external-identity",
      location: "packages/contracts/src/auth.ts:ExternalIdentitySchema.verification_status"
    })
  ),
  ...auditNodes.map((item) =>
    edge({
      id: `identity-audit-member-${item.node_id}`,
      type: "AUDIT_EVENT_FOR",
      from: item.node_id,
      to: "entity-identity-audit-log",
      location: item.source_ref.location
    })
  ),

  edge({
    id: "identity-actor-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-identity-actor",
    to: identityFile,
    location: "packages/contracts/src/identity.ts:IdentityActorSchema"
  }),
  edge({
    id: "identity-session-actor",
    type: "BELONGS_TO_ACTOR",
    from: "entity-identity-session",
    to: "entity-identity-actor",
    location: "packages/contracts/src/identity.ts:IdentitySessionSchema.actor_id"
  }),
  edge({
    id: "identity-session-owner-scope",
    type: "OWNER_SCOPED_BY",
    from: "entity-identity-session",
    to: "entity-store-identity",
    location: "packages/db/src/identity-store.ts:getSession owner_id"
  }),
  edge({
    id: "identity-external-provider-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-external-identity",
    to: authFile,
    location: "packages/contracts/src/auth.ts:ExternalIdentitySchema"
  }),
  edge({
    id: "identity-bootstrap-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-auth-session-bootstrap",
    to: authFile,
    location: "packages/contracts/src/auth.ts:AuthSessionBootstrapSchema"
  }),
  edge({
    id: "identity-bootstrap-creates-session",
    type: "BOOTSTRAPS",
    from: "entity-auth-session-bootstrap",
    to: "entity-identity-session",
    location: "packages/contracts/src/auth.ts:AuthSessionBootstrapSchema"
  }),
  edge({
    id: "identity-audit-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-identity-audit-log",
    to: identityFile,
    location: "packages/contracts/src/identity.ts:IdentityAuditEventSchema"
  }),
  edge({
    id: "identity-store-implements-session",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-identity",
    to: identityStoreFile,
    location: "packages/db/src/identity-store.ts:IdentityStore"
  }),
  edge({
    id: "identity-token-hash-claim",
    type: "ENFORCED_BY",
    from: "claim-identity-token-never-stored-raw",
    to: "entity-store-identity",
    location: "packages/db/src/identity-store.ts:hashIdentitySessionToken"
  }),
  edge({
    id: "identity-token-hash-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "claim-identity-token-never-stored-raw",
    to: identityStoreFile,
    location: "packages/db/src/identity-store.ts:hashIdentitySessionToken"
  }),
  edge({
    id: "identity-token-hash-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-identity-token-never-stored-raw",
    to: identityStoreTest,
    location: "packages/db/test/identity-store.test.ts"
  }),
  edge({
    id: "identity-active-revoked",
    type: "TRANSITIONS_TO",
    from: "identity-session-status-active",
    to: "identity-session-status-revoked",
    location: "packages/db/src/identity-store.ts:revokeSession"
  }),
  edge({
    id: "identity-active-expired",
    type: "TRANSITIONS_TO",
    from: "identity-session-status-active",
    to: "identity-session-status-expired",
    location: "packages/db/src/identity-store.ts:resolveSession/listSessions"
  }),
  edge({
    id: "identity-actor-disable-transition",
    type: "TRANSITIONS_TO",
    from: "identity-actor-status-active",
    to: "identity-actor-status-disabled",
    location: "packages/db/src/identity-store.ts:disableActor"
  }),
  edge({
    id: "identity-disable-revokes-sessions",
    type: "CASCADE_REVOKES",
    from: "identity-actor-status-disabled",
    to: "identity-session-status-revoked",
    location: "packages/db/src/identity-store.ts:disableActor"
  }),
  edge({
    id: "identity-audit-owner-scoped",
    type: "OWNER_SCOPED_BY",
    from: "entity-identity-audit-log",
    to: "entity-store-identity",
    location: "packages/db/src/identity-store.ts:listRecentAuditEvents"
  }),
  edge({
    id: "identity-store-regression",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-identity",
    to: identityStoreTest,
    location: "packages/db/test/identity-store.test.ts"
  }),

  edge({
    id: "identity-step-up-store-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-step-up-proof",
    to: stepUpStoreFile,
    location: "packages/db/src/step-up-proof-store.ts:StepUpProofStore"
  }),
  edge({
    id: "identity-step-up-binding-claim",
    type: "ENFORCED_BY",
    from: "claim-step-up-exact-binding-one-use",
    to: "entity-step-up-proof",
    location: "packages/db/src/step-up-proof-store.ts:consumeProof"
  }),
  edge({
    id: "identity-step-up-session-bound",
    type: "BOUND_TO",
    from: "entity-step-up-proof",
    to: "entity-identity-session",
    location: "packages/contracts/src/step-up.ts:StepUpProofSchema.session_id"
  }),
  edge({
    id: "identity-step-up-binding-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-step-up-exact-binding-one-use",
    to: stepUpStoreTest,
    location: "packages/db/test/step-up-proof-store.test.ts"
  }),
  edge({
    id: "identity-step-up-expiry-fail-closed",
    type: "FAILS_CLOSED_WITH",
    from: "entity-step-up-proof",
    to: "identity-session-status-expired",
    location: "packages/db/test/step-up-proof-store.test.ts:fails closed after proof expiry"
  }),
  edge({
    id: "identity-step-up-revocation-fail-closed",
    type: "FAILS_CLOSED_WITH",
    from: "entity-step-up-proof",
    to: "identity-session-status-revoked",
    location: "packages/db/test/step-up-proof-store.test.ts:session revocation"
  }),

  edge({
    id: "identity-owner-api-claim",
    type: "ENFORCED_BY",
    from: "claim-owner-api-requires-owner-session",
    to: "entity-api-identity",
    location: "apps/api/test/identity-boundary.test.ts"
  }),
  edge({
    id: "identity-owner-api-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-owner-api-requires-owner-session",
    to: identityBoundaryTest,
    location: "apps/api/test/identity-boundary.test.ts"
  }),
  edge({
    id: "identity-owner-kind-api",
    type: "ALLOWED_AT_OWNER_API",
    from: "identity-actor-kind-owner",
    to: "entity-api-identity",
    location: "apps/api/test/identity-boundary.test.ts:owner session"
  }),
  edge({
    id: "identity-agent-kind-denied-api",
    type: "DENIED_AT_OWNER_API",
    from: "identity-actor-kind-agent",
    to: "entity-api-identity",
    location: "apps/api/test/identity-boundary.test.ts:agent session forbidden"
  }),
  edge({
    id: "identity-system-kind-denied-api",
    type: "DENIED_AT_OWNER_API",
    from: "identity-actor-kind-system",
    to: "entity-api-identity",
    location: "apps/api/test/identity-boundary.test.ts:system session forbidden"
  })
];

const nodes = [
  ...actorKindNodes,
  ...actorStatusNodes,
  ...sessionStatusNodes,
  ...assuranceNodes,
  ...providerNodes,
  ...verificationNodes,
  ...auditNodes,
  ...trustNodes
];

const edges = [...definitionEdges, ...semanticEdges];

const records: IntelligenceGraphSearchRecord[] = nodes.map((item) => ({
  node: { id: item.node_id, version: 1 },
  text: item.node_id.replaceAll("-", " "),
  excerpt: item.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraIdentityTrustGraph = () => ({ nodes, edges, records });

export const COSMORA_IDENTITY_TRUST_NODE_COUNT = nodes.length;
export const COSMORA_IDENTITY_TRUST_EDGE_COUNT = edges.length;
