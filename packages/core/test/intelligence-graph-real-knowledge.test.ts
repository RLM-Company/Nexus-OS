import { describe, expect, it } from "vitest";
import {
  compileAuthorizedIntelligenceGraphFixture,
  IntelligenceGraphIndex
} from "../src/index.js";
import { cosmoraRealKnowledgeGraphFixture } from "./fixtures/cosmora-real-knowledge-graph.js";

const compile = () => compileAuthorizedIntelligenceGraphFixture(cosmoraRealKnowledgeGraphFixture());

const createIndex = () => {
  const compiled = compile();
  return new IntelligenceGraphIndex({
    ownerId: "owner-cosmora",
    projectId: "project-nexus-os",
    ...compiled
  });
};

describe("evidence-grounded Cosmora knowledge graph", () => {
  it("compiles a connected repository graph with real evidence locations", () => {
    const compiled = compile();

    expect(compiled.nodes).toHaveLength(70);
    expect(compiled.edges).toHaveLength(94);

    const degree = new Map<string, number>();
    for (const edge of compiled.edges) {
      degree.set(edge.from.id, (degree.get(edge.from.id) ?? 0) + 1);
      degree.set(edge.to.id, (degree.get(edge.to.id) ?? 0) + 1);
      expect(edge.evidence_ref.location).not.toMatch(/^fixture:/);
      expect(edge.project_id).toBe("project-nexus-os");
      expect(edge.owner_id).toBe("owner-cosmora");
    }

    for (const node of compiled.nodes) {
      expect(node.source_ref.location).not.toMatch(/^fixture:/);
      if (node.kind !== "Source") {
        expect(degree.get(node.node_id) ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("answers why Manager publication cannot bypass policy", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "Manager publish files requires workspace write capability Policy Engine",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 10, max_edges: 12, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claim-manager-publish-workspace-write",
        "entity-policy-engine",
        "artifact-manager-work-runtime"
      ])
    );
    expect(packet.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(["REQUIRES", "CONSTRAINS"])
    );
    expect(packet.sufficient_evidence).toBe(true);
  });

  it("answers why delegated agents cannot gain broader authority", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "delegation never expands tools data budget permission authority",
      mode: "local",
      verified_only: true,
      budget: { max_nodes: 8, max_edges: 8, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "decision-delegation-no-expansion",
        "entity-agent-instance",
        "entity-policy-engine"
      ])
    );
    expect(packet.edges.some((edge) => edge.type === "ENFORCED_BY")).toBe(true);
  });

  it("keeps browser Project Context distinct from authoritative runtime context", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "browser local Project Context selection is not authoritative runtime model context",
      mode: "local",
      verified_only: true,
      budget: { max_nodes: 8, max_edges: 8, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claim-context-not-authoritative",
        "entity-project-context-panel",
        "doc-project-context-boundary"
      ])
    );
    expect(packet.edges.some((edge) => edge.type === "CONSTRAINS")).toBe(true);
  });

  it("retrieves model-route freshness and fail-closed constraints together", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "active external model route requires evidence verification valid until",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 3, max_nodes: 14, max_edges: 18, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "decision-route-evidence-freshness",
        "entity-model-registry",
        "entity-router",
        "decision-registry-authority"
      ])
    );
    expect(packet.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(["CONSTRAINS", "SUPPLIES_METADATA_TO", "GOVERNS"])
    );
  });

  it("connects critic review authority to runtime artifacts without granting policy bypass", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "critic role can review but cannot delegate arbitrate or bypass policy",
      mode: "local",
      verified_only: true,
      budget: { max_nodes: 8, max_edges: 8, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claim-critic-role-authority",
        "entity-critic-role",
        "doc-manager-runtime-contract"
      ])
    );
  });

  it("connects authentication evidence to Companion suppression when owner is unauthenticated", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "Companion gate suppresses unauthenticated quiet hours safety",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 12, max_edges: 14, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claim-companion-gate-reasons",
        "entity-companion-gate",
        "entity-auth-flow"
      ])
    );
    expect(packet.edges.some((edge) => edge.type === "DEPENDS_ON")).toBe(true);
  });

  it("connects architecture decisions to the commits that implemented them", () => {
    const compiled = compile();
    const pairs = new Set(
      compiled.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`)
    );

    expect(pairs).toContain(
      "decision-registry-authority|IMPLEMENTED_BY|event-registry-foundation"
    );
    expect(pairs).toContain(
      "decision-route-evidence-freshness|IMPLEMENTED_BY|event-registry-failclosed"
    );
    expect(pairs).toContain(
      "decision-agent-six-parts|IMPLEMENTED_BY|event-agent-contracts"
    );
    expect(pairs).toContain(
      "claim-auth-google-telegram|IMPLEMENTED_BY|event-auth-contract"
    );
    expect(pairs).toContain(
      "claim-companion-preference-bounds|IMPLEMENTED_BY|event-companion-contract"
    );
    expect(pairs).toContain(
      "event-manager-runtime|PRODUCES|artifact-manager-work-runtime"
    );
  });

  it("uses implementation timestamps for historical graph queries", () => {
    const packet = createIndex().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "commit versioned model registry router",
      mode: "temporal",
      as_of: "2026-08-25T00:00:00.000Z",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 10, max_edges: 10, max_fan_out: 8 }
    });

    const ids = packet.nodes.map(({ node }) => node.node_id);
    expect(ids).toContain("event-registry-foundation");
    expect(ids).not.toContain("event-registry-runtime");
    expect(ids).not.toContain("event-registry-failclosed");
  });

  it("preserves explicit provenance and recovery constraints as graph structure", () => {
    const compiled = compile();
    const pairs = new Set(
      compiled.edges.map((edge) => `${edge.from.id}|${edge.type}|${edge.to.id}`)
    );

    expect(pairs).toContain(
      "claim-runtime-provenance-acyclic|CONSTRAINS|entity-runtime-artifact"
    );
    expect(pairs).toContain(
      "entity-runtime-checkpoint|BOUND_TO|entity-runtime-task-graph"
    );
    expect(pairs).toContain(
      "claim-conflict-needs-resolution-artifact|CONSTRAINS|entity-agent-conflict"
    );
    expect(pairs).toContain(
      "entity-manager-role|ARBITRATES|entity-agent-conflict"
    );
  });
});
