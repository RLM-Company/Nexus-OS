import type { IntelligenceGraphWorkspaceExplanation } from "@cosmora/contracts";

type Ref = { id: string; version: number };
const key = (r: Ref) => `${r.id}@${r.version}`;
const statuses: Record<string, string> = {
  discovered: "Не проверено",
  hypothesis: "Гипотеза",
  verified: "Помечено проверенным",
  disputed: "Оспаривается",
  superseded: "Прежняя версия",
  deleted: "Удалено"
};
const concerns: Record<string, string> = {
  NO_VERIFIED_NODES: "Нет проверенных узлов",
  INSUFFICIENT_DISTINCT_SOURCES: "Недостаточно источников",
  INVALID_EVIDENCE_PATHS: "Нарушена структура путей",
  UNVERIFIED_NODES: "Есть непроверенные узлы",
  UNVERIFIED_RELATIONSHIPS: "Есть непроверенные связи",
  TRUNCATED_RETRIEVAL: "Поиск ограничен бюджетом",
  OPEN_CONFLICTS: "Есть открытые противоречия",
  STALE_CONFLICTS: "Есть изменённые версии в разборах",
  TRUNCATED_CONFLICT_REVIEW: "Показана часть релевантных разборов"
};

export function GraphExplanationView({
  explanation: e,
  busy,
  onDownload
}: {
  explanation: IntelligenceGraphWorkspaceExplanation;
  busy: boolean;
  onDownload: () => Promise<void>;
}) {
  const nodes = new Map(e.conflict_nodes.map((n) => [key(n.ref), n]));
  const label = (r: Ref) =>
    nodes.get(key(r))?.label ??
    e.matched_nodes.find((n) => n.id === r.id && n.version === r.version)?.label ??
    r.id;
  const detail = (r: Ref) => {
    const n = nodes.get(key(r));
    return (
      <li key={key(r)}>
        <strong>
          {label(r)} · v{r.version}
        </strong>
        <span> · {statuses[n?.status ?? ""] ?? n?.status ?? "Статус недоступен"}</span>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {n?.detail ?? "Текст недоступен"}
        </p>
      </li>
    );
  };
  return (
    <div aria-live="polite" style={{ marginTop: 16 }}>
      <p>
        <strong>
          {e.graph_title} · ревизия {e.revision}
        </strong>
      </p>
      <p>Запрос: {e.query}</p>
      <strong>
        Оценка:{" "}
        {
          {
            abstain: "Недостаточно данных",
            review_required: "Требуется проверка",
            grounded_context: "Контекст прошёл формальные проверки"
          }[e.readiness]
        }
      </strong>
      <p>{e.explanation}</p>
      <ul>
        {e.concerns.map((c) => (
          <li key={c}>{concerns[c] ?? c}</li>
        ))}
      </ul>
      {e.truncated && <p>Выборка ограничена. Показана только часть графа.</p>}
      <h3>Найденные узлы</h3>
      <ul>
        {e.matched_nodes.map((n) => (
          <li key={`${n.id}@${n.version}`}>
            <strong>
              {n.label} · v{n.version}
            </strong>{" "}
            · {statuses[n.status] ?? n.status}
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.detail}</p>
          </li>
        ))}
      </ul>
      <h3>Связи и цитаты</h3>
      <ul>
        {e.relationships.map((r) => (
          <li key={`${r.edge_id}@${r.version}`}>
            {r.description} · v{r.version} · {statuses[r.status] ?? r.status}. {r.note}
            {r.quote !== null && (
              <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {r.quote}
              </blockquote>
            )}
            {r.quote !== null && (
              <p>
                Источник: {label({ id: r.source.source_id, version: r.source.source_version })} · v
                {r.source.source_version} · {r.source.location} ·{" "}
                {statuses[r.source_status ?? ""] ?? r.source_status ?? "Статус недоступен"}
              </p>
            )}
          </li>
        ))}
      </ul>
      {e.relationships.length === 0 && <p>Релевантных связей для этого запроса не найдено.</p>}
      <h3>Противоречия по запросу</h3>
      <p>
        Разборов показано: {e.conflict_review.returned} из {e.conflict_review.relevant}. Каждый
        показанный разбор включает все свои позиции.
      </p>
      {e.conflicts.map((c) => (
        <details key={c.conflict_id} style={{ paddingBlock: 8 }}>
          <summary>
            {label(c.subject_ref)} — {c.status === "open" ? "Открыто" : "Решение записано"}
          </summary>
          <p>Тема · v{c.subject_ref.version}</p>
          <ul>{detail(c.subject_ref)}</ul>
          <strong>Позиции</strong>
          <ul>{c.position_refs.map(detail)}</ul>
          {c.resolution_ref && (
            <>
              <strong>Решение владельца</strong>
              <ul>{detail(c.resolution_ref)}</ul>
            </>
          )}
          {e.stale_conflict_ids.includes(c.conflict_id) && (
            <p>Есть изменённые или удалённые версии. Требуется пересмотр.</p>
          )}
          <p>Решение не повышает достоверность утверждений.</p>
        </details>
      ))}
      <details>
        <summary>Пути и ограничения поиска</summary>
        <p>Путь показывает навигацию по связям и не является логическим доказательством.</p>
        <p>
          Узлов просмотрено: {e.budget.visited_nodes} / {e.budget.max_nodes}; связей возвращено:{" "}
          {e.budget.returned_edges} / {e.budget.max_edges}; глубина до {e.budget.max_depth}; оценка
          контекста: {e.budget.estimated_context_tokens} / {e.budget.max_context_tokens} токенов.
        </p>
        <p>
          Лимит разбора: {e.conflict_review.max_conflicts} конфликтов /{" "}
          {e.conflict_review.max_nodes} уникальных версий узлов.
        </p>
        <ul>
          {e.paths.map((p, i) => (
            <li key={i}>
              {label(p.seed)} · v{p.seed.version} → {label(p.target)} · v{p.target.version}; шагов:{" "}
              {p.edges.length}
            </li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onDownload()}
        style={{
          border: "1px solid #999",
          borderRadius: 8,
          padding: "9px 14px",
          background: "#fff",
          color: "#171717",
          font: "inherit",
          marginTop: 12
        }}
      >
        Скачать отчёт этой ревизии
      </button>
    </div>
  );
}
