import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { csvField } from "../spreadsheet-csv";
import { buildSourceUsages, filterSourceUsage, type SourceUsage } from "./source-usage";

export type SourceUsageExport = {
  format: "kosmora.graph-source-usage.v1";
  usage: string;
  graph: IntelligenceGraphEvidenceAudit["graph"];
  audit: { format: IntelligenceGraphEvidenceAudit["format"]; sha256: string };
  scope: { source_id: string; source_version: number | null };
  source: SourceUsage;
};

/** Deterministic local projection of the checked audit; does not read or change the graph. */
export function sourceUsageExport(
  report: IntelligenceGraphEvidenceAudit,
  auditSha256: string,
  sourceId: string,
  version: number | null
): SourceUsageExport {
  if (!/^[a-f0-9]{64}$/.test(auditSha256))
    throw new Error("Контрольная сумма проверки недоступна.");
  const source = buildSourceUsages(report).find((s) => s.id === sourceId);
  if (!source) throw new Error("Источник отсутствует в проверке.");
  return {
    format: "kosmora.graph-source-usage.v1",
    usage:
      "Цитируемые входящие SUPPORTS действующих утверждений выбранной ревизии. Фильтр источника и версии указан в scope. Контрольная сумма audit относится к полному исходному отчёту проверки, не к этой выгрузке. Наличие ссылки не подтверждает достоверность или смысловую связь.",
    graph: { ...report.graph },
    audit: { format: report.format, sha256: auditSha256 },
    scope: { source_id: sourceId, source_version: version },
    source: filterSourceUsage(source, version)
  };
}

export function sourceUsageCsv(value: SourceUsageExport): string {
  const rows: string[][] = [
    [
      "Граф",
      "Название графа",
      "Ревизия",
      "Фильтр версии источника",
      "Источник ID",
      "Версия источника",
      "Источник",
      "Прежняя версия источника",
      "Утверждение ID",
      "Версия утверждения",
      "Утверждение",
      "Статус утверждения",
      "Связь ID",
      "Версия связи",
      "Статус связи",
      "От узла ID",
      "Версия узла",
      "От узла",
      "Место",
      "Цитата",
      "SHA-256 полной проверки",
      "Назначение отчёта"
    ]
  ];
  for (const claim of value.source.claims) {
    for (const support of claim.supports) {
      const citation = support.citation;
      rows.push([
        value.graph.id,
        value.graph.title,
        String(value.graph.revision),
        value.scope.source_version === null
          ? "Все цитируемые версии"
          : String(value.scope.source_version),
        citation.source.id,
        String(citation.source.version),
        citation.label,
        citation.historical ? "Да" : "Нет",
        claim.ref.id,
        String(claim.ref.version),
        claim.label,
        claim.status,
        support.ref.id,
        String(support.ref.version),
        support.status,
        support.from.id,
        String(support.from.version),
        support.from_label,
        citation.location,
        citation.quote,
        value.audit.sha256,
        value.usage
      ]);
    }
  }
  return "\ufeff" + rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
