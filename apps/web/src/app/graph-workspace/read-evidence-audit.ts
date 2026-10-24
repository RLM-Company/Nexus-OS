import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";

export type EvidenceAuditResult = { report: IntelligenceGraphEvidenceAudit; sha256: string };

export async function readEvidenceAudit(
  url: string,
  expected: { graphId: string; revision: number },
  signal?: AbortSignal
): Promise<EvidenceAuditResult> {
  const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Граф или ревизия недоступны.");
    throw new Error("Не удалось проверить источники. Повторите загрузку.");
  }
  const result = (await response.json()) as EvidenceAuditResult;
  const report = result.report;
  const sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)))
    )
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (
    report.format !== "kosmora.graph-evidence-audit.v1" ||
    typeof report.usage !== "string" ||
    report.graph.id !== expected.graphId ||
    report.graph.revision !== expected.revision ||
    !Array.isArray(report.claims) ||
    report.statistics.claims !== report.claims.length ||
    sha256 !== result.sha256
  )
    throw new Error("Отчёт не совпал с выбранным графом, ревизией или контрольной суммой.");
  return result;
}
