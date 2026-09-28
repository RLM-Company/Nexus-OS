import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  IntelligenceGraphConflictSchema,
  IntelligenceGraphEdgeSchema,
  IntelligenceGraphNodeSchema,
  validateIntelligenceGraphConflict,
  validateIntelligenceGraphSnapshot,
  type IntelligenceGraphConflict,
  type IntelligenceGraphEdge,
  type IntelligenceGraphNode
} from "../src/index.js";

const t0 = "2026-09-28T18:00:00.000Z";
const t1 = "2026-09-28T18:01:00.000Z";
const t2 = "2026-09-28T18:02:00.000Z";

const node = (
  id: string,
  overrides: Partial<IntelligenceGraphNode> = {}
): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: id,
  node_version: 1,
  kind: "Claim",
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t0,
  observed_at: t0,
  valid_from: t0,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: { source_id: `source-${id}`, source_version: 1, location: "line:1" },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

const edge = (
  id: string,
  from: IntelligenceGraphNode,
  to: IntelligenceGraphNode,
  overrides: Partial<IntelligenceGraphEdge> = {}
): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: id,
  edge_version: 1,
  type: "SUPPORTED_BY",
  from: { id: from.node_id, version: from.node_version },
  to: { id: to.node_id, version: to.node_version },
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t1,
  observed_at: t1,
  valid_from: t1,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: { source_id: "source-edge", source_version: 1, location: "line:2" },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

