import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphIndex, type IntelligenceGraphSearchRecord } from "../src/index.js";

const t0 = "2026-09-01T00:00:00.000Z";
const t1 = "2026-09-10T23:59:59.000Z";
const t2 = "2026-09-11T00:00:00.000Z";
const t3 = "2026-09-12T00:00:00.000Z";

const makeNode = (
  id: string,
  kind: IntelligenceGraphNode["kind"],
  overrides: Partial<IntelligenceGraphNode> = {}
): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: id,
  node_version: 1,
  kind,
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t0,
  observed_at: t0,
  valid_from: t0,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: "source-decision-log",
    source_version: 1,
    location: `fixture:${id}`
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

const makeEdge = (
  id: string,
  type: string,
  from: IntelligenceGraphNode,
  to: IntelligenceGraphNode,
  overrides: Partial<IntelligenceGraphEdge> = {}
): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: id,
  edge_version: 1,
  type,
  from: { id: from.node_id, version: from.node_version },
  to: { id: to.node_id, version: to.node_version },
  owner_id: "owner-1",
  project_id: "project-1",
  scope: "project",
  created_at: t0,
  observed_at: t0,
  valid_from: t0,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: "source-decision-log",
    source_version: 1,
    location: `fixture-edge:${id}`
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "fixture-v1",
  supersedes: null,
  deleted_at: null,
  ...overrides
});

const fixture = () => {
  const source = makeNode("source-decision-log", "Source");
  const document = makeNode("document-architecture-log", "Document");
  const goal = makeNode("goal-safe-alpha", "Goal");

  const oldStorage = makeNode("claim-storage", "Claim", {
    node_version: 1,
    verification_status: "superseded",
    valid_to: t1
  });
  const currentStorage = makeNode("claim-storage", "Claim", {
    node_version: 2,
    created_at: t2,
    observed_at: t2,
    valid_from: t2,
    supersedes: { id: "claim-storage", version: 1 }
  });

  const decision = makeNode("decision-storage", "Decision", {
    created_at: t2,
    observed_at: t2,
    valid_from: t2
  });
  const artifact = makeNode("artifact-manager-runtime", "Artifact", {
    created_at: t3,
    observed_at: t3,
    valid_from: t3
  });
  const unresolved = makeNode("claim-cost-risk", "Claim", {
    verification_status: "hypothesis",
    provenance_kind: "model_inference",
    confidence_method: "model_only",
    created_at: t3,
    observed_at: t3,
    valid_from: t3
  });

  const nodes = [
    source,
    document,
    goal,
    oldStorage,
    currentStorage,
    decision,
    artifact,
    unresolved
  ];

  const edges = [
    makeEdge("edge-source-document", "CONTAINS", source, document),
    makeEdge("edge-goal-decision", "GUIDED", goal, decision, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-old-storage-source", "SUPPORTED_BY", oldStorage, source, {
      valid_to: t1
    }),
    makeEdge("edge-current-storage-source", "SUPPORTED_BY", currentStorage, source, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-decision-storage", "BASED_ON", decision, currentStorage, {
      created_at: t2,
      observed_at: t2,
      valid_from: t2
    }),
    makeEdge("edge-artifact-decision", "IMPLEMENTS", artifact, decision, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3
    }),
    makeEdge("edge-risk-decision", "QUESTIONS", unresolved, decision, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3,
      verification_status: "hypothesis",
      provenance_kind: "model_inference",
      confidence_method: "model_only"
    }),
    makeEdge("edge-cycle-back", "RELATES_TO", source, artifact, {
      created_at: t3,
      observed_at: t3,
      valid_from: t3
    })
  ];

  const records: IntelligenceGraphSearchRecord[] = [
    {
      node: { id: source.node_id, version: source.node_version },
      text: "primary architecture decision log source",
      excerpt: "Decision log containing the evidence used by the architecture decision.",
      estimated_tokens: 24
    },
    {
      node: { id: document.node_id, version: document.node_version },
      text: "architecture log document",
      excerpt: "Versioned architecture log document.",
      estimated_tokens: 12
    },
    {
      node: { id: goal.node_id, version: goal.node_version },
      text: "safe local alpha goal",
      excerpt: "Keep the first alpha bounded and recoverable.",
      estimated_tokens: 16
    },
    {
      node: { id: oldStorage.node_id, version: oldStorage.node_version },
      text: "storage architecture choice in memory for early prototype",
      excerpt: "Earlier storage choice used an in-memory prototype.",
      estimated_tokens: 18
    },
    {
      node: { id: currentStorage.node_id, version: currentStorage.node_version },
      text: "storage architecture choice sqlite durable project state",
      excerpt: "The project moved to SQLite-backed durable state.",
      estimated_tokens: 18
    },
    {
      node: { id: decision.node_id, version: decision.node_version },
      text: "architecture decision selected durable storage",
      excerpt: "The storage decision selected durable project state.",
      estimated_tokens: 20
    },
    {
      node: { id: artifact.node_id, version: artifact.node_version },
      text: "manager runtime implementation artifact",
      excerpt: "The Manager runtime artifact implements the selected storage decision.",
      estimated_tokens: 22
    },
    {
      node: { id: unresolved.node_id, version: unresolved.node_version },
      text: "cost risk graph indexing hypothesis",
      excerpt: "A model-only hypothesis raises an unverified graph-indexing cost risk.",
      estimated_tokens: 22
    }
  ];

  return { nodes, edges, records };
};

