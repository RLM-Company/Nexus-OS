import { Type, type Static } from "typebox";
import { RuntimeDataClassSchema } from "./manager-runtime.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const INTELLIGENCE_GRAPH_CONTRACT_VERSION = 1 as const;

export const IntelligenceGraphNodeKindSchema = Type.Union([
  Type.Literal("Project"),
  Type.Literal("Source"),
  Type.Literal("Document"),
  Type.Literal("Chunk"),
  Type.Literal("Entity"),
  Type.Literal("Claim"),
  Type.Literal("Event"),
  Type.Literal("Goal"),
  Type.Literal("Decision"),
  Type.Literal("Task"),
  Type.Literal("Artifact"),
  Type.Literal("AgentRole"),
  Type.Literal("ModelVersion"),
  Type.Literal("Evaluation"),
  Type.Literal("Outcome"),
  Type.Literal("Feedback")
]);
export type IntelligenceGraphNodeKind = Static<typeof IntelligenceGraphNodeKindSchema>;

export const IntelligenceGraphScopeSchema = Type.Union([
  Type.Literal("project"),
  Type.Literal("owner_global")
]);
export type IntelligenceGraphScope = Static<typeof IntelligenceGraphScopeSchema>;

export const IntelligenceGraphVerificationStatusSchema = Type.Union([
  Type.Literal("discovered"),
  Type.Literal("hypothesis"),
  Type.Literal("verified"),
  Type.Literal("disputed"),
  Type.Literal("superseded"),
  Type.Literal("deleted")
]);
export type IntelligenceGraphVerificationStatus = Static<
  typeof IntelligenceGraphVerificationStatusSchema
>;

export const IntelligenceGraphProvenanceKindSchema = Type.Union([
  Type.Literal("owner_assertion"),
  Type.Literal("document"),
  Type.Literal("tool_result"),
  Type.Literal("model_inference"),
  Type.Literal("human_verification"),
  Type.Literal("deterministic_derivation"),
  Type.Literal("runtime_record")
]);
export type IntelligenceGraphProvenanceKind = Static<
  typeof IntelligenceGraphProvenanceKindSchema
>;

export const IntelligenceGraphConfidenceMethodSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("owner_direct"),
  Type.Literal("primary_source"),
  Type.Literal("human_review"),
  Type.Literal("deterministic_check"),
  Type.Literal("model_only")
]);
export type IntelligenceGraphConfidenceMethod = Static<
  typeof IntelligenceGraphConfidenceMethodSchema
>;

export const IntelligenceGraphEvidenceRefSchema = Type.Object(
  {
    source_id: EntityIdSchema,
    source_version: Type.Integer({ minimum: 1 }),
    location: Type.String({ minLength: 1, maxLength: 2_048 })
  },
  { additionalProperties: false }
);
export type IntelligenceGraphEvidenceRef = Static<typeof IntelligenceGraphEvidenceRefSchema>;

