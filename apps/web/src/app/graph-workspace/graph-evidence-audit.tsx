"use client";
import { useEffect, useRef, useState } from "react";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { readEvidenceAudit, type EvidenceAuditResult } from "./read-evidence-audit";
import { evidenceAuditCsv } from "./evidence-audit-csv";
import { SourceUsagePanel } from "./source-usage-panel";
import { EvidenceComparisonPanel } from "./evidence-comparison-panel";

const control = {
  border: "1px solid #aaa",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
  color: "#171717",
  font: "inherit"
};
const refKey = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
const coverageLabels = {
  current_citation: "Есть цитата из действующей версии источника",
  historical_citation: "Цитаты только из прежних версий источников",
  no_citation: "Нет цитат на поддерживающих связях"
};
const statuses: Record<string, string> = {
  discovered: "Не проверено",
  hypothesis: "Гипотеза",
  verified: "Помечено проверенным",
  disputed: "Оспаривается",
  superseded: "Прежняя версия",
  deleted: "Удалено"
};
type Ref = { id: string; version: number };

export function GraphEvidenceAuditReading({
  report,
  gapsOnly,
  onReviewCitation,
  reviewDisabled = false
}: {
  report: IntelligenceGraphEvidenceAudit;
  gapsOnly: boolean;
  onReviewCitation?: ((ref: Ref) => void) | undefined;
  reviewDisabled?: boolean;
}) {
  const claims = report.claims.filter((c) => !gapsOnly || c.coverage !== "current_citation");
  return (
    <div aria-label="Результат проверки источников" style={{ overflowWrap: "anywhere" }}>
      <p>
        Ревизия {report.graph.revision}. Утверждений: {report.statistics.claims}.
      </p>
      <p>
        С цитатами действующих источников: {report.statistics.with_current_citations}. Только
        прежние версии: {report.statistics.with_historical_citations_only}. Без цитат:{" "}
        {report.statistics.without_citations}.
      </p>
      <p>
        Поддерживающих связей без цитаты: {report.statistics.uncited_support_links}. Цитат из
        прежних версий: {report.statistics.historical_citations}.
      </p>
      {report.claims.length === 0 ? (
        <p>В этой ревизии нет действующих утверждений.</p>
      ) : claims.length === 0 ? (
        <p>
          У всех действующих утверждений есть хотя бы одна цитата из действующей версии источника.
        </p>
      ) : (
        claims.map((claim) => (
          <article
            key={refKey(claim.ref)}
            style={{ borderTop: "1px solid #ddd", paddingBlock: 12 }}
          >
            <h3 style={{ margin: "0 0 8px" }}>{claim.label}</h3>
            <small>
              {refKey(claim.ref)} · {statuses[claim.status] ?? claim.status}
            </small>
            <p>{coverageLabels[claim.coverage]}</p>
            {claim.supports.length === 0 && (
              <p>Нет входящих связей SUPPORTS к этой версии утверждения.</p>
            )}
            {claim.supports.map((support) => (
              <details key={refKey(support.ref)} style={{ marginBlock: 8 }}>
                <summary>
                  {support.from_label} → {claim.label} ·{" "}
                  {support.citation
                    ? support.citation.historical
                      ? "прежний источник"
                      : "есть цитата"
                    : "без цитаты"}
                </summary>
                <p>
                  Связь {refKey(support.ref)} · {statuses[support.status] ?? support.status}. От:{" "}
                  {refKey(support.from)}.
                </p>
                {support.citation && (
                  <blockquote
                    style={{ borderLeft: "2px solid #aaa", marginInline: 0, paddingLeft: 12 }}
                  >
                    <p style={{ whiteSpace: "pre-wrap" }}>{support.citation.quote}</p>
                    <small>
                      {support.citation.label} · {refKey(support.citation.source)} ·{" "}
                      {support.citation.location} ·{" "}
                      {statuses[support.citation.status] ?? support.citation.status}
                    </small>
                  </blockquote>
                )}
                {support.citation?.historical && onReviewCitation && (
                  <button
                    type="button"
                    style={control}
                    disabled={reviewDisabled}
                    onClick={() => onReviewCitation(support.ref)}
                  >
                    Сверить с новой версией источника
                  </button>
                )}
              </details>
            ))}
          </article>
        ))
      )}
    </div>
  );
}

