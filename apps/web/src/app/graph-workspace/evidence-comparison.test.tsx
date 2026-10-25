import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { compareEvidenceAudits } from "./evidence-comparison";
import { EvidenceComparisonPanel, EvidenceComparisonReading } from "./evidence-comparison-panel";

const hash = "a".repeat(64);
const fixture = (): IntelligenceGraphEvidenceAudit => ({
  format: "kosmora.graph-evidence-audit.v1",
  usage: "Наличие цитаты не оценивает достоверность.",
  graph: { id: "graph", revision: 1, title: "До", updated_at: "2026-10-26T00:00:00Z" },
  statistics: {
    claims: 2,
    with_current_citations: 1,
    with_historical_citations_only: 0,
    without_citations: 1,
    support_links: 1,
    uncited_support_links: 0,
    historical_citations: 0
  },
  claims: [
    {
      ref: { id: "a", version: 1 },
      label: "Позиция",
      status: "discovered",
      coverage: "current_citation",
      supports: [
        {
          ref: { id: "edge", version: 1 },
          from: { id: "other", version: 1 },
          from_label: "Другая позиция",
          status: "discovered",
          citation: {
            source: { id: "source", version: 1 },
            label: "Источник",
            status: "discovered",
            location: "строка 1",
            quote: "<script>🙂 $&\r\n",
            historical: false
          }
        }
      ]
    },
    {
      ref: { id: "b", version: 1 },
      label: "Без цитат",
      status: "discovered",
      coverage: "no_citation",
      supports: []
    }
  ]
});
const newer = (report = fixture()) => {
  const r = structuredClone(report);
  r.graph.revision = 4;
  return r;
};
describe("comparison of checked evidence audits", () => {
  it("matches claims by stable identity across versions while separating additions, removals and unchanged entries", () => {
    const before = fixture(),
      after = newer();
    before.claims.push({
      ...structuredClone(before.claims[1]!),
      ref: { id: "removed", version: 2 }
    });
    after.claims.push({ ...structuredClone(after.claims[1]!), ref: { id: "added", version: 1 } });
    after.claims[0]!.ref.version = 4;
    after.claims[0]!.label = "Новая позиция";
    const snapshots = [structuredClone(before), structuredClone(after)];
    const result = compareEvidenceAudits(before, hash, after, "b".repeat(64));
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(result.changes.map((c) => [c.id, c.kind])).toEqual([
      ["a", "changed"],
      ["added", "added"],
      ["removed", "removed"]
    ]);
    expect(result.changes[0]!.before!.ref.version).toBe(1);
    expect(result.changes[0]!.after!.ref.version).toBe(4);
    expect(result.before.audit_sha256).toBe(hash);
    expect(result.after.audit_sha256).toBe("b".repeat(64));
    expect([before, after]).toEqual(snapshots);
  });
  it("detects historical source transitions and literal quote/location changes even when claim versions are unchanged", () => {
    const before = fixture(),
      after = newer();
    after.claims[0]!.supports[0]!.citation!.historical = true;
    after.claims[0]!.supports[0]!.citation!.status = "superseded";
    after.claims[0]!.coverage = "historical_citation";
    let result = compareEvidenceAudits(before, hash, after, hash);
    expect(result.counts.changed).toBe(1);
    expect(result.changes[0]!.before!.supports[0]!.citation!.quote).toBe("<script>🙂 $&\r\n");
    after.claims[0]!.supports[0]!.citation!.quote = "<script>🙂 $&\n";
    after.claims[0]!.supports[0]!.citation!.location = "строка 2";
    result = compareEvidenceAudits(before, hash, after, hash);
    expect(result.changes[0]!.after!.supports[0]!.citation!.quote).toBe("<script>🙂 $&\n");
  });
  it("ignores presentation order and graph title changes without inventing changed claims", () => {
    const before = fixture();
    before.claims[0]!.supports.push({
      ...structuredClone(before.claims[0]!.supports[0]!),
      ref: { id: "another", version: 1 }
    });
    const after = newer(before);
    after.graph.title = "После";
    after.claims.reverse();
    after.claims.forEach((c) => c.supports.reverse());
    const result = compareEvidenceAudits(before, hash, after, hash);
    expect(result.changes).toEqual([]);
    expect(result.counts.unchanged).toBe(2);
    expect(result.after.graph.title).toBe("После");
  });
  it.each(["foreign", "same_revision", "reversed", "hash", "format", "duplicate"])(
    "rejects inconsistent %s inputs",
    (change) => {
      const before = fixture(),
        after = newer();
      if (change === "foreign") after.graph.id = "foreign";
      if (change === "same_revision") after.graph.revision = 1;
      if (change === "reversed") before.graph.revision = 5;
      if (change === "format") (after as { format: string }).format = "other";
      if (change === "duplicate")
        after.claims.push({ ...after.claims[0]!, ref: { id: "a", version: 7 } });
      expect(() =>
        compareEvidenceAudits(before, change === "hash" ? "" : hash, after, hash)
      ).toThrow();
    }
  );
  it("renders before/after references and quote text literally without marking a changed claim as verified", () => {
    const before = fixture(),
      after = newer();
    after.claims[0]!.label = "Изменённая";
    const html = renderToStaticMarkup(
      <EvidenceComparisonReading comparison={compareEvidenceAudits(before, hash, after, hash)} />
    );
    expect(html).toContain("Ревизии 1 → 4");
    expect(html).toContain("Изменилось: 1");
    expect(html).toContain("&lt;script&gt;🙂 $&amp;\r\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Не проверено");
    expect(html).toContain("source@1");
  });
  it("does not offer a nonexistent baseline for the first revision", () => {
    const html = renderToStaticMarkup(
      <EvidenceComparisonPanel projectId="project" current={{ report: fixture(), sha256: hash }} />
    );
    expect(html).toContain("нет прежней ревизии");
    expect(html).not.toContain("<form");
  });
});