export const IntelligenceGraphVersionRefSchema = Type.Object(
  {
    id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type IntelligenceGraphVersionRef = Static<typeof IntelligenceGraphVersionRefSchema>;

const nullableTime = Type.Union([IsoDateTimeSchema, Type.Null()]);
const nullableVersionRef = Type.Union([IntelligenceGraphVersionRefSchema, Type.Null()]);
const nullableExtractor = Type.Union([
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.Null()
]);

export const IntelligenceGraphNodeSchema = Type.Object(
  {
    contract_version: Type.Literal(INTELLIGENCE_GRAPH_CONTRACT_VERSION),
    node_id: EntityIdSchema,
    node_version: Type.Integer({ minimum: 1 }),
    kind: IntelligenceGraphNodeKindSchema,
    owner_id: EntityIdSchema,
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    scope: IntelligenceGraphScopeSchema,
    created_at: IsoDateTimeSchema,
    observed_at: nullableTime,
    valid_from: nullableTime,
    valid_to: nullableTime,
    verification_status: IntelligenceGraphVerificationStatusSchema,
    sensitivity: RuntimeDataClassSchema,
    source_ref: IntelligenceGraphEvidenceRefSchema,
    provenance_kind: IntelligenceGraphProvenanceKindSchema,
    confidence_method: IntelligenceGraphConfidenceMethodSchema,
    extractor_version: nullableExtractor,
    supersedes: nullableVersionRef,
    deleted_at: nullableTime
  },
  { additionalProperties: false }
);
export type IntelligenceGraphNode = Static<typeof IntelligenceGraphNodeSchema>;

export const IntelligenceGraphEdgeSchema = Type.Object(
  {
    contract_version: Type.Literal(INTELLIGENCE_GRAPH_CONTRACT_VERSION),
    edge_id: EntityIdSchema,
    edge_version: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Z][A-Z0-9_]*$" }),
    from: IntelligenceGraphVersionRefSchema,
    to: IntelligenceGraphVersionRefSchema,
    owner_id: EntityIdSchema,
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    scope: IntelligenceGraphScopeSchema,
    created_at: IsoDateTimeSchema,
    observed_at: nullableTime,
    valid_from: nullableTime,
    valid_to: nullableTime,
    verification_status: IntelligenceGraphVerificationStatusSchema,
    sensitivity: RuntimeDataClassSchema,
    evidence_ref: IntelligenceGraphEvidenceRefSchema,
    provenance_kind: IntelligenceGraphProvenanceKindSchema,
    confidence_method: IntelligenceGraphConfidenceMethodSchema,
    extractor_version: nullableExtractor,
    supersedes: nullableVersionRef,
    deleted_at: nullableTime
  },
  { additionalProperties: false }
);
export type IntelligenceGraphEdge = Static<typeof IntelligenceGraphEdgeSchema>;

export const IntelligenceGraphSnapshotSchema = Type.Object(
  {
    contract_version: Type.Literal(INTELLIGENCE_GRAPH_CONTRACT_VERSION),
    owner_id: EntityIdSchema,
    project_id: Type.Union([EntityIdSchema, Type.Null()]),
    nodes: Type.Array(IntelligenceGraphNodeSchema, { maxItems: 100_000 }),
    edges: Type.Array(IntelligenceGraphEdgeSchema, { maxItems: 500_000 })
  },
  { additionalProperties: false }
);
export type IntelligenceGraphSnapshot = Static<typeof IntelligenceGraphSnapshotSchema>;

const versionKey = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;
const nodeKey = (node: IntelligenceGraphNode): string =>
  versionKey({ id: node.node_id, version: node.node_version });
const edgeKey = (edge: IntelligenceGraphEdge): string =>
  versionKey({ id: edge.edge_id, version: edge.edge_version });

const after = (left: string, right: string): boolean => Date.parse(left) > Date.parse(right);
const before = (left: string, right: string): boolean => Date.parse(left) < Date.parse(right);

const validateTimeWindow = (input: {
  label: string;
  createdAt: string;
  observedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  deletedAt: string | null;
  status: IntelligenceGraphVerificationStatus;
}): string[] => {
  const issues: string[] = [];
  if (input.observedAt !== null && after(input.observedAt, input.createdAt)) {
    issues.push(`${input.label} was observed after its record was created`);
  }
  if (
    input.validFrom !== null &&
    input.validTo !== null &&
    after(input.validFrom, input.validTo)
  ) {
    issues.push(`${input.label} has an inverted validity interval`);
  }
  if (input.deletedAt !== null && before(input.deletedAt, input.createdAt)) {
    issues.push(`${input.label} was deleted before it was created`);
  }
  if (input.status === "deleted" && input.deletedAt === null) {
    issues.push(`${input.label} marked deleted requires deleted_at`);
  }
  if (input.status !== "deleted" && input.deletedAt !== null) {
    issues.push(`${input.label} not marked deleted cannot carry deleted_at`);
  }
  return issues;
};

const validateVerification = (input: {
  label: string;
  status: IntelligenceGraphVerificationStatus;
  provenance: IntelligenceGraphProvenanceKind;
  confidence: IntelligenceGraphConfidenceMethod;
}): string[] => {
  const issues: string[] = [];
  if (input.status === "verified" && input.confidence === "model_only") {
    issues.push(`${input.label} cannot be verified by model-only confidence`);
  }
  if (
    input.status === "verified" &&
    input.provenance === "model_inference" &&
    input.confidence !== "human_review" &&
    input.confidence !== "deterministic_check"
  ) {
    issues.push(`${input.label} model inference requires independent verification`);
  }
  return issues;
};

export const validateIntelligenceGraphSnapshot = (input: {
  ownerId: string;
  projectId: string | null;
  nodes: readonly IntelligenceGraphNode[];
  edges: readonly IntelligenceGraphEdge[];
  allowOwnerGlobal?: boolean;
}): string[] => {
  const issues: string[] = [];
  const allowOwnerGlobal = input.allowOwnerGlobal ?? false;
  const nodes = new Map<string, IntelligenceGraphNode>();
  const edges = new Map<string, IntelligenceGraphEdge>();

  for (const node of input.nodes) {
    const key = nodeKey(node);
    if (nodes.has(key)) {
      issues.push(`Duplicate intelligence graph node version: ${key}`);
      continue;
    }
    nodes.set(key, node);

    if (node.owner_id !== input.ownerId) {
      issues.push(`Node ${key} belongs to another owner`);
    }
    if (node.scope === "project") {
      if (input.projectId === null || node.project_id !== input.projectId) {
        issues.push(`Node ${key} belongs to another project`);
      }
    } else {
      if (node.project_id !== null) {
        issues.push(`Owner-global node ${key} must not carry project_id`);
      }
      if (!allowOwnerGlobal) {
        issues.push(`Owner-global node ${key} is not authorized for this request`);
      }
    }

    issues.push(
      ...validateTimeWindow({
        label: `Node ${key}`,
        createdAt: node.created_at,
        observedAt: node.observed_at,
        validFrom: node.valid_from,
        validTo: node.valid_to,
        deletedAt: node.deleted_at,
        status: node.verification_status
      })
    );
    issues.push(
      ...validateVerification({
        label: `Node ${key}`,
        status: node.verification_status,
        provenance: node.provenance_kind,
        confidence: node.confidence_method
      })
    );
  }

  for (const edge of input.edges) {
    const key = edgeKey(edge);
    if (edges.has(key)) {
      issues.push(`Duplicate intelligence graph edge version: ${key}`);
      continue;
    }
    edges.set(key, edge);

    if (edge.owner_id !== input.ownerId) {
      issues.push(`Edge ${key} belongs to another owner`);
    }
    if (edge.scope === "project") {
      if (input.projectId === null || edge.project_id !== input.projectId) {
        issues.push(`Edge ${key} belongs to another project`);
      }
    } else {
      if (edge.project_id !== null) {
        issues.push(`Owner-global edge ${key} must not carry project_id`);
      }
      if (!allowOwnerGlobal) {
        issues.push(`Owner-global edge ${key} is not authorized for this request`);
      }
    }

    issues.push(
      ...validateTimeWindow({
        label: `Edge ${key}`,
        createdAt: edge.created_at,
        observedAt: edge.observed_at,
        validFrom: edge.valid_from,
        validTo: edge.valid_to,
        deletedAt: edge.deleted_at,
        status: edge.verification_status
      })
    );
    issues.push(
      ...validateVerification({
        label: `Edge ${key}`,
        status: edge.verification_status,
        provenance: edge.provenance_kind,
        confidence: edge.confidence_method
      })
    );

    const from = nodes.get(versionKey(edge.from));
    const to = nodes.get(versionKey(edge.to));
    if (from === undefined) {
      issues.push(`Edge ${key} references unknown source node ${versionKey(edge.from)}`);
    }
    if (to === undefined) {
      issues.push(`Edge ${key} references unknown target node ${versionKey(edge.to)}`);
    }
    if (from !== undefined && to !== undefined) {
      if (
        from.owner_id !== edge.owner_id ||
        to.owner_id !== edge.owner_id ||
        from.scope !== edge.scope ||
        to.scope !== edge.scope ||
        from.project_id !== edge.project_id ||
        to.project_id !== edge.project_id
      ) {
        issues.push(`Edge ${key} crosses an owner, project, or scope boundary`);
      }
      if (
        edge.verification_status !== "deleted" &&
        (from.verification_status === "deleted" || to.verification_status === "deleted")
      ) {
        issues.push(`Active edge ${key} cannot reference a deleted node version`);
      }
    }
  }

  const nodeSuperseders = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.supersedes === null) continue;
    const current = nodeKey(node);
    const targetKey = versionKey(node.supersedes);
    const target = nodes.get(targetKey);
    const superseders = nodeSuperseders.get(targetKey) ?? [];
    superseders.push(current);
    nodeSuperseders.set(targetKey, superseders);

    if (node.supersedes.id !== node.node_id) {
      issues.push(`Node ${current} may only supersede the same stable node_id`);
    }
    if (node.supersedes.version >= node.node_version) {
      issues.push(`Node ${current} must supersede an older node version`);
    }
    if (target === undefined) {
      issues.push(`Node ${current} supersedes unknown node version ${targetKey}`);
      continue;
    }
    if (
      target.kind !== node.kind ||
      target.owner_id !== node.owner_id ||
      target.project_id !== node.project_id ||
      target.scope !== node.scope
    ) {
      issues.push(`Node ${current} supersedes an incompatible node version ${targetKey}`);
    }
    if (target.verification_status !== "superseded") {
      issues.push(`Superseded node version ${targetKey} must be marked superseded`);
    }
    if (before(node.created_at, target.created_at)) {
      issues.push(`Node ${current} cannot supersede a version created later`);
    }
  }
  for (const node of nodes.values()) {
    if (node.verification_status !== "superseded") continue;
    const key = nodeKey(node);
    const superseders = nodeSuperseders.get(key) ?? [];
    if (superseders.length === 0) {
      issues.push(`Superseded node version ${key} has no replacement`);
    } else if (superseders.length > 1) {
      issues.push(`Superseded node version ${key} has multiple replacements`);
    }
  }

  const edgeSuperseders = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (edge.supersedes === null) continue;
    const current = edgeKey(edge);
    const targetKey = versionKey(edge.supersedes);
    const target = edges.get(targetKey);
    const superseders = edgeSuperseders.get(targetKey) ?? [];
    superseders.push(current);
    edgeSuperseders.set(targetKey, superseders);

    if (edge.supersedes.id !== edge.edge_id) {
      issues.push(`Edge ${current} may only supersede the same stable edge_id`);
    }
    if (edge.supersedes.version >= edge.edge_version) {
      issues.push(`Edge ${current} must supersede an older edge version`);
    }
    if (target === undefined) {
      issues.push(`Edge ${current} supersedes unknown edge version ${targetKey}`);
      continue;
    }
    if (
      target.type !== edge.type ||
      target.owner_id !== edge.owner_id ||
      target.project_id !== edge.project_id ||
      target.scope !== edge.scope
    ) {
      issues.push(`Edge ${current} supersedes an incompatible edge version ${targetKey}`);
    }
    if (target.verification_status !== "superseded") {
      issues.push(`Superseded edge version ${targetKey} must be marked superseded`);
    }
    if (before(edge.created_at, target.created_at)) {
      issues.push(`Edge ${current} cannot supersede a version created later`);
    }
  }
  for (const edge of edges.values()) {
    if (edge.verification_status !== "superseded") continue;
    const key = edgeKey(edge);
    const superseders = edgeSuperseders.get(key) ?? [];
    if (superseders.length === 0) {
      issues.push(`Superseded edge version ${key} has no replacement`);
    } else if (superseders.length > 1) {
      issues.push(`Superseded edge version ${key} has multiple replacements`);
    }
  }

  return [...new Set(issues)];
};
