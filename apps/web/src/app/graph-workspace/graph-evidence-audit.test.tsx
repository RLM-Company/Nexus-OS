import { createHash, webcrypto } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { GraphEvidenceAuditReading } from "./graph-evidence-audit";
import { readEvidenceAudit } from "./read-evidence-audit";
import { evidenceAuditCsv } from "./evidence-audit-csv";
import { parseCsv } from "../studio-csv";

const fixture = (): IntelligenceGraphEvidenceAudit => ({
  format: "kosmora.graph-evidence-audit.v1",
  usage: "Проверка наличия цитат, не достоверности.",
  graph: { id: "g", revision: 2, title: "Проверка", updated_at: "2026-10-25T00:00:00Z" },
  statistics: {
    claims: 3,
    with_current_citations: 1,
    with_historical_citations_only: 1,
    without_citations: 1,
    support_links: 2,
    uncited_support_links: 0,
    historical_citations: 1
  },
  claims: [
    {
      ref: { id: "c1", version: 1 },
      label: "Без цитат",
      status: "discovered",
      coverage: "no_citation",
      supports: []
    },
    {
      ref: { id: "c2", version: 1 },
      label: "Историческая",
      status: "discovered",
      coverage: "historical_citation",
      supports: [
        {
          ref: { id: "e1", version: 1 },
          from: { id: "c1", version: 1 },
          from_label: "Начало",
          status: "discovered",
          citation: {
            source: { id: "s", version: 1 },
            label: "Старый источник",
            status: "superseded",
            location: "строка 1",
            quote: "<script>window.unsafe=true</script>\r\n$&",
            historical: true
          }
        }
      ]
    },
    {
      ref: { id: "c3", version: 1 },
      label: "Есть действующая цитата",
      status: "discovered",
      coverage: "current_citation",
      supports: [
        {
          ref: { id: "e2", version: 1 },
          from: { id: "c1", version: 1 },
          from_label: "Начало",
          status: "discovered",
          citation: {
            source: { id: "s2", version: 1 },
            label: "Источник",
            status: "discovered",
            location: "строка 1",
            quote: "Цитата",
            historical: false
          }
        }
      ]
    }
  ]
});
const digest = (report: IntelligenceGraphEvidenceAudit) =>
  createHash("sha256").update(JSON.stringify(report)).digest("hex");
afterEach(() => vi.unstubAllGlobals());

describe("evidence audit reading", () => {
  it("exports every claim/support with exact source versions and multiline quote cells", () => {
    const report = fixture();
    report.claims[1]!.supports.push(structuredClone(report.claims[2]!.supports[0]!));
    const before = structuredClone(report);
    const csv = evidenceAuditCsv(report);
    const table = parseCsv(csv);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(table.rows).toHaveLength(4);
    const column = (name: string) => table.headers.indexOf(name);
    const historical = table.rows.find((row) => row[column("Источник ID")] === "s")!;
    expect(historical[column("Версия источника")]).toBe("1");
    expect(historical[column("Прежняя версия источника")]).toBe("Да");
    expect(historical[column("Цитата")]).toBe("<script>window.unsafe=true</script>\r\n$&");
    expect(table.rows[0]![column("Связь ID")]).toBe("");
    expect(table.rows.every((row) => row[column("Ревизия")] === "2")).toBe(true);
    expect(table.rows.every((row) => row[column("Назначение отчёта")] === report.usage)).toBe(true);
    expect(report).toEqual(before);
  });
  it("guards formula-like spreadsheet fields including invisible prefixes without changing JSON", () => {
    const report = fixture();
    report.graph.title = '=HYPERLINK("https://invalid.example","name")';
    report.claims[0]!.label = "\u200b＋SUM(1,2)";
    report.claims[1]!.supports[0]!.citation!.quote = "\r\n@SUM(1,2)";
    const before = JSON.stringify(report);
    const table = parseCsv(evidenceAuditCsv(report));
    const column = (name: string) => table.headers.indexOf(name);
    expect(table.rows[0]![column("Название графа")]).toBe("'" + report.graph.title);
    expect(table.rows[0]![column("Утверждение")]).toBe("'\u200b＋SUM(1,2)");
    expect(table.rows[1]![column("Цитата")]).toBe("'\r\n@SUM(1,2)");
    expect(JSON.stringify(report)).toBe(before);
  });
  it("exports an empty revision as column headers without invented rows", () => {
    const report = fixture();
    report.claims = [];
    expect(parseCsv(evidenceAuditCsv(report)).rows).toEqual([]);
  });
  it("filters gaps locally, retaining historical quotes as escaped literal text", () => {
    const report = fixture();
    const html = renderToStaticMarkup(<GraphEvidenceAuditReading report={report} gapsOnly />);
    expect(html).toContain("Без цитат");
    expect(html).toContain("Историческая");
    expect(html).not.toContain("Есть действующая цитата");
    expect(html).toContain("&lt;script&gt;window.unsafe=true&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("s@1");
    expect(html).toContain("Прежняя версия");
    expect(report.claims).toHaveLength(3);
    expect(
      renderToStaticMarkup(<GraphEvidenceAuditReading report={report} gapsOnly={false} />)
    ).toContain("Есть действующая цитата");
  });
  it("handles a genuinely empty revision without claiming that anything was verified", () => {
    const report = fixture();
    report.claims = [];
    for (const key of Object.keys(report.statistics) as (keyof typeof report.statistics)[])
      report.statistics[key] = 0;
    expect(renderToStaticMarkup(<GraphEvidenceAuditReading report={report} gapsOnly />)).toContain(
      "нет действующих утверждений"
    );
  });
  it("reads and checks the pinned revision/hash using GET without cache or writes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const report = fixture();
    const result = { report, sha256: digest(report) };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect(
      await readEvidenceAudit("/audit?revision=2", { graphId: "g", revision: 2 }, controller.signal)
    ).toEqual(result);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/audit?revision=2", {
      cache: "no-store",
      signal: controller.signal
    });
  });
  it.each(["hash", "graph", "revision", "format", "count"])(
    "rejects an inconsistent %s response",
    async (field) => {
      vi.stubGlobal("crypto", webcrypto);
      const report = fixture();
      if (field === "graph") report.graph.id = "foreign";
      if (field === "revision") report.graph.revision = 1;
      if (field === "format") (report as { format: string }).format = "other";
      if (field === "count") report.statistics.claims = 99;
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ report, sha256: field === "hash" ? "a".repeat(64) : digest(report) })
            )
          )
      );
      await expect(readEvidenceAudit("/audit", { graphId: "g", revision: 2 })).rejects.toThrow(
        "не совпал"
      );
    }
  );
  it.each([404, 503])("surfaces HTTP %i and never retries", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(readEvidenceAudit("/audit", { graphId: "g", revision: 2 })).rejects.toThrow(
      status === 404 ? "недоступны" : "Повторите"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
