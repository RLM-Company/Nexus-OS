"use client";

import { useEffect, useRef, useState } from "react";
import { ProfileCandidates } from "./profile-candidates";
import type { HistoryCompactionPreview } from "@cosmora/contracts";
import type {
  ContextMemoryBundle,
  ContextMemoryEntry,
  ContextMemoryInput,
  ContextMemorySettings as Settings,
  MemoryTarget
} from "@cosmora/contracts/context-memory";

type Page = { items: ContextMemoryEntry[]; next_offset: number | null };
type Choice = { id: string; title: string; status?: string; mode?: string };
const kinds: Record<ContextMemoryInput["kind"], string> = {
  fact: "Факт",
  preference: "Предпочтение",
  decision: "Решение",
  constraint: "Ограничение",
  hypothesis: "Предположение"
};
const labels: Record<ContextMemoryEntry["source_status"], string> = {
  manual: "Запись владельца",
  current: "Источник проверен",
  changed: "Источник изменился — не используется",
  unavailable: "Источник недоступен — не используется"
};
const draftFor = (target: MemoryTarget): ContextMemoryInput => ({
  scope: target.kind,
  scope_id: target.id,
  kind: "fact",
  title: "",
  content: "",
  pinned: false,
  expires_at: null,
  source: null
});
const localDay = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
};
const errorText: Record<string, string> = {
  MEMORY_RUN_ACTIVE: "Остановите активные задачи перед изменением памяти.",
  STALE_MEMORY: "Запись изменилась. Обновите список перед сохранением.",
  STALE_MEMORY_SETTINGS: "Настройки изменились. Загрузите сохранённую версию.",
  MEMORY_TARGET_NOT_FOUND: "Чат или проект недоступен. Уберите его из выбранных источников.",
  MEMORY_SOURCE_NOT_FOUND: "Источник недоступен или цитата не совпадает с оригиналом.",
  INVALID_MEMORY: "Проверьте поля записи и срок актуальности.",
  MEMORY_SECRET_UNSUPPORTED: "Пароли, ключи и коды подтверждения не сохраняются в общей памяти.",
  MEMORY_CREATION_CONFLICT:
    "Эта попытка создания уже сохранена с другим содержимым. Обновите список.",
  OWNER_DATA_FENCED: "С данными аккаунта выполняется другая операция."
};

export function ContextMemorySettings({
  target,
  disabled = false
}: {
  target: MemoryTarget;
  disabled?: boolean;
}) {
  return <MemoryForm key={target.kind + ":" + target.id} target={target} disabled={disabled} />;
}

