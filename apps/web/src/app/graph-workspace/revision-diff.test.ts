import { describe, expect, it } from "vitest";
import { compareGraphRevisions, type GraphForComparison } from "./revision-diff";
const graph = (): GraphForComparison => ({
  title: "История",
  nodes: [
    { node_id: "a", node_version: 1, kind: "Claim", verification_status: "discovered" },
    { node_id: "b", node_version: 1, kind: "Source", verification_status: "discovered" }
  ],
  edges: [
    {
      edge_id: "link",
      edge_version: 1,
      type: "REFERENCES",
      from: { id: "a", version: 1 },
      to: { id: "b", version: 1 },
      verification_status: "discovered"
    }
  ],
  records: [
    { node: { id: "a", version: 1 }, text: "Тезис", excerpt: "Строка\r\n" },
    { node: { id: "b", version: 1 }, text: "Источник", excerpt: "<script> $&" }
  ]
});
describe("graph restore comparison", () => {
  it("leaves inputs untouched, ignores order and detects exact text changes", () => {
    const before = graph(),
      after = graph();
    after.nodes.reverse();
    expect(compareGraphRevisions(before, after)).toEqual([]);
    after.records[0]!.excerpt = "Строка\n";
    expect(compareGraphRevisions(before, after)).toEqual([
      expect.objectContaining({ kind: "node", id: "a" })
    ]);
    expect(before.records[0]!.excerpt).toBe("Строка\r\n");
  });
  it("reports rename, removed endpoints, added nodes and changed edge versions", () => {
    const before = graph(),
      after = graph();
    after.title = "Новое";
    after.nodes[0]!.verification_status = "deleted";
    after.edges[0]!.verification_status = "deleted";
    const changes = compareGraphRevisions(before, after);
    expect(changes.map((x) => x.kind)).toEqual(["title", "node", "edge"]);
    expect(changes[1]?.after).toBeNull();
    expect(compareGraphRevisions(after, before)[1]?.before).toBeNull();
    const revised = graph();
    revised.edges[0]!.edge_version = 2;
    expect(compareGraphRevisions(before, revised)[0]?.kind).toBe("edge");
  });
  it("renders HTML as literal data and ignores superseded records", () => {
    const before = graph(),
      after = graph();
    after.records[1]!.excerpt = "<img src=x>";
    const result = compareGraphRevisions(before, after);
    expect(result[0]?.after).toContain("<img src=x>");
    after.nodes.push({ ...after.nodes[0]!, node_version: 0, verification_status: "superseded" });
    expect(compareGraphRevisions(before, after)).toEqual(result);
  });
});
