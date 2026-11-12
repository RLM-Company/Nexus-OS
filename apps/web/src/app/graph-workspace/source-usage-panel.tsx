import { useState } from "react";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { buildSourceUsages, filterSourceUsage } from "./source-usage";
import { sourceUsageExport, sourceUsageCsv } from "./source-usage-export";

const control = {
  border: "1px solid #aaa",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
  color: "#171717",
  font: "inherit",
  maxWidth: "100%"
};
const key = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
export function SourceUsagePanel({
  report,
  auditSha256,
  onReviewCitation,
  disabled = false
}: {
  report: IntelligenceGraphEvidenceAudit;
  auditSha256: string;
  onReviewCitation?: ((ref: { id: string; version: number }) => void) | undefined;
  disabled?: boolean;
}) {
  const [sourceId, setSourceId] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const sources = buildSourceUsages(report);
  const source = sources.find((s) => s.id === sourceId);
  const selected = source ? filterSourceUsage(source, version) : null;
  const download = (format: "json" | "csv") => {
    setNotice("");
    try {
      const value = sourceUsageExport(report, auditSha256, sourceId, version);
      const bytes = format === "json" ? JSON.stringify(value) : sourceUsageCsv(value);
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8"
        })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `graph-source-${report.graph.id}-${sourceId}-r${report.graph.revision}-${version === null ? "all" : `v${version}`}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось подготовить выгрузку.");
    }
  };
  return (
    <section
      aria-label="Где используется источник"
      style={{
        borderTop: "1px solid #ccc",
        marginTop: 18,
        paddingTop: 12,
        overflowWrap: "anywhere"
      }}
    >
      <h3>Где используется источник</h3>
      <p>
        Утверждения и точные цитаты из этой ревизии графа. Здесь учитываются цитируемые входящие
        SUPPORTS действующих утверждений. Это список ссылок на источник, а не оценка его
        достоверности.
      </p>
      {sources.length === 0 ? (
        <p>В этой проверке нет источников с цитатами.</p>
      ) : (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            Источник для просмотра использования
            <select
              style={control}
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setVersion(null);
                setNotice("");
              }}
            >
              <option value="">Выберите источник</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.id} · утверждений: {s.counts.claims}, цитат: {s.counts.citations}
                </option>
              ))}
            </select>
          </label>
          {source && (
            <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
              Цитируемая версия источника
              <select
                style={control}
                value={version ?? "all"}
                onChange={(event) => {
                  setVersion(event.target.value === "all" ? null : Number(event.target.value));
                  setNotice("");
                }}
              >
                <option value="all">Все цитируемые версии</option>
                {source.versions.map((v) => (
                  <option key={v.ref.version} value={v.ref.version}>
                    v{v.ref.version} · {v.label} · {v.historical ? "прежняя" : "действующая"} ·
                    цитат: {v.citations}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && (
            <div aria-label="Использование выбранного источника">
              <p>
                Ревизия графа: {report.graph.revision}. Источник: {selected.id}.
              </p>
              <p>
                Утверждений: {selected.counts.claims}. Цитат: {selected.counts.citations}. Из
                действующих версий: {selected.counts.current_citations}. Из прежних версий:{" "}
                {selected.counts.historical_citations}.
              </p>
              <p>
                <small>
                  Название в списке взято из последней цитируемой версии. Источники с одинаковыми
                  названиями разделены по ID. Фильтр «Только без действующих цитат» на этот просмотр
                  не влияет.
                </small>
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={control} onClick={() => download("json")}>
                  Скачать использование источника JSON
                </button>
                <button type="button" style={control} onClick={() => download("csv")}>
                  Скачать использование источника CSV
                </button>
              </div>
              <p>
                <small>
                  Обе выгрузки учитывают выбранный источник и фильтр версии. JSON сохраняет точный
                  текст; CSV защищает ячейки от выполнения формул. Ссылка на контрольную сумму
                  относится к полной исходной проверке источников.
                </small>
              </p>
              {notice && <p role="alert">{notice}</p>}
              {selected.claims.map((claim) => (
                <article
                  key={key(claim.ref)}
                  style={{ borderTop: "1px solid #ddd", paddingBlock: 12 }}
                >
                  <h4 style={{ margin: 0 }}>{claim.label}</h4>
                  <p>{key(claim.ref)}</p>
                  {claim.supports.map((support) => (
                    <details key={key(support.ref)} style={{ marginBlock: 8 }}>
                      <summary>
                        {support.citation.label} · v{support.citation.source.version} ·{" "}
                        {support.citation.historical
                          ? "прежняя версия источника"
                          : "действующая версия источника"}{" "}
                        · {key(support.ref)}
                      </summary>
                      <p>
                        {support.from_label} ({key(support.from)}) → {claim.label} ({key(claim.ref)}
                        ).
                      </p>
                      <p>
                        Источник: {key(support.citation.source)}. Место: {support.citation.location}
                        .
                      </p>
                      <blockquote
                        style={{
                          whiteSpace: "pre-wrap",
                          borderLeft: "2px solid #aaa",
                          paddingLeft: 12,
                          marginInline: 0
                        }}
                      >
                        {support.citation.quote}
                      </blockquote>
                      {support.citation.historical && onReviewCitation && (
                        <button
                          type="button"
                          style={control}
                          disabled={disabled}
                          onClick={() => onReviewCitation(support.ref)}
                        >
                          Сверить с новой версией источника
                        </button>
                      )}
                    </details>
                  ))}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