function MemoryForm({ target, disabled }: { target: MemoryTarget; disabled: boolean }) {
  const base = "/api/v1/memory/targets/" + target.kind + "/" + encodeURIComponent(target.id);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  const creationId = useRef<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<ContextMemoryEntry[]>([]);
  const [chats, setChats] = useState<Choice[]>([]),
    [projects, setProjects] = useState<Choice[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [preview, setPreview] = useState<ContextMemoryBundle | null>(null);
  const [compression, setCompression] = useState<HistoryCompactionPreview | null>(null);
  const [canCompact, setCanCompact] = useState(false);
  const [editing, setEditing] = useState<ContextMemoryEntry | null>(null);
  const [draft, setDraft] = useState<ContextMemoryInput>(() => draftFor(target));
  const [sourceId, setSourceId] = useState(""),
    [quote, setQuote] = useState("");
  const [sourceKind, setSourceKind] = useState<"chat_message" | "project_message">("chat_message");
  const [versions, setVersions] = useState<ContextMemoryEntry[] | null>(null);
  const [openedSource, setOpenedSource] = useState<{
    content: string;
    next_offset: number | null;
    reference: string;
    source: NonNullable<ContextMemoryEntry["source"]>;
  } | null>(null);

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = life.current;
    if (!controller || controller.signal.aborted) throw new Error("Окно закрыто.");
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      throw new Error(
        errorText[body?.error?.code ?? ""] ??
          "Не удалось выполнить действие. Обновите данные перед повтором."
      );
    }
    return response.json() as Promise<T>;
  }
  const body = (value: unknown, method = "PUT"): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value)
  });
  async function load() {
    const [s, list, c, p] = await Promise.all([
      json<Settings>(base + "/settings"),
      json<Page>("/api/v1/memory"),
      json<{ items: Choice[] }>("/api/v1/chats"),
      json<{ items: Choice[] }>("/api/v1/projects")
    ]);
    if (life.current?.signal.aborted) return;
    setSettings(s);
    setCanCompact(
      target.kind === "chat" && c.items.some((c) => c.id === target.id && c.mode !== "coscode")
    );
    setItems(list.items);
    setNextOffset(list.next_offset);
    setChats(c.items.filter((c) => target.kind !== "chat" || c.id !== target.id));
    setProjects(
      p.items.filter(
        (p) => p.status === "ACTIVE" && (target.kind !== "project" || p.id !== target.id)
      )
    );
    setPreview(null);
    setCompression(null);
    setOpenedSource(null);
    setVersions(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    lock.current = true;
    void load()
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Не удалось загрузить общую память. Попробуйте обновить.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          lock.current = false;
        }
      });
    return () => controller.abort();
    // This form is remounted by target identity; every request belongs to that lifetime.
  }, []);

  async function operation(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    setCompression(null);
    setOpenedSource(null);
    try {
      await action();
    } catch (cause) {
      if (!life.current?.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally {
      if (!life.current?.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function refreshEntries(offset = 0, append = false) {
    const page = await json<Page>("/api/v1/memory?offset=" + offset);
    if (life.current?.signal.aborted) return;
    setItems((current) => (append ? [...current, ...page.items] : page.items));
    setNextOffset(page.next_offset);
  }
  function reset() {
    setEditing(null);
    setDraft(draftFor(target));
    setSourceId("");
    setQuote("");
    setVersions(null);
    creationId.current = null;
  }
  function edit(entry: ContextMemoryEntry) {
    setEditing(entry);
    setVersions(null);
    creationId.current = null;
    setDraft({
      scope: entry.scope,
      scope_id: entry.scope_id,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      pinned: entry.pinned,
      expires_at: entry.expires_at,
      source: entry.source
        ? {
            kind: entry.source.kind,
            message_id: entry.source.message_id,
            quote: entry.source.quote
          }
        : null
    });
    setSourceId(entry.source?.message_id ?? "");
    setQuote(entry.source?.quote ?? "");
    setSourceKind(entry.source?.kind ?? "chat_message");
  }
  async function saveEntry() {
    const source = sourceId.trim()
      ? { kind: sourceKind, message_id: sourceId.trim(), quote }
      : null;
    const value = { ...draft, source };
    if (editing)
      await json(
        "/api/v1/memory/" + encodeURIComponent(editing.id),
        body({ ...value, expected_version: editing.version })
      );
    else {
      creationId.current ??= crypto.randomUUID();
      await json(
        "/api/v1/memory",
        body({ ...value, client_creation_id: creationId.current }, "POST")
      );
    }
    if (life.current?.signal.aborted) return;
    reset();
    await refreshEntries();
    setNotice("Запись сохранена.");
  }
  const checked = (key: "source_chat_ids" | "project_ids", id: string, value: boolean) => {
    if (settings)
      setSettings({
        ...settings,
        [key]: value ? [...settings[key], id] : settings[key].filter((v) => v !== id)
      });
  };
  async function openSource(reference: string, offset = 0) {
    const result = await json<{
      content: string;
      next_offset: number | null;
      source: NonNullable<ContextMemoryEntry["source"]>;
    }>(base + "/source?reference=" + encodeURIComponent(reference) + "&offset=" + offset);
    if (!life.current?.signal.aborted) setOpenedSource({ ...result, reference });
  }
  return (
    <fieldset disabled={disabled || busy} aria-label="Общая память и источники">
      <legend>Общая память и источники</legend>
      <p>
        Выберите, что разрешено учитывать в этом {target.kind === "chat" ? "чате" : "проекте"}.
        Записи памяти не дают разрешений на действия.
      </p>
      {settings && (
        <>
          {canCompact && (
            <label>
              <input
                type="checkbox"
                checked={Boolean(settings.compact_history)}
                onChange={(e) => setSettings({ ...settings, compact_history: e.target.checked })}
              />
              Автоматически сжимать старую историю
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            Использовать общую память
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.use_personal}
              onChange={(e) => setSettings({ ...settings, use_personal: e.target.checked })}
            />
            Использовать мой общий профиль
          </label>
          <details>
            <summary>Чаты и проекты для поиска</summary>
            <p>
              История текущего пространства доступна после включения памяти. Другие источники
              выбираются отдельно.
            </p>
            {chats.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={settings.source_chat_ids.includes(c.id)}
                  onChange={(e) => checked("source_chat_ids", c.id, e.target.checked)}
                />
                {c.title}
              </label>
            ))}
            {settings.source_chat_ids
              .filter((id) => !chats.some((c) => c.id === id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => checked("source_chat_ids", id, false)}
                  />
                  Недоступный чат: {id}
                </label>
              ))}
            {projects.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={settings.project_ids.includes(p.id)}
                  onChange={(e) => checked("project_ids", p.id, e.target.checked)}
                />
                Проект: {p.title}
              </label>
            ))}
            {settings.project_ids
              .filter((id) => !projects.some((p) => p.id === id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => checked("project_ids", id, false)}
                  />
                  Недоступный проект: {id}
                </label>
              ))}
          </details>
          <button
            type="button"
            onClick={() =>
              void operation(async () => {
                const saved = await json<Settings>(
                  base + "/settings",
                  body({ ...settings, expected_version: settings.version, version: undefined })
                );
                if (!life.current?.signal.aborted) {
                  setSettings(saved);
                  setNotice("Доступ к памяти сохранён.");
                }
              })
            }
          >
            Сохранить доступ к памяти
          </button>
        </>
      )}
      <button type="button" onClick={() => void operation(load)}>
        Обновить общую память
      </button>
      <ProfileCandidates target={target} onSaved={() => refreshEntries()} openSource={openSource} />
      <details>
        <summary>Записи памяти</summary>
        <p>
          Здесь ваши записи из разных пространств. В ответ попадут только разрешённые и подходящие к
          задаче. Удаление записи также удаляет её версии; исходная переписка сохраняется и остаётся
          доступной для поиска, пока этот чат выбран источником.
        </p>
        <ul>
          {items.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.title}</strong>
              <p>{entry.content}</p>
              <small>
                {kinds[entry.kind]} ·{" "}
                {entry.scope === "personal"
                  ? "Общий профиль"
                  : entry.scope === "chat"
                    ? "Чат"
                    : "Проект"}{" "}
                · v{entry.version} · {labels[entry.source_status]}
              </small>
              {entry.expires_at && (
                <p>Актуально до {new Date(entry.expires_at).toLocaleString("ru-RU")}</p>
              )}
              {entry.source && (
                <p>
                  {entry.source.role === "assistant" ? "Ответ ИИ" : "Сообщение пользователя"} ·{" "}
                  {entry.source.quote}
                </p>
              )}
              <div>
                <button type="button" onClick={() => edit(entry)}>
                  Изменить «{entry.title}»
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void operation(async () => {
                      await json(
                        "/api/v1/memory/" + encodeURIComponent(entry.id),
                        body({ expected_version: entry.version }, "DELETE")
                      );
                      if (editing?.id === entry.id) reset();
                      await refreshEntries();
                      setVersions(null);
                      setNotice("Запись и её версии удалены. Исходная переписка сохранена.");
                    })
                  }
                >
                  Забыть «{entry.title}»
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void operation(async () => {
                      const result = await json<{ items: ContextMemoryEntry[] }>(
                        "/api/v1/memory/" + encodeURIComponent(entry.id) + "/versions"
                      );
                      if (!life.current?.signal.aborted) setVersions(result.items);
                    })
                  }
                >
                  Версии «{entry.title}»
                </button>
              </div>
            </li>
          ))}
        </ul>
        {nextOffset !== null && (
          <button
            type="button"
            onClick={() => void operation(() => refreshEntries(nextOffset, true))}
          >
            Ещё записи памяти
          </button>
        )}
        {!items.length && <p>Сохранённых записей пока нет.</p>}
        {versions && (
          <section aria-label="История записи">
            <p>Исторические версии не используются для ответов.</p>
            {versions.map((v) => (
              <p key={v.version}>
                v{v.version}: {v.content}
              </p>
            ))}
          </section>
        )}
        <fieldset>
          <legend>{editing ? "Изменение записи" : "Новая запись"}</legend>
          <label>
            Область записи
            <select
              value={
                draft.scope === "personal"
                  ? "personal"
                  : draft.scope === target.kind && draft.scope_id === target.id
                    ? "current"
                    : "original"
              }
              onChange={(e) => {
                if (e.target.value === "original" && editing)
                  setDraft({ ...draft, scope: editing.scope, scope_id: editing.scope_id });
                else
                  setDraft({
                    ...draft,
                    scope: e.target.value === "personal" ? "personal" : target.kind,
                    scope_id: e.target.value === "personal" ? null : target.id
                  });
              }}
            >
              <option value="current">
                Только текущий {target.kind === "chat" ? "чат" : "проект"}
              </option>
              <option value="personal">Общий профиль</option>
              {editing &&
                editing.scope !== "personal" &&
                (editing.scope !== target.kind || editing.scope_id !== target.id) && (
                  <option value="original">Исходное пространство: {editing.scope_id}</option>
                )}
            </select>
          </label>
          <label>
            Тип записи
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as ContextMemoryInput["kind"] })
              }
            >
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Название воспоминания
            <input
              maxLength={160}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Содержание воспоминания
            <textarea
              rows={3}
              maxLength={2000}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.pinned}
              onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            />
            Сохранять приоритет записи
          </label>
          <label>
            Актуально до (необязательно)
            <input
              type="date"
              value={localDay(draft.expires_at)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  expires_at: e.target.value
                    ? new Date(e.target.value + "T23:59:59.999").toISOString()
                    : null
                })
              }
            />
          </label>
          <details>
            <summary>Привязать к исходному сообщению</summary>
            <p>
              Нужны ID и точная цитата. Система проверит доступ и совпадение. Без привязки это
              ручная запись владельца.
            </p>
            <label>
              Вид источника
              <select
                value={sourceKind}
                onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}
              >
                <option value="chat_message">Сообщение обычного чата</option>
                <option value="project_message">Сообщение проекта</option>
              </select>
            </label>
            <label>
              ID сообщения
              <input
                maxLength={128}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              />
            </label>
            <label>
              Точная цитата
              <textarea maxLength={2000} value={quote} onChange={(e) => setQuote(e.target.value)} />
            </label>
          </details>
          <button
            type="button"
            disabled={
              !draft.title.trim() || !draft.content.trim() || Boolean(sourceId && !quote.trim())
            }
            onClick={() => void operation(saveEntry)}
          >
            {editing ? "Сохранить воспоминание" : "Добавить воспоминание"}
          </button>
          <button type="button" onClick={reset}>
            Очистить форму воспоминания
          </button>
        </fieldset>
      </details>
      <details>
        <summary>Проверить, что вспомнит ИИ</summary>
        <label>
          Запрос для проверки памяти
          <input maxLength={1000} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() =>
            void operation(async () => {
              const value = await json<ContextMemoryBundle>(
                base + "/context",
                body({ query }, "POST")
              );
              if (!life.current?.signal.aborted) setPreview(value);
            })
          }
        >
          Проверить подбор контекста
        </button>
        <p>
          Локальный поиск по словам; модель не вызывается. Используются сохранённые настройки
          доступа.
        </p>
        {canCompact && (
          <button
            type="button"
            onClick={() =>
              void operation(async () => {
                const value = await json<HistoryCompactionPreview>(
                  "/api/v1/chats/" + encodeURIComponent(target.id) + "/history-compaction/preview",
                  body({ query: query.trim() || "Продолжить работу" }, "POST")
                );
                if (!life.current?.signal.aborted) setCompression(value);
              })
            }
          >
            Проверить сжатие истории
          </button>
        )}
        {compression && (
          <section aria-label="Проверка сжатия истории">
            <p>
              Метод: точные цитаты с источниками. Оригинальная переписка сохраняется. Отдельного
              вызова ИИ нет.
            </p>
            <p>
              {
                {
                  off: "Сжатие выключено. Включите память и сжатие, затем сохраните настройки.",
                  short_history: "История пока короткая — сжатие не требуется.",
                  manual_summary:
                    "Используется ваша ручная сводка. Автоматическое сжатие её не заменяет.",
                  unsupported_material:
                    "В старой истории есть файлы, код или незавершённые ответы. Они требуют отдельной обработки.",
                  input_limit:
                    "История превышает предел одного прохода. Автоматическое сжатие пропущено.",
                  protected_budget:
                    "Важные фрагменты не поместились. Ответ будет остановлен до отправки модели.",
                  no_saving: "Сжатие не уменьшает объём — сохранена обычная обработка.",
                  ready: "История сокращена. Выделенные важные фрагменты проверены по оригиналам."
                }[compression.report.reason]
              }
            </p>
            <p>
              Сообщений в сокращённой части: {compression.report.compacted_messages}. Важных
              фрагментов: {compression.report.protected_kept} / {compression.report.protected_spans}
              . Повторов найдено: {compression.report.duplicate_spans}.
            </p>
            {compression.before_input_upper_bound !== null &&
              compression.after_input_upper_bound !== null && (
                <p>
                  Оценка входного контекста: {compression.before_input_upper_bound} →{" "}
                  {compression.after_input_upper_bound}. Это верхняя оценка, а не фактические токены
                  провайдера. Новые вложения и Skills в этой проверке не учитываются.
                </p>
              )}
            {compression.report.sensitive_messages > 0 && (
              <p>
                Из пакета исключены сообщения с распознанными учётными данными:{" "}
                {compression.report.sensitive_messages}.
              </p>
            )}
            {compression.dispatch_blocked && (
              <p role="alert">
                Важные условия не поместились вместе с запросом. Уменьшите вложения или измените
                настройки сжатия.
              </p>
            )}
            <p>
              Проверяется сохранность распознанных условий и точных цитат. Это не гарантия
              сохранения всех смысловых связей.
            </p>
            {compression.memory?.items.map((item, index) => (
              <article key={item.reference + ":" + index}>
                <strong>
                  {item.source?.role === "assistant" ? "Ответ ИИ" : "Сообщение пользователя"}
                </strong>
                <p>{item.text}</p>
                <button
                  type="button"
                  onClick={() => void operation(() => openSource(item.reference))}
                >
                  Открыть исходное сообщение
                </button>
              </article>
            ))}
          </section>
        )}
        {preview && (
          <section aria-label="Подобранный контекст">
            <p>
              {preview.items.length} фрагментов · {preview.bytes} / {preview.budget_bytes} байт · не
              вошло: {preview.omitted}
            </p>
            {preview.priority_omitted > 0 && (
              <p role="alert">
                Не поместились обязательные или закреплённые записи: {preview.priority_omitted}.
                Запуск ответа будет остановлен до сокращения этих записей или изменения доступа.
              </p>
            )}
            {!preview.items.length && <p>Подходящих разрешённых сведений не найдено.</p>}
            {preview.items.map((item) => (
              <article key={item.reference}>
                <strong>{item.kind === "history" ? "Из переписки" : item.title}</strong>
                {item.kind === "history" && (
                  <p>
                    {new Date(item.title).toLocaleString("ru-RU")} ·{" "}
                    {item.source?.role === "assistant" ? "Ответ ИИ" : "Сообщение пользователя"}
                  </p>
                )}
                <p>{item.text}</p>
                {item.excerpt_only && <p>Выдержка из сообщения.</p>}
                {item.source && (
                  <button
                    title={item.reference}
                    type="button"
                    onClick={() => void operation(() => openSource(item.reference))}
                  >
                    Открыть исходное сообщение
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
      </details>
      {openedSource && (
        <section aria-label="Исходное сообщение">
          <a
            href={
              openedSource.source.kind === "chat_message"
                ? "/?chat=" + encodeURIComponent(openedSource.source.chat_id)
                : "/?project=" + encodeURIComponent(openedSource.source.project_id!)
            }
          >
            Открыть чат-источник
          </a>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {openedSource.content}
          </pre>
          {openedSource.next_offset !== null && (
            <button
              type="button"
              onClick={() =>
                void operation(() => openSource(openedSource.reference, openedSource.next_offset!))
              }
            >
              Следующая часть источника
            </button>
          )}
        </section>
      )}
      {busy && <p role="status">Обновление общей памяти…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
