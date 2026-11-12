import { useEffect, useRef, useState } from "react";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { compareEvidenceAudits, type EvidenceComparison } from "./evidence-comparison";
import { readEvidenceAudit, type EvidenceAuditResult } from "./read-evidence-audit";

const control = {
  border: "1px solid #aaa",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
  color: "#171717",
  font: "inherit"
};
const key = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
const coverage = {
  no_citation: "Без цитат",
  historical_citation: "Только прежние версии источников",
  current_citation: "Есть цитата действующего источника"
};
const changeLabels = {
  added: "Появилось в проверке",
  removed: "Отсутствует в новой проверке",
  changed: "Изменилось"
};
const statuses: Record<string, string> = {
  discovered: "Не проверено",
  hypothesis: "Гипотеза",
  verified: "Помечено проверенным",
  disputed: "Оспаривается",
  superseded: "Прежняя версия",
  deleted: "Удалено"
};
function ClaimSnapshot({
  claim
}: {
  claim: IntelligenceGraphEvidenceAudit["claims"][number] | null;
}) {
  if (!claim) return <p>Действующего утверждения в этом отчёте нет.</p>;
  return (
    <>
      <p>
        <strong>{claim.label}</strong> · {key(claim.ref)} · {statuses[claim.status] ?? claim.status}
      </p>
      <p>{coverage[claim.coverage]}</p>
      {claim.supports.length === 0 && <p>Нет входящих SUPPORTS.</p>}
      {claim.supports.map((s) => (
        <details key={key(s.ref)}>
          <summary>
            {s.from_label} → {claim.label} · {key(s.ref)} ·{" "}
            {s.citation ? "есть цитата" : "без цитаты"}
          </summary>
          <p>
            {key(s.from)} → {key(claim.ref)}. Статус связи: {statuses[s.status] ?? s.status}.
          </p>
          {s.citation && (
            <>
              <p>
                {s.citation.label} · {key(s.citation.source)} · {s.citation.location} ·{" "}
                {s.citation.historical ? "прежняя версия" : "действующая версия"}
              </p>
              <blockquote
                style={{
                  whiteSpace: "pre-wrap",
                  marginInline: 0,
                  borderLeft: "2px solid #aaa",
                  paddingLeft: 12
                }}
              >
                {s.citation.quote}
              </blockquote>
            </>
          )}
        </details>
      ))}
    </>
  );
}

export function EvidenceComparisonReading({ comparison }: { comparison: EvidenceComparison }) {
  return (
    <div aria-label="Результат сравнения проверок">
      <p>
        Ревизии {comparison.before.graph.revision} → {comparison.after.graph.revision}.
      </p>
      <p>
        Появилось: {comparison.counts.added}. Отсутствует в новой проверке:{" "}
        {comparison.counts.removed}. Изменилось: {comparison.counts.changed}. Без изменений:{" "}
        {comparison.counts.unchanged}.
      </p>
      <p>
        Сравниваются также версии, подписи и статусы. Изменение цитирования не означает улучшение
        или ухудшение достоверности.
      </p>
      {comparison.changes.length === 0 && (
        <p>Записи утверждений, поддерживающих связей и цитат совпадают.</p>
      )}
      {comparison.changes.map((change) => (
        <article key={change.id} style={{ borderTop: "1px solid #ddd", paddingBlock: 12 }}>
          <h4>
            {change.after?.label ?? change.before!.label} · {changeLabels[change.kind]}
          </h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12
            }}
          >
            <section aria-label={`Было: ${change.id}`}>
              <h5>Было · ревизия {comparison.before.graph.revision}</h5>
              <ClaimSnapshot claim={change.before} />
            </section>
            <section aria-label={`Стало: ${change.id}`}>
              <h5>Стало · ревизия {comparison.after.graph.revision}</h5>
              <ClaimSnapshot claim={change.after} />
            </section>
          </div>
        </article>
      ))}
      <p style={{ overflowWrap: "anywhere" }}>
        <small>
          SHA-256 прежней проверки: {comparison.before.audit_sha256}
          <br />
          SHA-256 новой проверки: {comparison.after.audit_sha256}
        </small>
      </p>
    </div>
  );
}

export function EvidenceComparisonPanel({
  projectId,
  current,
  disabled = false
}: {
  projectId: string;
  current: EvidenceAuditResult;
  disabled?: boolean;
}) {
  const revision = current.report.graph.revision;
  const [baseline, setBaseline] = useState(String(Math.max(1, revision - 1)));
  const [comparison, setComparison] = useState<EvidenceComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const version = Number(baseline);
  const valid =
    baseline.trim() !== "" && Number.isSafeInteger(version) && version >= 1 && version < revision;
  return (
    <section
      aria-label="Сравнение проверок источников"
      style={{
        borderTop: "1px solid #ccc",
        marginTop: 18,
        paddingTop: 12,
        overflowWrap: "anywhere"
      }}
    >
      <h3>Сравнение проверок источников</h3>
      <p>
        Сравните текущую проверку с полной проверкой прежней сохранённой ревизии этого графа.
        Текущие фильтры списка и источника не ограничивают сравнение. Чтение ничего не изменяет.
      </p>
      {revision <= 1 ? (
        <p>У графа ещё нет прежней ревизии для сравнения.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy || disabled) return;
            const controller = new AbortController();
            request.current?.abort();
            request.current = controller;
            setBusy(true);
            setComparison(null);
            setNotice("");
            const graphId = current.report.graph.id;
            const url = `/api/v1/projects/${encodeURIComponent(projectId)}/intelligence-graphs/${encodeURIComponent(graphId)}/evidence-audit?revision=${version}`;
            void readEvidenceAudit(url, { graphId, revision: version }, controller.signal)
              .then((previous) => {
                if (!controller.signal.aborted)
                  setComparison(
                    compareEvidenceAudits(
                      previous.report,
                      previous.sha256,
                      current.report,
                      current.sha256
                    )
                  );
              })
              .catch((error: unknown) => {
                if (!controller.signal.aborted)
                  setNotice(error instanceof Error ? error.message : "Сравнение недоступно.");
              })
              .finally(() => {
                if (!controller.signal.aborted) setBusy(false);
              });
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            Прежняя ревизия для сравнения источников
            <input
              style={control}
              type="number"
              min={1}
              max={revision - 1}
              step={1}
              required
              value={baseline}
              disabled={busy || disabled}
              onChange={(event) => {
                setBaseline(event.target.value);
                setComparison(null);
                setNotice("");
              }}
            />
          </label>
          <button
            type="submit"
            style={{ ...control, marginTop: 8 }}
            disabled={busy || disabled || !valid}
          >
            {busy ? "Сравниваем источники…" : "Сравнить проверки источников"}
          </button>
        </form>
      )}
      {busy && <p role="status">Загрузка прежней проверки…</p>}
      {notice && <p role="alert">{notice}</p>}
      {comparison && (
        <>
          <EvidenceComparisonReading comparison={comparison} />
          <button
            type="button"
            style={control}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(comparison)], { type: "application/json;charset=utf-8" })
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `graph-evidence-comparison-${current.report.graph.id}-r${comparison.before.graph.revision}-r${revision}.json`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Скачать сравнение источников JSON
          </button>
        </>
      )}
    </section>
  );
}
