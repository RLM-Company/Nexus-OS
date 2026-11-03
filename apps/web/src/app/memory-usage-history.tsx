"use client";
import { useEffect, useRef, useState } from "react";
import type { MemoryUsagePage, MemoryTarget } from "@cosmora/contracts";

export function MemoryUsageHistory({
  target,
  disabled
}: {
  target: MemoryTarget;
  disabled: boolean;
}) {
  return <Usage key={target.kind + ":" + target.id} target={target} disabled={disabled} />;
}
function Usage({ target, disabled }: { target: MemoryTarget; disabled: boolean }) {
  const [page, setPage] = useState<MemoryUsagePage | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  const url = `/api/v1/memory/targets/${target.kind}/${encodeURIComponent(target.id)}/usage`;
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    return () => c.abort();
  }, []);
  async function load(offset = 0, clear = false) {
    const c = life.current;
    if (!c || c.signal.aborted || lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url + (clear ? "" : `?offset=${offset}`), {
        method: clear ? "DELETE" : "GET",
        cache: "no-store",
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)])
      });
      if (!response.ok) throw Error();
      if (c.signal.aborted) return;
      if (clear) setPage({ items: [], next_offset: null });
      else {
        const data = (await response.json()) as MemoryUsagePage;
        if (!c.signal.aborted)
          setPage((old) =>
            offset && old ? { ...data, items: [...old.items, ...data.items] } : data
          );
      }
    } catch {
      if (!c.signal.aborted)
        setError(
          clear
            ? "Не удалось очистить журнал. Сначала остановите активные задачи."
            : "Не удалось загрузить журнал памяти."
        );
    } finally {
      if (!c.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <details>
      <summary>Использование памяти в запросах</summary>
      <p>
        Журнал дополнительной памяти из выбранных чатов и профиля: ссылки и контрольные суммы, без
        копий текста. Переписка, вложения и файлы агента здесь не учитываются. Граница отправки не
        подтверждает доставку; завершение провайдера не доказывает понимание источника. Сохраняются
        последние 500 запросов аккаунта.
      </p>
      <button type="button" disabled={disabled || busy} onClick={() => void load()}>
        Обновить журнал
      </button>{" "}
      <button
        type="button"
        disabled={disabled || busy || !page?.items.length}
        onClick={() => {
          if (window.confirm("Очистить журнал этого чата или проекта? Исходная память сохранится."))
            void load(0, true);
        }}
      >
        Очистить журнал
      </button>
      {page?.items.length === 0 && (
        <p>
          Записей нет. Старые ответы и предварительный подбор контекста задним числом не
          учитываются.
        </p>
      )}
      {page?.items.map((item) => (
        <article key={item.id}>
          <strong>{new Date(item.created_at).toLocaleString("ru-RU")}</strong>
          <p>
            Запуск: <code style={{ overflowWrap: "anywhere" }}>{item.run_id}</code>
          </p>
          <p>
            {item.channel === "chat"
              ? "Чат"
              : item.channel === "native_work"
                ? "Агент Koswork"
                : "Задача Work"}{" "}
            · попытка {item.attempt + 1} ·{" "}
            {item.phase === "provider_completed"
              ? "Провайдер завершил ответ"
              : "Граница отправки, результат не подтверждён"}
          </p>
          <p>
            {item.snapshot.representation === "exact"
              ? "Точный пакет присутствовал в запросе"
              : item.snapshot.representation === "unverified"
                ? "Исходный пакет преобразован: сохранность отдельных цитат не подтверждена"
                : "Дополнительной памяти в пакете нет"}
            . {item.snapshot.bundle_bytes} байт в исходном пакете.
          </p>
          {item.snapshot.sources.length > 0 && (
            <details>
              <summary>
                {item.snapshot.representation === "exact"
                  ? "Источники в пакете"
                  : "Источники до преобразования"}
                : {item.snapshot.sources.length}
              </summary>
              <ul>
                {item.snapshot.sources.map((source, i) => (
                  <li key={source.reference + ":" + i}>
                    <code>{source.reference}</code>
                    {source.version !== null ? ` · версия ${source.version}` : ""}
                    {source.excerpt_only ? " · выдержка" : ""}
                    <details>
                      <summary>Контрольные суммы</summary>
                      <p style={{ overflowWrap: "anywhere" }}>
                        Фрагмент: {source.text_sha256}
                        {source.source_sha256 ? ` · оригинал: ${source.source_sha256}` : ""}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {item.snapshot.sources_omitted > 0 && (
            <p>Метаданные не вошедших в журнал источников: {item.snapshot.sources_omitted}.</p>
          )}
        </article>
      ))}
      {page?.next_offset !== null && page?.next_offset !== undefined && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void load(page.next_offset!)}
        >
          Ещё записи
        </button>
      )}
      {busy && <p role="status">Загрузка журнала…</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
