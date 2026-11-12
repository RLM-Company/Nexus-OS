import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { buildSourceUsages, filterSourceUsage } from "./source-usage";
import { SourceUsagePanel } from "./source-usage-panel";
import { sourceUsageExport, sourceUsageCsv } from "./source-usage-export";
import { parseCsv } from "../studio-csv";

const fixture = (): IntelligenceGraphEvidenceAudit => {
  const cited = (edgeId: string, source: string, version: number, historical: boolean) => ({
    ref: { id: edgeId, version: 7 },
    from: { id: "from", version: 2 },
    from_label: "Начало",
    status: "discovered",
    citation: {
      source: { id: source, version },
      label: "Одинаковое название <script>",
      status: historical ? "superseded" : "discovered",
      location: "строка 1",
      quote: "🙂\r\n<script> $&",
      historical
    }
  });
  return {
    format: "kosmora.graph-evidence-audit.v1",
    usage: "Наличие ссылок не подтверждает достоверность.",
    graph: { id: "g", revision: 20, title: "Граф", updated_at: "2026-10-26T00:00:00Z" },
    statistics: {
      claims: 3,
      with_current_citations: 2,
      with_historical_citations_only: 0,
      without_citations: 1,
      support_links: 5,
      uncited_support_links: 1,
      historical_citations: 1
    },
    claims: [
      {
        ref: { id: "a", version: 1 },
        label: "Первая",
        status: "discovered",
        coverage: "current_citation",
        supports: [
          cited("old", "s", 1, true),
          cited("new", "s", 3, false),
          cited("other", "foreign", 3, false)
        ]
      },
      {
        ref: { id: "b", version: 4 },
        label: "Вторая",
        status: "disputed",
        coverage: "current_citation",
        supports: [cited("another", "s", 3, false)]
      },
      {
        ref: { id: "c", version: 1 },
        label: "Без цитат",
        status: "discovered",
        coverage: "no_citation",
        supports: [
          {
            ref: { id: "bare", version: 1 },
            from: { id: "from", version: 2 },
            from_label: "Начало",
            status: "discovered",
            citation: null
          }
        ]
      }
    ]
  };
};
describe("source citation usage", () => {
  it("groups by source identity, preserving exact versions/quotes and counting distinct claims", () => {
    const report = fixture(),
      before = structuredClone(report);
    const sources = buildSourceUsages(report);
    expect(sources).toHaveLength(2);
    const source = sources.find((s) => s.id === "s")!;
    expect(source.counts).toEqual({
      claims: 2,
      citations: 3,
      current_citations: 2,
      historical_citations: 1
    });
    expect(source.versions.map((v) => [v.ref.version, v.citations])).toEqual([
      [1, 1],
      [3, 2]
    ]);
    expect(source.claims[0]!.supports[0]!.citation.quote).toBe("🙂\r\n<script> $&");
    expect(sources.find((s) => s.id === "foreign")!.counts.claims).toBe(1);
    expect(source.claims.map((c) => c.ref)).toEqual([
      { id: "a", version: 1 },
      { id: "b", version: 4 }
    ]);
    expect(report).toEqual(before);
  });
  it("filters historical and current versions without treating claims with other current citations as absent", () => {
    const source = buildSourceUsages(fixture()).find((s) => s.id === "s")!;
    const old = filterSourceUsage(source, 1),
      current = filterSourceUsage(source, 3);
    expect(old.counts).toEqual({
      claims: 1,
      citations: 1,
      current_citations: 0,
      historical_citations: 1
    });
    expect(old.claims[0]!.supports.map((s) => s.ref.id)).toEqual(["old"]);
    expect(current.counts).toEqual({
      claims: 2,
      citations: 2,
      current_citations: 2,
      historical_citations: 0
    });
    expect(filterSourceUsage(source, null)).toEqual(source);
    expect(source.counts.citations).toBe(3);
    expect(() => filterSourceUsage(source, 2)).toThrow("цитируемую");
    expect(() => filterSourceUsage(source, Number.NaN)).toThrow();
  });
  it("uses the last cited version's label and produces a deterministic order", () => {
    const report = fixture();
    report.claims[0]!.supports[1]!.citation!.label = "Новое имя";
    report.claims[1]!.supports[0]!.citation!.label = "Новое имя";
    const sources = buildSourceUsages(report);
    report.claims.reverse();
    report.claims.forEach((c) => c.supports.reverse());
    expect(buildSourceUsages(report)).toEqual(sources);
    expect(sources.find((s) => s.id === "s")!.label).toBe("Новое имя");
  });
  it("does not invent dependencies for uncited links or an empty revision", () => {
    const report = fixture();
    report.claims = report.claims.slice(2);
    expect(buildSourceUsages(report)).toEqual([]);
    const html = renderToStaticMarkup(
      <SourceUsagePanel report={report} auditSha256={"a".repeat(64)} />
    );
    expect(html).toContain("нет источников с цитатами");
    expect(html).not.toContain("<select");
  });
  it("renders same-title sources as separate identities with escaped labels and no selection assumed", () => {
    const html = renderToStaticMarkup(
      <SourceUsagePanel report={fixture()} auditSha256={"a".repeat(64)} />
    );
    expect(html).toContain('value="s"');
    expect(html).toContain('value="foreign"');
    expect(html).toContain("Одинаковое название &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Использование выбранного источника");
  });
  it("exports only the selected source/version with exact quote bytes and a backlink to the full audit", () => {
    const report = fixture(),
      before = structuredClone(report),
      hash = "d".repeat(64);
    const value = sourceUsageExport(report, hash, "s", 1);
    expect(value.format).toBe("kosmora.graph-source-usage.v1");
    expect(value.graph).toEqual(report.graph);
    expect(value.scope).toEqual({ source_id: "s", source_version: 1 });
    expect(value.audit).toEqual({ format: report.format, sha256: hash });
    expect(value.source.counts).toEqual({
      claims: 1,
      citations: 1,
      current_citations: 0,
      historical_citations: 1
    });
    expect(value.source.claims[0]!.supports[0]!.citation.quote).toBe("🙂\r\n<script> $&");
    expect(JSON.stringify(value)).not.toContain('"foreign"');
    expect(report).toEqual(before);
    expect(sourceUsageExport(report, hash, "s", null).source.counts.citations).toBe(3);
  });
  it("exports a row per citation with revision, exact references, selection scope and audit hash", () => {
    const value = sourceUsageExport(fixture(), "a".repeat(64), "s", 3);
    const table = parseCsv(sourceUsageCsv(value));
    const col = (name: string) => table.headers.indexOf(name);
    expect(table.rows).toHaveLength(2);
    for (const row of table.rows) {
      expect(row[col("Ревизия")]).toBe("20");
      expect(row[col("Источник ID")]).toBe("s");
      expect(row[col("Версия источника")]).toBe("3");
      expect(row[col("Фильтр версии источника")]).toBe("3");
      expect(row[col("Цитата")]).toBe("🙂\r\n<script> $&");
      expect(row[col("SHA-256 полной проверки")]).toBe("a".repeat(64));
    }
    expect(table.rows.map((row) => row[col("Связь ID")])).toEqual(["new", "another"]);
  });
  it("protects formula fields in CSV while leaving the JSON literal text unchanged", () => {
    const report = fixture();
    report.graph.title = "=SUM(1,2)";
    report.claims[0]!.supports[0]!.citation!.quote = "\r\n@SUM(1,2)";
    report.claims[0]!.label = "\u200b＋SUM(1,2)";
    const value = sourceUsageExport(report, "a".repeat(64), "s", 1),
      before = JSON.stringify(value);
    const csv = sourceUsageCsv(value),
      table = parseCsv(csv);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(table.rows[0]![table.headers.indexOf("Название графа")]).toBe("'=SUM(1,2)");
    expect(table.rows[0]![table.headers.indexOf("Цитата")]).toBe("'\r\n@SUM(1,2)");
    expect(table.rows[0]![table.headers.indexOf("Утверждение")]).toBe("'\u200b＋SUM(1,2)");
    expect(JSON.stringify(value)).toBe(before);
  });
  it("refuses an unknown source/version or unavailable audit hash instead of exporting a broader scope", () => {
    expect(() => sourceUsageExport(fixture(), "a".repeat(64), "missing", null)).toThrow(
      "отсутствует"
    );
    expect(() => sourceUsageExport(fixture(), "a".repeat(64), "s", 99)).toThrow("цитируемую");
    expect(() => sourceUsageExport(fixture(), "", "s", null)).toThrow("Контрольная сумма");
  });
});
