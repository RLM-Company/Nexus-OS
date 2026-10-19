import { describe, expect, it } from "vitest";
import type { IntelligenceGraphSummary } from "@cosmora/contracts";
import { mergeGraphSummaryPages } from "./library-pages";
const row = (id: string, revision = 1): IntelligenceGraphSummary => ({
  graph_id: id,
  title: id,
  revision,
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z"
});
describe("graph library page merging", () => {
  it("deduplicates page boundaries and accepts newer metadata without changing source arrays", () => {
    const before = [row("a"), row("b")],
      incoming = [row("b", 2), row("c")];
    const combined = mergeGraphSummaryPages(before, incoming);
    expect(combined.map((r) => r.graph_id)).toEqual(["a", "b", "c"]);
    expect(combined[1]?.revision).toBe(2);
    expect(before[1]?.revision).toBe(1);
    expect(incoming).toHaveLength(2);
  });
  it("does not downgrade newer metadata when an older page is received", () => {
    expect(mergeGraphSummaryPages([row("b", 3)], [row("b", 2)])[0]?.revision).toBe(3);
    expect(mergeGraphSummaryPages([], [])).toEqual([]);
  });
});