const createIndex = () => {
  const data = fixture();
  return new IntelligenceGraphIndex({
    ownerId: "owner-1",
    projectId: "project-1",
    ...data
  });
};

describe("Intelligence Graph retrieval", () => {
  it("keeps baseline retrieval narrow and deterministic", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(["artifact-manager-runtime"]);
    expect(packet.edges).toEqual([]);
    expect(packet.paths).toHaveLength(1);
  });

  it("local retrieval adds only the first graph neighborhood", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "local",
      verified_only: true,
      budget: { max_depth: 4 }
    });

    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining([
        "artifact-manager-runtime",
        "decision-storage",
        "source-decision-log"
      ])
    );
    expect(packet.nodes.some(({ node }) => node.node_id === "claim-storage")).toBe(false);
  });

  it("multi-hop retrieval reconstructs a bounded evidence path", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 3, max_nodes: 8, max_edges: 8, max_fan_out: 4 }
    });

    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toEqual(
      expect.arrayContaining([
        "artifact-manager-runtime@1",
        "decision-storage@1",
        "claim-storage@2",
        "source-decision-log@1"
      ])
    );
    expect(
      packet.paths.some(
        (path) =>
          path.target.id === "claim-storage" &&
          path.edges.some((edgeRef) => edgeRef.id === "edge-decision-storage")
      )
    ).toBe(true);
    expect(packet.budget.visited_nodes).toBeLessThanOrEqual(8);
    expect(packet.budget.returned_edges).toBeLessThanOrEqual(8);
  });

  it("terminates on cycles and marks a fan-out-limited result as truncated", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "primary architecture decision log source",
      mode: "multi_hop",
      verified_only: true,
      budget: {
        max_depth: 6,
        max_nodes: 8,
        max_edges: 8,
        max_fan_out: 1,
        max_context_tokens: 1_000
      }
    });

    expect(packet.budget.visited_nodes).toBeLessThanOrEqual(8);
    expect(packet.budget.truncated).toBe(true);
  });

  it("retrieves the historically valid superseded version for an as-of query", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice",
      mode: "temporal",
      as_of: "2026-09-05T00:00:00.000Z",
      verified_only: true,
      budget: { max_depth: 1 }
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toContain(
      "claim-storage@1"
    );
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).not.toContain(
      "claim-storage@2"
    );
  });

  it("uses the current version for non-temporal retrieval", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "storage architecture choice",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).toContain(
      "claim-storage@2"
    );
    expect(packet.nodes.map(({ node }) => `${node.node_id}@${node.node_version}`)).not.toContain(
      "claim-storage@1"
    );
  });

  it("reports insufficient evidence for a model-only hypothesis", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "cost risk graph indexing",
      mode: "baseline"
    });

    expect(packet.sufficient_evidence).toBe(false);
    expect(packet.unresolved_node_ids).toEqual(["claim-cost-risk"]);
  });

  it("verified-only mode refuses to return a model-only hypothesis", () => {
    const packet = createIndex().query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "cost risk graph indexing",
      mode: "baseline",
      verified_only: true
    });

    expect(packet.sufficient_evidence).toBe(false);
    expect(packet.nodes).toEqual([]);
  });

  it("fails closed when query scope does not match the index", () => {
    expect(() =>
      createIndex().query({
        owner_id: "owner-1",
        project_id: "project-2",
        text: "manager runtime implementation artifact",
        mode: "baseline"
      })
    ).toThrow("query scope does not match");
  });

  it("rejects graph construction with cross-project data", () => {
    const data = fixture();
    const foreign = {
      ...data.nodes[0]!,
      node_id: "foreign-source",
      project_id: "project-2"
    };

    expect(
      () =>
        new IntelligenceGraphIndex({
          ownerId: "owner-1",
          projectId: "project-1",
          nodes: [...data.nodes, foreign],
          edges: data.edges,
          records: data.records
        })
    ).toThrow("belongs to another project");
  });

  it("enforces hard traversal and token budgets", () => {
    const index = createIndex();

    expect(() =>
      index.query({
        owner_id: "owner-1",
        project_id: "project-1",
        text: "manager runtime implementation artifact",
        mode: "multi_hop",
        budget: { max_depth: 7 }
      })
    ).toThrow("max_depth");

    const packet = index.query({
      owner_id: "owner-1",
      project_id: "project-1",
      text: "manager runtime implementation artifact",
      mode: "multi_hop",
      budget: { max_context_tokens: 22, max_depth: 3 }
    });

    expect(packet.budget.estimated_context_tokens).toBeLessThanOrEqual(22);
    expect(packet.budget.truncated).toBe(true);
  });
});
