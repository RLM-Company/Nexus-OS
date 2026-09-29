import {
  validateIntelligenceGraphSnapshot,
  type IntelligenceGraphConfidenceMethod,
  IntelligenceGraphEdge,
  IntelligenceGraphNode,
  IntelligenceGraphNodeKind,
  IntelligenceGraphProvenanceKind,
  IntelligenceGraphVerificationStatus,
  IntelligenceGraphVersionRef,
  RuntimeDataClass
} from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "./intelligence-graph-retrieval.js";

export interface AuthorizedIntelligenceGraphFixtureEntry {
  id: string;
  version?: number;
  kind: IntelligenceGraphNodeKind;
  text: string;
  excerpt: string;
  location: string;
  created_at: string;
  observed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  verification_status: IntelligenceGraphVerificationStatus;
  provenance_kind: IntelligenceGraphProvenanceKind;
  confidence_method: IntelligenceGraphConfidenceMethod;
  sensitivity?: RuntimeDataClass;
  supersedes?: IntelligenceGraphVersionRef | null;
  estimated_tokens: number;
}

export interface AuthorizedIntelligenceGraphFixtureRelation {
  id: string;
  version?: number;
  type: string;
  from: IntelligenceGraphVersionRef;
  to: IntelligenceGraphVersionRef;
  location: string;
  created_at: string;
  observed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  verification_status: IntelligenceGraphVerificationStatus;
  provenance_kind: IntelligenceGraphProvenanceKind;
  confidence_method: IntelligenceGraphConfidenceMethod;
  sensitivity?: RuntimeDataClass;
  supersedes?: IntelligenceGraphVersionRef | null;
}

export interface AuthorizedIntelligenceGraphFixture {
  owner_id: string;
  project_id: string;
  source: {
    id: string;
    version: number;
    title: string;
    excerpt: string;
    location: string;
    created_at: string;
    sensitivity?: RuntimeDataClass;
    estimated_tokens: number;
  };
  entries: readonly AuthorizedIntelligenceGraphFixtureEntry[];
  relations: readonly AuthorizedIntelligenceGraphFixtureRelation[];
}

export interface CompiledIntelligenceGraphFixture {
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
  records: IntelligenceGraphSearchRecord[];
}

const ID_PATTERN = /^\S{1,128}$/;
const EDGE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SECRET_LIKE =
  /(?:api[_-]?key|authorization\s*:\s*bearer|bearer\s+[a-z0-9._-]{8,}|password\s*[:=]|secret\s*[:=]|token\s*[:=])/i;

const assertId = (value: string, label: string): void => {
  if (!ID_PATTERN.test(value)) throw new Error(`Invalid Intelligence Graph fixture ${label}`);
};