export function GraphEvidenceAuditPanel({
  projectId,
  graphId,
  revision,
  disabled = false,
  onReviewCitation
}: {
  projectId: string;
  graphId: string;
  revision: number;
  disabled?: boolean;
  onReviewCitation?: ((ref: Ref) => void) | undefined;
}) {
  const [result, setResult] = useState<EvidenceAuditResult | null>(null);
  const [gapsOnly, setGapsOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return (
    <section
      aria-label="Проверка источников графа"
      style={{ border: "1px solid #ccc", borderRadius: 12, padding: 18, background: "#fff" }}
    >
      <h2>Проверка источников</h2>
      <p>
        Проверяется весь сохранённый граф выбранной ревизии, без ограничения поисковой выборкой.
        Учитываются только входящие SUPPORTS к действующим утверждениям и точные цитаты из
        Source/Document.
      </p>
      <p>
        Наличие цитаты не подтверждает истинность утверждения, качество источника или смысловую
        связь с текстом. Прежняя версия сохраняет исходную цитату, но требует повторного просмотра.
        Проверка ничего не изменяет.
      </p>
      <button
        type="button"
        style={control}
        disabled={busy || disabled}
        onClick={() => {
          const controller = new AbortController();
          request.current?.abort();
          request.current = controller;
          setBusy(true);
          setNotice("");
          setResult(null);
          const url = `/api/v1/projects/${encodeURIComponent(projectId)}/intelligence-graphs/${encodeURIComponent(graphId)}/evidence-audit?revision=${revision}`;
          void readEvidenceAudit(url, { graphId, revision }, controller.signal)
            .then((value) => {
              if (!controller.signal.aborted) setResult(value);
            })
            .catch((error: unknown) => {
              if (!controller.signal.aborted)
                setNotice(error instanceof Error ? error.message : "Проверка недоступна.");
            })
            .finally(() => {
              if (!controller.signal.aborted) setBusy(false);
            });
        }}
      >
        {busy ? "Проверяем источники…" : "Проверить источники"}
      </button>
      {busy && <p role="status">Загрузка выбранной ревизии…</p>}
      {notice && <p role="alert">{notice}</p>}
      {result && (
        <>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 12
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={gapsOnly}
                onChange={(event) => setGapsOnly(event.target.checked)}
              />{" "}
              Только без действующих цитат
            </label>
            <button
              type="button"
              style={control}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(result.report)], {
                    type: "application/json;charset=utf-8"
                  })
                );
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `graph-evidence-${graphId}-v${revision}.json`;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Скачать проверку источников JSON
            </button>
            <button
              type="button"
              style={control}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([evidenceAuditCsv(result.report)], { type: "text/csv;charset=utf-8" })
                );
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `graph-evidence-${graphId}-v${revision}.csv`;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Скачать все связи CSV
            </button>
          </div>
          <p>
            <small>
              Обе выгрузки включают весь отчёт независимо от фильтра. CSV защищает ячейки от
              выполнения формул; точный исходный текст остаётся в JSON.
            </small>
          </p>
          <GraphEvidenceAuditReading
            report={result.report}
            gapsOnly={gapsOnly}
            onReviewCitation={onReviewCitation}
            reviewDisabled={busy || disabled}
          />
          <SourceUsagePanel
            key={result.sha256}
            report={result.report}
            auditSha256={result.sha256}
            onReviewCitation={onReviewCitation}
            disabled={busy || disabled}
          />
          <EvidenceComparisonPanel
            key={`comparison:${result.sha256}`}
            projectId={projectId}
            current={result}
            disabled={busy || disabled}
          />
          <p style={{ overflowWrap: "anywhere" }}>
            <small>SHA-256 скачиваемого JSON: {result.sha256}</small>
          </p>
        </>
      )}
    </section>
  );
}
