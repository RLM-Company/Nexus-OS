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

it("shows exact quote and source changes before restoring a graph revision", () => {
  const before = graph(),
    after = graph();
  after.edges[0]!.evidence_ref = { source_id: "b", source_version: 1, location: "страница 4" };
  after.edges[0]!.evidence_excerpt = "<b> Точная\r\nцитата $&";
  const changes = compareGraphRevisions(before, after);
  expect(changes).toHaveLength(1);
  expect(changes[0]?.after).toContain("<b> Точная\r\nцитата $&");
  expect(changes[0]?.after).toContain("страница 4");
});

it("compares exact conflict positions, resolution and reopening without reordering noise", () => {
  const before = graph(),
    after = graph();
  const conflict = {
    conflict_id: "c",
    subject_ref: { id: "b", version: 1 },
    position_refs: [
      { id: "a", version: 1 },
      { id: "c", version: 1 }
    ],
    status: "open" as const,
    resolution_ref: null,
    created_at: "2026-10-19T00:00:00Z",
    resolved_at: null
  };
  before.conflicts = [structuredClone(conflict)];
  after.conflicts = [structuredClone(conflict)];
  after.conflicts[0]!.position_refs.reverse();
  expect(compareGraphRevisions(before, after)).toEqual([]);
  after.conflicts[0]!.status = "resolved";
  after.conflicts[0]!.resolution_ref = { id: "d", version: 2 };
  after.conflicts[0]!.resolved_at = "2026-10-19T01:00:00Z";
  const changes = compareGraphRevisions(before, after);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.kind).toBe("conflict");
  expect(changes[0]!.after).toContain("d@2");
  expect(compareGraphRevisions(after, before)[0]!.after).toContain("open");
  after.conflicts[0]!.position_refs[0]!.version = 3;
  expect(compareGraphRevisions(before, after)[0]!.after).toContain("c@3");
});