const assertIsoTime = (value: string | null | undefined, label: string): void => {
  if (value === null || value === undefined) return;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`Invalid Intelligence Graph fixture time: ${label}`);
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid Intelligence Graph fixture time: ${label}`);
  }
};

const assertText = (value: string, label: string, maximum = 8_192): void => {
  if (!value.trim() || value.length > maximum) {
    throw new Error(`Invalid Intelligence Graph fixture text: ${label}`);
  }
  if (SECRET_LIKE.test(value)) {
    throw new Error(`Secret-like material rejected from Intelligence Graph fixture: ${label}`);
  }
};

const assertTokenEstimate = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1 || value > 24_000) {
    throw new Error(`Invalid Intelligence Graph fixture token estimate: ${label}`);
  }
};

const refKey = (ref: IntelligenceGraphVersionRef): string => `${ref.id}@${ref.version}`;

export const compileAuthorizedIntelligenceGraphFixture = (
  fixture: AuthorizedIntelligenceGraphFixture
): CompiledIntelligenceGraphFixture => {
  assertId(fixture.owner_id, "owner_id");
  assertId(fixture.project_id, "project_id");
  assertId(fixture.source.id, "source.id");
  if (!Number.isInteger(fixture.source.version) || fixture.source.version < 1) {
    throw new Error("Invalid Intelligence Graph fixture source.version");
  }
  assertText(fixture.source.title, "source.title", 512);
  assertText(fixture.source.excerpt, "source.excerpt");
  assertText(fixture.source.location, "source.location", 2_048);
  assertIsoTime(fixture.source.created_at, "source.created_at");
  assertTokenEstimate(fixture.source.estimated_tokens, "source");

  const sourceNode: IntelligenceGraphNode = {
    contract_version: 1,
    node_id: fixture.source.id,
    node_version: fixture.source.version,
    kind: "Source",
    owner_id: fixture.owner_id,
    project_id: fixture.project_id,
    scope: "project",
    created_at: fixture.source.created_at,
    observed_at: fixture.source.created_at,
    valid_from: fixture.source.created_at,
    valid_to: null,
    verification_status: "verified",
    sensitivity: fixture.source.sensitivity ?? "D1_PROJECT",
    source_ref: {
      source_id: fixture.source.id,
      source_version: fixture.source.version,
      location: fixture.source.location
    },
    provenance_kind: "runtime_record",
    confidence_method: "deterministic_check",
    extractor_version: "authorized-fixture-v1",
    supersedes: null,
    deleted_at: null
  };

  if (sourceNode.sensitivity === "D4_PRIVATE_CHAT") {
    throw new Error("Confidential-chat material cannot enter a persistent Intelligence Graph fixture");
  }

  const nodes: IntelligenceGraphNode[] = [sourceNode];
  const records: IntelligenceGraphSearchRecord[] = [
    {
      node: { id: sourceNode.node_id, version: sourceNode.node_version },
      text: fixture.source.title,
      excerpt: fixture.source.excerpt,
      estimated_tokens: fixture.source.estimated_tokens
    }
  ];
  const knownRefs = new Set<string>([refKey(records[0]!.node)]);

  for (const entry of fixture.entries) {
    assertId(entry.id, "entry.id");
    const version = entry.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Invalid Intelligence Graph fixture entry.version: ${entry.id}`);
    }
    const ref = { id: entry.id, version };
    const key = refKey(ref);
    if (knownRefs.has(key)) {
      throw new Error(`Duplicate Intelligence Graph fixture node: ${key}`);
    }
    assertText(entry.text, `entry.text:${key}`);
    assertText(entry.excerpt, `entry.excerpt:${key}`);
    assertText(entry.location, `entry.location:${key}`, 2_048);
    assertIsoTime(entry.created_at, `entry.created_at:${key}`);
    assertIsoTime(entry.observed_at, `entry.observed_at:${key}`);
    assertIsoTime(entry.valid_from, `entry.valid_from:${key}`);
    assertIsoTime(entry.valid_to, `entry.valid_to:${key}`);
    assertTokenEstimate(entry.estimated_tokens, key);

    const sensitivity = entry.sensitivity ?? "D1_PROJECT";
    if (sensitivity === "D4_PRIVATE_CHAT") {
      throw new Error("Confidential-chat material cannot enter a persistent Intelligence Graph fixture");
    }

    const node: IntelligenceGraphNode = {
      contract_version: 1,
      node_id: entry.id,
      node_version: version,
      kind: entry.kind,
      owner_id: fixture.owner_id,
      project_id: fixture.project_id,
      scope: "project",
      created_at: entry.created_at,
      observed_at: entry.observed_at ?? entry.created_at,
      valid_from: entry.valid_from ?? entry.created_at,
      valid_to: entry.valid_to ?? null,
      verification_status: entry.verification_status,
      sensitivity,
      source_ref: {
        source_id: fixture.source.id,
        source_version: fixture.source.version,
        location: entry.location
      },
      provenance_kind: entry.provenance_kind,
      confidence_method: entry.confidence_method,
      extractor_version: "authorized-fixture-v1",
      supersedes: entry.supersedes ?? null,
      deleted_at: null
    };

    nodes.push(node);
    records.push({
      node: ref,
      text: entry.text,
      excerpt: entry.excerpt,
      estimated_tokens: entry.estimated_tokens
    });
    knownRefs.add(key);
  }

  const edges: IntelligenceGraphEdge[] = [];
  const edgeRefs = new Set<string>();
  for (const relation of fixture.relations) {
    assertId(relation.id, "relation.id");
    const version = relation.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Invalid Intelligence Graph fixture relation.version: ${relation.id}`);
    }
    if (!EDGE_TYPE_PATTERN.test(relation.type)) {
      throw new Error(`Invalid Intelligence Graph fixture relation.type: ${relation.id}`);
    }
    const key = refKey({ id: relation.id, version });
    if (edgeRefs.has(key)) {
      throw new Error(`Duplicate Intelligence Graph fixture edge: ${key}`);
    }
    if (!knownRefs.has(refKey(relation.from))) {
      throw new Error(`Intelligence Graph fixture relation has unknown from node: ${key}`);
    }
    if (!knownRefs.has(refKey(relation.to))) {
      throw new Error(`Intelligence Graph fixture relation has unknown to node: ${key}`);
    }
    assertText(relation.location, `relation.location:${key}`, 2_048);
    assertIsoTime(relation.created_at, `relation.created_at:${key}`);
    assertIsoTime(relation.observed_at, `relation.observed_at:${key}`);
    assertIsoTime(relation.valid_from, `relation.valid_from:${key}`);
    assertIsoTime(relation.valid_to, `relation.valid_to:${key}`);

    const sensitivity = relation.sensitivity ?? "D1_PROJECT";
    if (sensitivity === "D4_PRIVATE_CHAT") {
      throw new Error("Confidential-chat material cannot enter a persistent Intelligence Graph fixture");
    }

    edges.push({
      contract_version: 1,
      edge_id: relation.id,
      edge_version: version,
      type: relation.type,
      from: structuredClone(relation.from),
      to: structuredClone(relation.to),
      owner_id: fixture.owner_id,
      project_id: fixture.project_id,
      scope: "project",
      created_at: relation.created_at,
      observed_at: relation.observed_at ?? relation.created_at,
      valid_from: relation.valid_from ?? relation.created_at,
      valid_to: relation.valid_to ?? null,
      verification_status: relation.verification_status,
      sensitivity,
      evidence_ref: {
        source_id: fixture.source.id,
        source_version: fixture.source.version,
        location: relation.location
      },
      provenance_kind: relation.provenance_kind,
      confidence_method: relation.confidence_method,
      extractor_version: "authorized-fixture-v1",
      supersedes: relation.supersedes ?? null,
      deleted_at: null
    });
    edgeRefs.add(key);
  }

  const issues = validateIntelligenceGraphSnapshot({
    ownerId: fixture.owner_id,
    projectId: fixture.project_id,
    nodes,
    edges
  });
  if (issues.length > 0) {
    throw new Error(`Invalid compiled Intelligence Graph fixture: ${issues.join("; ")}`);
  }

  return { nodes, edges, records };
};
