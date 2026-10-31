"use client";

import { useEffect, useRef, useState } from "react";
import type { MemoryTarget, ProfileCandidatePage } from "@cosmora/contracts";

export function ProfileCandidates({
  target,
  onSaved,
  openSource
}: {
  target: MemoryTarget;
  onSaved: () => Promise<void>;
  openSource: (reference: string) => Promise<void>;
}) {
  const [page, setPage] = useState<ProfileCandidatePage | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    return () => c.abort();
  }, []);
  const base =
    "/api/v1/memory/targets/" +
    target.kind +
    "/" +
    encodeURIComponent(target.id) +
    "/profile-candidates";
  async function json<T>(url: string, body?: unknown): Promise<T> {
    const signal = life.current?.signal;
    if (!signal || signal.aborted) throw new Error("closed");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      ...(body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          }
        : {})
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: { code?: string } };
      const code = data.error?.code;
      throw new Error(
        code === "STALE_PROFILE_CANDIDATE"
          ? "Источник или запись изменились. Обновите кандидатов."
          : code === "MEMORY_RUN_ACTIVE"
            ? "Остановите активные задачи перед сохранением."
            : code === "MEMORY_DISABLED"
              ? "Включите и сохраните общую память."
              : "Не удалось выполнить действие. Обновите кандидатов."
      );
    }
    return response.json() as Promise<T>;
  }
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (!life.current?.signal.aborted)
        setError(e instanceof Error ? e.message : "Ошибка памяти.");
    } finally {
      if (!life.current?.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function load() {
    const data = await json<ProfileCandidatePage>(base);
    if (!life.current?.signal.aborted) setPage(data);
  }
  async function decide(
    id: string,
    kind: "confirm" | "dismiss",
    replace?: { id: string; version: number }
  ) {
    await json(base + "/" + kind, {
      candidate_id: id,
      ...(replace ? { replace_id: replace.id, expected_version: replace.version } : {})
    });
    if (kind === "confirm") await onSaved();
    await load();
    if (!life.current?.signal.aborted)
      setNotice(
        kind === "dismiss"
          ? "Кандидат отклонён. Эта версия источника больше не предложит его."
          : "Запись памяти сохранена."
      );
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !page) void action(load);
      }}
    >
      <summary>Кандидаты на запоминание</summary>
      <fieldset disabled={busy} aria-label="Кандидаты профиля">
        <p>
          Находим явные сведения в ваших сообщениях из разрешённых источников. До подтверждения они
          не добавляются в профиль. Предположения ИИ не извлекаются.
        </p>
        <button type="button" onClick={() => void action(load)}>
          Обновить кандидатов
        </button>
        {page && (
          <>
            <p>
              Проверено сообщений: {page.scanned}.{" "}
              {page.limited ? "Показана ограниченная выборка последних сообщений." : ""}
            </p>
            {!page.enabled ? (
              <p>Включите и сохраните общую память для поиска кандидатов.</p>
            ) : !page.items.length ? (
              <p>Новых явных сведений не найдено.</p>
            ) : null}
            {page.items.map((c) => (
              <article key={c.id}>
                <strong>
                  {c.input.title} ·{" "}
                  {c.input.scope === "personal"
                    ? "Общий профиль"
                    : c.input.scope === "chat"
                      ? "Этот чат-источник"
                      : "Проект-источник"}
                </strong>
                <p>{c.input.content}</p>
                <p>Источник от {new Date(c.observed_at).toLocaleString("ru-RU")}.</p>
                <button
                  type="button"
                  onClick={() =>
                    void action(() =>
                      openSource(
                        "H:" +
                          (c.source.kind === "chat_message" ? "g:" : "p:") +
                          c.source.message_id
                      )
                    )
                  }
                >
                  Открыть источник кандидата
                </button>
                {c.replaces.length > 0 && (
                  <p>
                    Есть прежние записи. Сравните значения и выберите: добавить отдельно или
                    обновить конкретную запись.
                  </p>
                )}
                {c.replaces.map((old) => (
                  <div key={old.id}>
                    <p>Прежнее: {old.content}</p>
                    <button
                      type="button"
                      onClick={() => void action(() => decide(c.id, "confirm", old))}
                    >
                      Обновить запись «{old.title}»
                    </button>
                  </div>
                ))}
                {c.conflicts_limited && (
                  <p>
                    Других похожих записей больше. Проверьте полный список памяти перед обновлением.
                  </p>
                )}
                <button type="button" onClick={() => void action(() => decide(c.id, "confirm"))}>
                  Подтвердить и сохранить
                </button>
                <button type="button" onClick={() => void action(() => decide(c.id, "dismiss"))}>
                  Не запоминать
                </button>
              </article>
            ))}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </fieldset>
    </details>
  );
}
