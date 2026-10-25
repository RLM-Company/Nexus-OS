import { describe, expect, it } from "vitest";
import type { GraphForComparison } from "./revision-diff";
import { layoutGraph } from "./graph-layout";
const graph = (): GraphForComparison => ({
  title: "Graph",
  nodes: ["a", "b", "c", "isolated"].map((id) => ({
    node_id: id,
    node_version: 1,
    kind: "Claim",
    verification_status: "discovered"
  })),
  edges: [
    {
      edge_id: "ab",
      edge_version: 1,
      type: "SUPPORTS",
      from: { id: "a", version: 1 },
      to: { id: "b", version: 1 },
      verification_status: "discovered"
    },
    {
      edge_id: "bc",
      edge_version: 1,
      type: "CONTRADICTS",
      from: { id: "b", version: 1 },
      to: { id: "c", version: 1 },
      verification_status: "discovered"
    }
  ],
  records: [{ node: { id: "a", version: 1 }, text: "<b> Тезис $&", excerpt: "Точный\r\nтекст" }]
});
describe("bounded graph navigation", () => {
  it("lays out the actual graph deterministically without modifying or inventing edges", () => {
    const input = graph(),
      before = structuredClone(input),
      first = layoutGraph(input, null, false);
    expect(first).toEqual(layoutGraph(input, null, false));
    expect(input).toEqual(before);
    expect(first.nodes).toHaveLength(4);
    expect(first.edges).toEqual(input.edges);
    expect(first.nodes[0]?.label).toBe("<b> Тезис $&");
    expect(
      first.nodes.every(
        (n) =>
          Number.isFinite(n.x) &&
          Number.isFinite(n.y) &&
          n.x >= 0 &&
          n.x <= 1000 &&
          n.y >= 0 &&
          n.y <= 680
      )
    ).toBe(true);
  });
  it("includes incoming and outgoing immediate neighbours, excluding distant nodes", () => {
    const input = graph();
    const view = layoutGraph(input, "b", true);
    expect(view.nodes.map((n) => n.node_id)).toEqual(["a", "b", "c"]);
    expect(view.neighbours).toEqual(["a", "c"]);
    expect(view.omitted).toBe(1);
    const selected = view.nodes.find((n) => n.node_id === "b")!;
    expect([selected.x, selected.y]).toEqual([500, 340]);
    const one = layoutGraph(input, "a", true);
    expect(one.nodes.map((n) => n.node_id)).toEqual(["a", "b"]);
    expect(one.edges.map((e) => e.edge_id)).toEqual(["ab"]);
  });
  it("does not draw deleted/superseded nodes, edges or mismatched endpoint versions", () => {
    const input = graph();
    input.nodes[0]!.verification_status = "deleted";
    input.edges[1]!.from.version = 99;
    expect(layoutGraph(input, null, false).edges).toEqual([]);
    input.nodes[1]!.verification_status = "superseded";
    expect(layoutGraph(input, null, false).nodes.map((n) => n.node_id)).toEqual(["c", "isolated"]);
  });
  it("retains isolated nodes and handles empty and missing-record graphs", () => {
    const input = graph();
    expect(layoutGraph(input, "isolated", true).nodes).toHaveLength(1);
    expect(layoutGraph(input, "isolated", true).edges).toEqual([]);
    expect(layoutGraph({ ...input, nodes: [], edges: [], records: [] }, null, false).nodes).toEqual(
      []
    );
    expect(layoutGraph(input, "b", true).nodes.find((n) => n.node_id === "b")?.label).toBe("b");
  });
});

describe("recorded navigation paths and structural diagnostics", () => {
  it("finds shortest directed paths without inventing transitive relationships", async () => {
    const { findGraphNavigationPath } = await import("./graph-layout");
    const input = graph(),
      before = structuredClone(input);
    const path = findGraphNavigationPath(input, "a", "c", "outgoing");
    expect(path?.nodes).toEqual(["a", "b", "c"]);
    expect(path?.steps.map((s) => s.edge.edge_id)).toEqual(["ab", "bc"]);
    expect(path?.steps.every((s) => !s.backwards)).toBe(true);
    expect(findGraphNavigationPath(input, "a", "c", "outgoing", 1)).toBeNull();
    input.edges.push({ ...input.edges[0]!, edge_id: "direct", to: { id: "c", version: 1 } });
    expect(findGraphNavigationPath(input, "a", "c", "outgoing")?.steps).toHaveLength(1);
    expect(before.edges).toHaveLength(2);
  });
  it("allows explicit backward traversal and rejects absent or inactive endpoints", async () => {
    const { findGraphNavigationPath } = await import("./graph-layout");
    const input = graph();
    expect(findGraphNavigationPath(input, "c", "a", "outgoing")).toBeNull();
    expect(
      findGraphNavigationPath(input, "c", "a", "either")?.steps.every((s) => s.backwards)
    ).toBe(true);
    expect(findGraphNavigationPath(input, "a", "a", "outgoing", 0)?.nodes).toEqual(["a"]);
    expect(findGraphNavigationPath(input, "a", "isolated", "either")).toBeNull();
    input.nodes[0]!.verification_status = "superseded";
    expect(findGraphNavigationPath(input, "a", "b", "either")).toBeNull();
    expect(() => findGraphNavigationPath(input, "b", "c", "either", 7)).toThrow();
  });
  it("reports actual connected components, explicit contradictions and source links", async () => {
    const { inspectGraphStructure } = await import("./graph-layout");
    const input = graph();
    input.nodes[2]!.kind = "Source";
    const report = inspectGraphStructure(input);
    expect(report.components).toEqual([["a", "b", "c"], ["isolated"]]);
    expect(report.isolated).toEqual(["isolated"]);
    expect(report.contradictions.map((e) => e.edge_id)).toEqual(["bc"]);
    expect(report.claimsWithoutSourceLinks).toEqual(["a", "isolated"]);
    expect(report.dependencyCycles).toEqual([]);
  });
  it("finds cyclic dependency groups, separating cycles from plain semantic links", async () => {
    const { inspectGraphStructure } = await import("./graph-layout");
    const input = graph();
    input.edges.forEach((e) => (e.type = "DEPENDS_ON"));
    input.edges.push({
      ...input.edges[0]!,
      edge_id: "ca",
      from: { id: "c", version: 1 },
      to: { id: "a", version: 1 }
    });
    expect(inspectGraphStructure(input).dependencyCycles).toEqual([["a", "b", "c"]]);
    input.edges[2]!.verification_status = "deleted";
    expect(inspectGraphStructure(input).dependencyCycles).toEqual([]);
    expect(
      inspectGraphStructure({ ...input, nodes: [], edges: [], records: [] }).components
    ).toEqual([]);
  });
});
