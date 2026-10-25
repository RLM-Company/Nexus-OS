import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { csvField } from "../spreadsheet-csv";

/** Full checked report, independent of the current UI filter; no row truncation. */
export function evidenceAuditCsv(report: IntelligenceGraphEvidenceAudit): string {
  const rows: string[][] = [
    [
      "Граф",
      "Название графа",
      "Ревизия",
      "Утверждение ID",
      "Версия утверждения",
      "Утверждение",
      "Статус утверждения",
      "Наличие цитат",
      "Связь ID",
      "Версия связи",
      "Статус связи",
      "От узла ID",
      "Версия узла",
      "От узла",
      "Источник ID",
      "Версия источника",
      "Источник",
      "Статус источника",
      "Прежняя версия источника",
      "Место",
      "Цитата",
      "Назначение отчёта"
    ]
  ];
  for (const claim of report.claims) {
    for (const support of claim.supports.length ? claim.supports : [null]) {
      const citation = support?.citation;
      rows.push([
        report.graph.id,
        report.graph.title,
        String(report.graph.revision),
        claim.ref.id,
        String(claim.ref.version),
        claim.label,
        claim.status,
        claim.coverage,
        support?.ref.id ?? "",
        support ? String(support.ref.version) : "",
        support?.status ?? "",
        support?.from.id ?? "",
        support ? String(support.from.version) : "",
        support?.from_label ?? "",
        citation?.source.id ?? "",
        citation ? String(citation.source.version) : "",
        citation?.label ?? "",
        citation?.status ?? "",
        citation ? (citation.historical ? "Да" : "Нет") : "",
        citation?.location ?? "",
        citation?.quote ?? "",
        report.usage
      ]);
    }
  }
  return "\ufeff" + rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
