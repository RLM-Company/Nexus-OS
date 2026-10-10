"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  canvasBytes,
  type CanvasArtifact,
  type CanvasFormat,
  type CanvasRevision,
  type CanvasSource
} from "@cosmora/contracts/canvas-artifacts";
import styles from "./canvas-editor.module.css";
import { canvasDraftKey, parseCanvasDraft, type CanvasDraft } from "./canvas-draft-storage";
import { CanvasPreview } from "./canvas-preview";

type Full = { artifact: CanvasArtifact; revision: CanvasRevision };
type Meta = Omit<CanvasRevision, "content">;
type Candidate = {
  title: string;
  source: Exclude<CanvasSource, { kind: "manual" } | { kind: "restore" }>;
};
type Draft = CanvasDraft;
const blank: Draft = { title: "Без названия", format: "markdown", content: "", baseVersion: 0 };
const formats: CanvasFormat[] = ["markdown", "text", "code", "html"];
const names: Record<CanvasFormat, string> = {
  markdown: "Markdown",
  text: "Текст",
  code: "Код",
  html: "HTML (текст)"
};
const endpoint = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers
    }
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { code?: string; currentVersion?: number };
    } | null;
    const error = new Error(detail?.error?.code ?? `HTTP ${response.status}`) as Error & {
      currentVersion?: number;
    };
    if (detail?.error?.currentVersion !== undefined)
      error.currentVersion = detail.error.currentVersion;
    throw error;
  }
  const result = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if (options?.signal?.aborted) throw new DOMException("Canvas scope changed", "AbortError");
  return result;
}
const sanitizeName = (value: string, format: CanvasFormat): string => {
  const extension = { markdown: "md", text: "txt", code: "txt", html: "html" }[format];
  const base =
    Array.from(value, (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character
    )
      .join("")
      .trim()
      .replace(/[\\/<>:"|?*]/g, "_")
      .slice(0, 80) || "artifact";
  return `${base}.${extension}`;
};

export function CanvasEditor({ projectId }: { projectId: string }) {
  const [scope, setScope] = useState<{ projectId: string; ownerScope: string } | null>(null);
  const [scopeError, setScopeError] = useState("");
  useEffect(() => {
    let active = true;
    setScope(null);
    setScopeError("");
    // Old unscoped drafts cannot be attributed to an owner, so never migrate their contents.
    try {
      const legacyPrefix = `kosmora:canvas:draft:${projectId}:`;
      for (const key of Object.keys(localStorage))
        if (key.startsWith(legacyPrefix)) localStorage.removeItem(key);
    } catch {
      /* Draft storage is optional. */
    }
    request<{ owner_scope: string }>(endpoint(projectId) + "/scope")
      .then((result) => {
        if (!/^[a-f0-9]{64}$/.test(result.owner_scope))
          throw new Error("Не удалось проверить аккаунт Canvas");
        if (active) setScope({ projectId, ownerScope: result.owner_scope });
      })
      .catch((error: unknown) => {
        if (active)
          setScopeError(error instanceof Error ? error.message : "Не удалось открыть Canvas");
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  if (!scope || scope.projectId !== projectId)
    return (
      <section aria-label="Редактор Canvas">
        {scopeError ? <p role="alert">{scopeError}</p> : <p role="status">Загружаем Canvas…</p>}
      </section>
    );
  return (
    <ScopedCanvasEditor
      key={`${scope.ownerScope}:${projectId}`}
      projectId={projectId}
      ownerScope={scope.ownerScope}
    />
  );
}

function ScopedCanvasEditor({ projectId, ownerScope }: { projectId: string; ownerScope: string }) {
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
    };
  }, []);
  const scopedRequest = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted)
      throw new DOMException("Canvas scope changed", "AbortError");
    return request<T>(url, { ...options, signal: controller.signal });
  }, []);
  const localKey = (projectId: string, id: string) => canvasDraftKey(ownerScope, projectId, id);
  const parseDraft = parseCanvasDraft;
  const [items, setItems] = useState<CanvasArtifact[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loaded, setLoaded] = useState<Full | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [history, setHistory] = useState<Meta[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [revisionPreview, setRevisionPreview] = useState<CanvasRevision | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = useMemo(() => endpoint(projectId), [projectId]);
  const readList = useCallback(async () => {
    const first = await scopedRequest<{ items: CanvasArtifact[] }>(base + "?limit=100");
    if (first.items.length < 100) return first.items;
    const second = await scopedRequest<{ items: CanvasArtifact[] }>(base + "?limit=100&offset=100");
    return [...first.items, ...second.items];
  }, [base, scopedRequest]);
  const dirty = loaded
    ? draft.title !== loaded.revision.title ||
      draft.format !== loaded.revision.format ||
      draft.content !== loaded.revision.content ||
      draft.baseVersion !== loaded.artifact.version
    : draft.title !== blank.title || draft.format !== blank.format || !!draft.content;
  const refresh = useCallback(async () => {
    const [list, sources] = await Promise.all([
      readList(),
      scopedRequest<{ items: Candidate[] }>(base + "/sources")
    ]);
    setItems(list);
    setCandidates(sources.items);
  }, [base, readList, scopedRequest]);
  useEffect(() => {
    let active = true;
    setSelected("");
    setLoaded(null);
    let newDraft: Draft | null = null;
    try {
      newDraft = parseDraft(localStorage.getItem(localKey(projectId, "new")), 0);
    } catch {
      /* optional */
    }
    setDraft(newDraft ?? blank);
    setConflict(null);
    setLoading(true);
    setError("");
    Promise.all([readList(), scopedRequest<{ items: Candidate[] }>(base + "/sources")])
      .then(([list, sources]) => {
        if (active) {
          setItems(list);
          setCandidates(sources.items);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить Canvas");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, readList, scopedRequest]);
  useEffect(() => {
    const id = loaded?.artifact.id ?? "new";
    try {
      if (dirty) localStorage.setItem(localKey(projectId, id), JSON.stringify(draft));
      else localStorage.removeItem(localKey(projectId, id));
    } catch {
      /* Browser storage unavailable: current editor state is still kept. */
    }
  }, [draft, dirty, loaded, projectId]);
  const open = async (id: string, discard = false) => {
    if (working) return;
    if (id === selected && !discard) return;
    if (
      dirty &&
      !discard &&
      !window.confirm("Есть несохранённый текст. Он останется в черновиках браузера. Перейти?")
    )
      return;
    setWorking(true);
    setError("");
    setNotice("");
    setRevisionPreview(null);
    setConflict(null);
    try {
      const next = await scopedRequest<Full>(`${base}/${encodeURIComponent(id)}`);
      const revisions = await scopedRequest<{ items: Meta[] }>(
        `${base}/${encodeURIComponent(id)}/revisions`
      );
      let local: Draft | null = null;
      try {
        if (discard) localStorage.removeItem(localKey(projectId, id));
        else
          local = parseDraft(localStorage.getItem(localKey(projectId, id)), next.artifact.version);
      } catch {
        /* Private browsing can disable storage. */
      }
      setLoaded(next);
      setSelected(id);
      setDraft(
        local ?? {
          title: next.revision.title,
          format: next.revision.format,
          content: next.revision.content,
          baseVersion: next.artifact.version
        }
      );
      setHistory(revisions.items);
      if (local && local.baseVersion !== next.artifact.version) setConflict(next.artifact.version);
      if (local)
        setNotice("Восстановлен локальный черновик. Проверьте изменения перед сохранением.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть артефакт");
    } finally {
      setWorking(false);
    }
  };
  const applyResult = async (result: Full, consumeDraft: boolean) => {
    setSelected(result.artifact.id);
    setLoaded(result);
    setDraft({
      title: result.revision.title,
      format: result.revision.format,
      content: result.revision.content,
      baseVersion: result.artifact.version
    });
    setConflict(null);
    setRevisionPreview(null);
    try {
      localStorage.removeItem(localKey(projectId, result.artifact.id));
      if (consumeDraft) localStorage.removeItem(localKey(projectId, selected || "new"));
    } catch {
      /* optional */
    }
    const [revisions, listing] = await Promise.allSettled([
      scopedRequest<{ items: Meta[] }>(
        `${base}/${encodeURIComponent(result.artifact.id)}/revisions`
      ),
      refresh()
    ]);
    if (revisions.status === "fulfilled") setHistory(revisions.value.items);
    else setHistory([]);
    if (listing.status === "rejected")
      setNotice("Сохранено. Список артефактов не обновился — нажмите «Обновить список».");
  };
  const perform = async (callback: () => Promise<Full>, message: string, consumeDraft = false) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await callback();
      await applyResult(result, consumeDraft);
      setNotice(message);
    } catch (e) {
      const problem = e as Error & { currentVersion?: number };
      if (problem.currentVersion !== undefined) {
        setConflict(problem.currentVersion);
        setError(
          "Версия на сервере изменилась. Ваш черновик сохранён здесь: сравните, сохраните копию или подтвердите перезапись."
        );
      } else setError(problem.message || "Не удалось сохранить");
    } finally {
      setWorking(false);
    }
  };
  const save = (newCopy = false, override = false) => {
    if (working || loading) return;
    if (
      !draft.title.trim() ||
      canvasBytes(draft.title) > CANVAS_MAX_TITLE_BYTES ||
      canvasBytes(draft.content) > CANVAS_MAX_CONTENT_BYTES
    ) {
      setError("Название или текст превышают допустимый размер.");
      return;
    }
    const payload = { title: draft.title, format: draft.format, content: draft.content };
    if (!selected || newCopy)
      void perform(
        () => scopedRequest<Full>(base, { method: "POST", body: JSON.stringify(payload) }),
        newCopy ? "Копия создана, прежний артефакт не изменён." : "Артефакт создан.",
        true
      );
    else if ((override && conflict !== null) || (!override && conflict === null)) {
      void perform(
        () =>
          scopedRequest<Full>(`${base}/${encodeURIComponent(selected)}`, {
            method: "PUT",
            body: JSON.stringify({
              ...payload,
              baseVersion: override ? conflict : draft.baseVersion
            })
          }),
        "Сохранена новая версия."
      );
    }
  };
  const createNew = () => {
    if (
      dirty &&
      !window.confirm("Несохранённый текст останется в черновике браузера. Создать новый?")
    )
      return;
    setSelected("");
    setLoaded(null);
    setHistory([]);
    let local: Draft | null = null;
    try {
      local = parseDraft(localStorage.getItem(localKey(projectId, "new")), 0);
    } catch {
      /* optional */
    }
    setDraft(local ?? blank);
    setConflict(null);
    setError("");
    setNotice("");
    setRevisionPreview(null);
  };
  const importSelected = () => {
    if (working || loading) return;
    const candidate = /^\d+$/.test(selectedSource) ? candidates[Number(selectedSource)] : undefined;
    if (!candidate) {
      setError("Выберите источник для импорта.");
      return;
    }
    if (
      dirty &&
      !window.confirm("Несохранённый текст останется в черновике браузера. Импортировать копию?")
    )
      return;
    void perform(
      () =>
        scopedRequest<Full>(base + "/import", {
          method: "POST",
          body: JSON.stringify({
            title:
              Array.from(candidate.title, (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character
              )
                .join("")
                .trim()
                .slice(0, 60) || "Импорт",
            format: "markdown",
            source: candidate.source
          })
        }),
      "Импортирована независимая редакторская копия. Источник не изменён."
    );
  };
  const restore = (version: number) => {
    if (!loaded || working) return;
    if (dirty) {
      setError(
        "Сначала сохраните черновик или создайте его копию: восстановление истории не должно стирать правки."
      );
      return;
    }
    void perform(
      () =>
        scopedRequest<Full>(`${base}/${encodeURIComponent(selected)}/restore`, {
          method: "POST",
          body: JSON.stringify({ baseVersion: loaded.artifact.version, sourceVersion: version })
        }),
      "Старая версия восстановлена как новая, история сохранена."
    );
  };
  const remove = () => {
    if (!selected || !window.confirm("Удалить этот артефакт вместе с его историей?")) return;
    setWorking(true);
    scopedRequest<void>(`${base}/${encodeURIComponent(selected)}`, { method: "DELETE" })
      .then(async () => {
        try {
          localStorage.removeItem(localKey(projectId, selected));
        } catch {
          /* optional */
        }
        setSelected("");
        setLoaded(null);
        setDraft(blank);
        setHistory([]);
        setConflict(null);
        setNotice("Артефакт удалён.");
        await refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка удаления"))
      .finally(() => setWorking(false));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setNotice("Текст скопирован.");
    } catch {
      setError("Буфер обмена недоступен. Выделите текст вручную.");
    }
  };
  const download = () => {
    const blob = new Blob([draft.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = sanitizeName(draft.title, draft.format);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Скачан текущий текст редактора (включая несохранённые правки).");
  };
  const preview = revisionPreview?.content ?? draft.content;
  const previewFormat = revisionPreview?.format ?? draft.format;
  const readHistory = async (version?: number) => {
    if (working || !selected) return;
    setWorking(true);
    try {
      if (version !== undefined) {
        const revision = await scopedRequest<CanvasRevision>(
          `${base}/${encodeURIComponent(selected)}/revisions/${version}`
        );
        setRevisionPreview(revision);
      } else {
        const page = await scopedRequest<{ items: Meta[] }>(
          `${base}/${encodeURIComponent(selected)}/revisions?limit=100&offset=${history.length}`
        );
        setHistory((current) => [...current, ...page.items]);
      }
    } catch {
      setError("Не удалось получить историю версий");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className={styles.root} aria-label="Редактор Canvas">
      <header className={styles.heading}>
        <div>
          <h2>Canvas · Артефакты</h2>
          <small>Текст, Markdown и код · хранение в проекте</small>
        </div>
        <button type="button" onClick={createNew} disabled={working}>
          + Новый
        </button>
      </header>
      <div className={styles.layout}>
        <nav className={styles.files} aria-label="Артефакты проекта">
          {loading && <p role="status">Загружаем артефакты…</p>}
          {!loading && !items.length && <p>В этом проекте пока нет артефактов.</p>}
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => void open(item.id)}
              aria-current={selected === item.id ? "page" : undefined}
              disabled={working}
            >
              <strong>{item.title}</strong>
              <small>
                {names[item.format]} · v{item.version}
              </small>
            </button>
          ))}
          <div className={styles.import}>
            <label htmlFor="canvas-source">Импорт из Work и чатов</label>
            <select
              id="canvas-source"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
            >
              <option value="">Выберите завершённый результат</option>
              {candidates.map((item, index) => (
                <option key={index} value={String(index)}>
                  {item.source.kind === "work"
                    ? "Work"
                    : item.source.kind === "chat"
                      ? "Чат"
                      : "Чат проекта"}{" "}
                  · {item.title.slice(0, 64)}
                </option>
              ))}
            </select>
            <button type="button" onClick={importSelected} disabled={working || !selectedSource}>
              Импортировать копию
            </button>
            <button
              type="button"
              onClick={() => void refresh().catch(() => setError("Не удалось обновить источники"))}
              disabled={working}
            >
              Обновить список
            </button>
          </div>
        </nav>
        <div className={styles.editor}>
          <div className={styles.fields}>
            <label>
              Название
              <input
                value={draft.title}
                disabled={working || loading}
                maxLength={CANVAS_MAX_TITLE_BYTES}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </label>
            <label>
              Формат
              <select
                value={draft.format}
                disabled={working || loading}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, format: e.target.value as CanvasFormat }))
                }
              >
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {names[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.textLabel} htmlFor="canvas-body">
            Содержимое
          </label>
          <textarea
            id="canvas-body"
            spellCheck={draft.format !== "code"}
            className={styles.textarea}
            disabled={working || loading}
            value={draft.content}
            onChange={(e) => {
              const value = e.target.value;
              if (canvasBytes(value) > CANVAS_MAX_CONTENT_BYTES) {
                setError("Достигнут лимит 512 КиБ для текста.");
                return;
              }
              setDraft((d) => ({ ...d, content: value }));
            }}
          />
          <div className={styles.count}>
            {canvasBytes(draft.content).toLocaleString("ru")} /{" "}
            {CANVAS_MAX_CONTENT_BYTES.toLocaleString("ru")} байт
            {dirty ? " · Есть несохранённые изменения" : " · Сохранено"}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={working || loading || conflict !== null}
              onClick={() => save()}
            >
              Сохранить версию
            </button>
            <button type="button" onClick={() => void copy()}>
              Копировать
            </button>
            <button type="button" onClick={download}>
              Скачать
            </button>
            {selected && (
              <button type="button" onClick={remove} disabled={working}>
                Удалить
              </button>
            )}
          </div>
          {conflict !== null && (
            <div className={styles.conflict} role="alert">
              <strong>Конфликт версий: на сервере v{conflict}</strong>
              <p>
                Ваш текст остался в редакторе. Вы можете создать копию или явно записать новую
                версию на основе последней.
              </p>
              <button type="button" onClick={() => save(true)} disabled={working}>
                Сохранить как копию
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Подтверждаете сохранение вашего черновика как следующей версии поверх изменений на сервере?"
                    )
                  )
                    save(false, true);
                }}
                disabled={working}
              >
                Подтвердить новую версию
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Удалить локальный черновик этого артефакта и открыть серверную версию?"
                    )
                  )
                    void open(selected, true);
                }}
                disabled={working}
              >
                Загрузить серверную версию
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          <div className={styles.previewHead}>
            <h3>
              {revisionPreview ? `Просмотр версии ${revisionPreview.version}` : "Предпросмотр"}
            </h3>
            {revisionPreview && (
              <button type="button" onClick={() => setRevisionPreview(null)}>
                К текущему тексту
              </button>
            )}
          </div>
          <div className={styles.preview} aria-label="Безопасный предпросмотр">
            <CanvasPreview content={preview} format={previewFormat} />
          </div>
          {previewFormat === "html" && (
            <p className={styles.count}>
              HTML показан только как текст: скрипты и внешние ресурсы не выполняются.
            </p>
          )}
          {loaded && (
            <section className={styles.history}>
              <h3>История версий</h3>
              <ol>
                {history.map((item) => (
                  <li key={item.version}>
                    <span>
                      v{item.version} · {new Date(item.created_at).toLocaleString("ru")} ·{" "}
                      {item.source.kind}
                    </span>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void readHistory(item.version)}
                    >
                      Посмотреть
                    </button>
                    <button type="button" disabled={working} onClick={() => restore(item.version)}>
                      Восстановить новой версией
                    </button>
                  </li>
                ))}
              </ol>
              {history.length >= 100 && history[history.length - 1]!.version > 1 && (
                <button type="button" disabled={working} onClick={() => void readHistory()}>
                  Показать ранние версии
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
