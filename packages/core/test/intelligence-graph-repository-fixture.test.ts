import { describe, expect, it } from "vitest";
import { compileAuthorizedIntelligenceGraphFixture, IntelligenceGraphIndex } from "../src/index.js";
import { cosmoraRepositoryIntelligenceGraphFixture } from "./fixtures/cosmora-repository-intelligence-graph.js";

const index = () => {
  const compiled = compileAuthorizedIntelligenceGraphFixture(
    cosmoraRepositoryIntelligenceGraphFixture()
  );
  return new IntelligenceGraphIndex({
    ownerId: "owner-cosmora",
    projectId: "project-nexus-os",
    ...compiled
  });
};

describe("repository-grounded Cosmora Intelligence Graph fixture", () => {
  it("builds a verified graph from current repository evidence", () => {
    const compiled = compileAuthorizedIntelligenceGraphFixture(
      cosmoraRepositoryIntelligenceGraphFixture()
    );

    expect(compiled.nodes.length).toBeGreaterThanOrEqual(10);
    expect(compiled.edges.length).toBeGreaterThanOrEqual(7);
  });

  it("connects Model Registry authority to Router hard-filter evidence", () => {
    const packet = index().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "model registry routing authority",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 8, max_edges: 8 }
    });

    expect(packet.sufficient_evidence).toBe(true);
    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining(["decision-model-registry-authority", "claim-router-hard-filters"])
    );
  });

  it("surfaces the documented Manager boundary conflict instead of silently choosing a side", () => {
    const packet = index().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "manager runtime task graphs",
      mode: "local",
      budget: { max_nodes: 6, max_edges: 6, max_fan_out: 4 }
    });

    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining([
        "claim-main-durable-manager-runtime",
        "claim-readme-manager-no-runtime"
      ])
    );
    expect(packet.unresolved_node_ids).toContain("claim-readme-manager-no-runtime");
    expect(packet.edges.some((edge) => edge.type === "CONTRADICTS")).toBe(true);
  });

  it("links project-memory isolation to context and training boundaries", () => {
    const packet = index().query({
      owner_id: "owner-cosmora",
      project_id: "project-nexus-os",
      text: "project memory isolated agents",
      mode: "multi_hop",
      verified_only: true,
      budget: { max_depth: 2, max_nodes: 8, max_edges: 8 }
    });

    expect(packet.nodes.map(({ node }) => node.node_id)).toEqual(
      expect.arrayContaining([
        "claim-project-memory-isolated",
        "claim-project-context-preview",
        "decision-no-automatic-training"
      ])
    );
  });
});
