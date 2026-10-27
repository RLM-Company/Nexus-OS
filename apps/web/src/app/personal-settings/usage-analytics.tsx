"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./usage-analytics.module.css";

type Row = {
  kind: string;
  stage?: string | null;
  chat_id: string | null;
  run_id: string;
  provider_id: string;
  model_id: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  reserved_tokens: number;
  created_at: string;
};
type Summary = {
  model_tokens_or_upper_bound: number;
  translation_tokens_or_upper_bound: number;
  in_flight_or_uncertain_holds: number;
  total_counted_tokens: number;
  max_total_tokens: number | null;
};
const number = (value: number | undefined | null) =>
  value == null ? "—" : value.toLocaleString("ru-RU");
const statusName = (status: string) =>
  ({
    committed: "Учтено",
    reserved: "Зарезервировано",
    failed: "Ошибка",
    cancelled: "Отменено",
    uncertain: "Неопределённо"
  })[status] ?? status;
export function UsageMetrics({ summary }: { summary?: Summary | undefined }) {
  return (
    <div className={styles.metrics} aria-label="Показатели использования">
      {[
        ["Всего учтено", summary?.total_counted_tokens],
        ["Основные запросы", summary?.model_tokens_or_upper_bound],
        ["Перевод", summary?.translation_tokens_or_upper_bound],
        ["Резервы", summary?.in_flight_or_uncertain_holds]
      ].map(([title, value]) => (
        <div key={String(title)}>
          <span>{title}</span>
          <strong>{number(value as number | undefined)}</strong>
          <small>токенов</small>
        </div>
      ))}
      {summary?.max_total_tokens != null && (
        <div className={styles.quota}>
          <span>Персональный лимит · {number(summary.max_total_tokens)}</span>
          <progress
            aria-label="Использование персонального лимита"
            max={summary.max_total_tokens}
            value={Math.min(summary.total_counted_tokens, summary.max_total_tokens)}
          />
        </div>
      )}
    </div>
  );
}
export function UsageActivity({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const shown = rows.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      (!status || row.status === status) &&
      `${row.model_id} ${row.provider_id} ${row.chat_id ?? ""} ${row.run_id}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  );
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  const close = () => {
    dialog.current?.close();
    setSelected(null);
    opener.current?.focus();
  };
  return (
    <div className={styles.activity}>
      <div className={styles.toolbar} aria-label="Фильтры истории запросов">
        <input
          type="search"
          aria-label="Поиск по модели или запросу"
          placeholder="Модель или запрос…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Тип запроса" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все типы</option>
          {[...new Set(rows.map((r) => r.kind))].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Состояние запроса"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Все состояния</option>
          {[...new Set(rows.map((r) => r.status))].map((value) => (
            <option key={value} value={value}>
              {statusName(value)}
            </option>
          ))}
        </select>
      </div>
      {(kind || status || query) && (
        <div className={styles.chips} aria-label="Активные фильтры">
          {kind && (
            <button type="button" onClick={() => setKind("")} aria-label="Убрать фильтр типа">
              {kind} ×
            </button>
          )}
          {status && (
            <button
              type="button"
              onClick={() => setStatus("")}
              aria-label="Убрать фильтр состояния"
            >
              {statusName(status)} ×
            </button>
          )}
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Убрать поисковый фильтр">
              «{query}» ×
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setKind("");
              setStatus("");
              setQuery("");
            }}
          >
            Сбросить всё
          </button>
        </div>
      )}
      <p className={styles.count} role="status">
        Показано {shown.length} из {rows.length} последних попыток
      </p>
      <div className={styles.scroll}>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Модель</th>
              <th>Тип</th>
              <th>Состояние</th>
              <th>Вход / выход</th>
              <th>
                <span className={styles.sr}>Подробности</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={`${row.run_id}:${row.kind}:${index}`}>
                <td>{new Date(row.created_at).toLocaleString("ru-RU")}</td>
                <td>
                  <strong>{row.model_id}</strong>
                  <small>{row.provider_id}</small>
                </td>
                <td>
                  {row.kind}
                  {row.stage ? ` / ${row.stage}` : ""}
                </td>
                <td>
                  <span className={styles.status}>{statusName(row.status)}</span>
                </td>
                <td>
                  {number(row.input_tokens)} / {number(row.output_tokens)}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setSelected(row);
                    }}
                    aria-label={`Подробнее о запросе ${row.run_id}`}
                  >
                    Подробнее
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={6}>
                  {rows.length
                    ? "По выбранным фильтрам запросов нет."
                    : "История запросов пока пуста."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dialog
        className={styles.dialog}
        ref={dialog}
        aria-labelledby="usage-detail-title"
        onCancel={close}
        onClose={() => {
          setSelected(null);
          opener.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <header>
          <h3 id="usage-detail-title">Подробности запроса</h3>
          <button type="button" onClick={close} aria-label="Закрыть подробности">
            ×
          </button>
        </header>
        {selected && (
          <dl>
            {[
              ["Модель", selected.model_id],
              ["Провайдер", selected.provider_id],
              ["Состояние", statusName(selected.status)],
              ["Входные токены", number(selected.input_tokens)],
              ["Выходные токены", number(selected.output_tokens)],
              ["Резерв / верхняя граница", number(selected.reserved_tokens)],
              ["Запрос", selected.run_id],
              ["Чат", selected.chat_id ?? "—"]
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p>Неопределённые расходы учитываются резервом. Показатели взяты из журнала аккаунта.</p>
      </dialog>
    </div>
  );
}