describe("Intelligence Graph deterministic kernel", () => {
  it("accepts a bounded same-owner, same-project evidence graph", () => {
    const claim = node("claim-1");
    const source = node("source-1", { kind: "Source" });
    const relation = edge("edge-1", claim, source);

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [claim, source],
        edges: [relation]
      })
    ).toEqual([]);
  });

  it("rejects cross-project nodes and traversal edges", () => {
    const local = node("local");
    const foreign = node("foreign", { project_id: "project-2" });
    const relation = edge("edge-1", local, foreign);

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [local, foreign],
        edges: [relation]
      })
    ).toEqual(
      expect.arrayContaining([
        "Node foreign@1 belongs to another project",
        "Edge edge-1@1 crosses an owner, project, or scope boundary"
      ])
    );
  });

  it("rejects another owner's data even when project ids match", () => {
    const local = node("local");
    const foreign = node("foreign", { owner_id: "owner-2" });
    const relation = edge("edge-1", local, foreign);

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [local, foreign],
        edges: [relation]
      })
    ).toEqual(
      expect.arrayContaining([
        "Node foreign@1 belongs to another owner",
        "Edge edge-1@1 crosses an owner, project, or scope boundary"
      ])
    );
  });

  it("requires explicit authorization before reading owner-global records", () => {
    const global = node("global", {
      kind: "Goal",
      project_id: null,
      scope: "owner_global",
      sensitivity: "D1_PROJECT"
    });

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [global],
        edges: []
      })
    ).toContain("Owner-global node global@1 is not authorized for this request");

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [global],
        edges: [],
        allowOwnerGlobal: true
      })
    ).toEqual([]);
  });

  it("does not allow model-only inference to become a verified fact", () => {
    const inferred = node("inferred", {
      provenance_kind: "model_inference",
      confidence_method: "model_only"
    });

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [inferred],
        edges: []
      })
    ).toEqual(
      expect.arrayContaining([
        "Node inferred@1 cannot be verified by model-only confidence",
        "Node inferred@1 model inference requires independent verification"
      ])
    );
  });

  it("accepts versioned correction only when the old version is explicitly superseded", () => {
    const oldClaim = node("claim-1", {
      verification_status: "superseded",
      created_at: t0,
      observed_at: t0
    });
    const corrected = node("claim-1", {
      node_version: 2,
      created_at: t1,
      observed_at: t1,
      supersedes: { id: "claim-1", version: 1 }
    });

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [oldClaim, corrected],
        edges: []
      })
    ).toEqual([]);
  });

  it("rejects invalid or time-reversed supersession", () => {
    const oldClaim = node("claim-1", {
      created_at: t2,
      observed_at: t2,
      verification_status: "verified"
    });
    const replacement = node("claim-1", {
      node_version: 2,
      created_at: t1,
      observed_at: t1,
      supersedes: { id: "claim-1", version: 1 }
    });

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [oldClaim, replacement],
        edges: []
      })
    ).toEqual(
      expect.arrayContaining([
        "Superseded node version claim-1@1 must be marked superseded",
        "Node claim-1@2 cannot supersede a version created later"
      ])
    );
  });

  it("rejects orphaned superseded versions and duplicate stable versions", () => {
    const superseded = node("claim-1", { verification_status: "superseded" });

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [superseded, superseded],
        edges: []
      })
    ).toEqual(
      expect.arrayContaining([
        "Duplicate intelligence graph node version: claim-1@1",
        "Superseded node version claim-1@1 has no replacement"
      ])
    );
  });

  it("requires exact endpoint versions and blocks active edges to deleted nodes", () => {
    const active = node("active");
    const deleted = node("deleted", {
      verification_status: "deleted",
      deleted_at: t1
    });
    const relation = edge("edge-1", active, deleted);
    const missingVersion: IntelligenceGraphEdge = {
      ...edge("edge-2", active, deleted),
      to: { id: "deleted", version: 99 }
    };

    expect(
      validateIntelligenceGraphSnapshot({
        ownerId: "owner-1",
        projectId: "project-1",
        nodes: [active, deleted],
        edges: [relation, missingVersion]
      })
    ).toEqual(
      expect.arrayContaining([
        "Active edge edge-1@1 cannot reference a deleted node version",
        "Edge edge-2@1 references unknown target node deleted@99"
      ])
    );
  });

  it("enforces deletion and temporal invariants", () => {
    const badDeleted = node("bad-deleted", {
      verification_status: "deleted",
      deleted_at: null
    });
    const badActive = node("bad-active", { deleted_at: t1 });
    const inverted = node("inverted", { valid_from: t2, valid_to: t1 });
    const futureObserved = node("future-observed", { created_at: t0, observed_at: t1 });

    const issues = validateIntelligenceGraphSnapshot({
      ownerId: "owner-1",
      projectId: "project-1",
      nodes: [badDeleted, badActive, inverted, futureObserved],
      edges: []
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Node bad-deleted@1 marked deleted requires deleted_at",
        "Node bad-active@1 not marked deleted cannot carry deleted_at",
        "Node inverted@1 has an inverted validity interval",
        "Node future-observed@1 was observed after its record was created"
      ])
    );
  });

  it("validates explicit conflicts without silently choosing a claim", () => {
    const subject = node("entity-1", { kind: "Entity" });
    const left = node("claim-left");
    const right = node("claim-right");
    const conflict: IntelligenceGraphConflict = {
      contract_version: 1,
      conflict_id: "conflict-1",
      owner_id: "owner-1",
      project_id: "project-1",
      scope: "project",
      subject_ref: { id: subject.node_id, version: subject.node_version },
      position_refs: [
        { id: left.node_id, version: left.node_version },
        { id: right.node_id, version: right.node_version }
      ],
      status: "open",
      resolution_ref: null,
      created_at: t1,
      resolved_at: null
    };

    expect(Value.Check(IntelligenceGraphConflictSchema, conflict)).toBe(true);
    expect(
      validateIntelligenceGraphConflict({
        ownerId: "owner-1",
        projectId: "project-1",
        conflict,
        nodes: [subject, left, right]
      })
    ).toEqual([]);
  });

  it("requires distinct conflict positions and an evidence-bearing Decision resolution", () => {
    const subject = node("entity-1", { kind: "Entity" });
    const position = node("claim-1");
    const conflict: IntelligenceGraphConflict = {
      contract_version: 1,
      conflict_id: "conflict-1",
      owner_id: "owner-1",
      project_id: "project-1",
      scope: "project",
      subject_ref: { id: subject.node_id, version: subject.node_version },
      position_refs: [
        { id: position.node_id, version: position.node_version },
        { id: position.node_id, version: position.node_version }
      ],
      status: "resolved",
      resolution_ref: null,
      created_at: t1,
      resolved_at: null
    };

    expect(
      validateIntelligenceGraphConflict({
        ownerId: "owner-1",
        projectId: "project-1",
        conflict,
        nodes: [subject, position]
      })
    ).toEqual(
      expect.arrayContaining([
        "Conflict conflict-1 requires at least two distinct positions",
        "Resolved conflict conflict-1 requires resolution_ref",
        "Resolved conflict conflict-1 requires resolved_at"
      ])
    );
  });

  it("rejects cross-project conflict evidence and impossible resolution chronology", () => {
    const subject = node("entity-1", { kind: "Entity" });
    const left = node("claim-left");
    const foreign = node("claim-foreign", { project_id: "project-2" });
    const decision = node("decision-1", {
      kind: "Decision",
      created_at: t2,
      observed_at: t2
    });
    const conflict: IntelligenceGraphConflict = {
      contract_version: 1,
      conflict_id: "conflict-1",
      owner_id: "owner-1",
      project_id: "project-1",
      scope: "project",
      subject_ref: { id: subject.node_id, version: subject.node_version },
      position_refs: [
        { id: left.node_id, version: left.node_version },
        { id: foreign.node_id, version: foreign.node_version }
      ],
      status: "resolved",
      resolution_ref: { id: decision.node_id, version: decision.node_version },
      created_at: t1,
      resolved_at: t0
    };

    expect(
      validateIntelligenceGraphConflict({
        ownerId: "owner-1",
        projectId: "project-1",
        conflict,
        nodes: [subject, left, foreign, decision]
      })
    ).toEqual(
      expect.arrayContaining([
        "Conflict conflict-1 position claim-foreign@1 crosses a scope boundary",
        "Conflict conflict-1 cannot resolve before it was created",
        "Conflict conflict-1 resolution was created after resolved_at"
      ])
    );
  });

  it("schema rejects corrupted versions, untyped edge names and extra properties", () => {
    const validNode = node("claim-1");
    const validSource = node("source-1", { kind: "Source" });
    const validEdge = edge("edge-1", validNode, validSource);

    expect(Value.Check(IntelligenceGraphNodeSchema, validNode)).toBe(true);
    expect(Value.Check(IntelligenceGraphEdgeSchema, validEdge)).toBe(true);

    expect(Value.Check(IntelligenceGraphNodeSchema, { ...validNode, node_version: 0 })).toBe(false);
    expect(Value.Check(IntelligenceGraphNodeSchema, { ...validNode, unexpected: true })).toBe(false);
    expect(Value.Check(IntelligenceGraphEdgeSchema, { ...validEdge, type: "supported by" })).toBe(
      false
    );
  });
});
