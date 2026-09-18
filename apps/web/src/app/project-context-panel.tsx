"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./project-context.module.css";

type ProjectContextSource = {
  id: string;
  title: string;
  kind: "document" | "project-history" | "workspace";
  summary: string;
  size: number;
  connected: boolean;
};

type ProjectContextState = {
  sources: ProjectContextSource[];
};

const CONTEXT_LIMIT = 64_000;
const MAX_LOCAL_SOURCES = 10;

const DEFAULT_CONTEXT_SOURCES: ProjectContextSource[] = [
  {
    id: "project-history",
    title: "История проекта",
    kind: "project-history",
    summary: "Краткое резюме решений, сообщений и checkpoint текущего проекта.",
    size: 8_200,
    connected: true
  },
  {
    id: "readme",
    title: "README.md",
    kind: "document",
    summary: "Границы продукта, безопасный runtime и команды локального запуска.",
    size: 5_600,
    connected: true
  },
  {
    id: "handoff",
    title: "Project handoff",
    kind: "document",
    summary: "Канонический handoff без ключей, токенов и значений секретов.",
    size: 12_400,
    connected: false
  }
];

const redactContextText = (value: string): string =>
  value
    .replace(
      /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/gi,
      "[скрыто]"
    )
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s,"']+/gi, "$1=[скрыто]");

const contextStorageKey = (projectId: string): string => `cosmora:project-context:${projectId}`;

const formatTokens = (value: number): string =>
  String(Math.max(0, Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const isContextKind = (value: unknown): value is ProjectContextSource["kind"] =>
  value === "document" || value === "project-history" || value === "workspace";

const sanitizeSources = (value: unknown): ProjectContextSource[] | null => {
  if (!Array.isArray(value)) return null;

  const sources: ProjectContextSource[] = [];
  for (const candidate of value.slice(0, MAX_LOCAL_SOURCES)) {
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      !isContextKind(item.kind) ||
      typeof item.summary !== "string" ||
      typeof item.size !== "number" ||
      !Number.isFinite(item.size) ||
      typeof item.connected !== "boolean"
    ) {
      return null;
    }

    sources.push({
      id: item.id.slice(0, 120),
      title: item.title.slice(0, 500),
      kind: item.kind,
      summary: item.summary.slice(0, 2_000),
      size: Math.min(CONTEXT_LIMIT, Math.max(0, Math.round(item.size))),
      connected: item.connected
    });
  }

  return sources;
};

export function ProjectContextPanel({
  projectId,
  projectTitle,
  messageCount
}: {
  projectId: string;
  projectTitle: string;
  messageCount: number;
}) {
  const [state, setState] = useState<ProjectContextState>({
    sources: DEFAULT_CONTEXT_SOURCES
  });
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [preview, setPreview] = useState<ProjectContextSource | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setHydratedProjectId(null);
    setPreview(null);
    setConfirmClear(false);
    setOnline(window.navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    try {
      const raw = window.localStorage.getItem(contextStorageKey(projectId));
      if (!raw) {
        setState({ sources: DEFAULT_CONTEXT_SOURCES });
        setStorageError(null);
      } else {
        const parsed = JSON.parse(raw) as Partial<ProjectContextState>;
        const sources = sanitizeSources(parsed.sources);
        if (!sources) throw new Error("invalid context state");
        setState({ sources });
        setStorageError(null);
      }
    } catch {
      setState({ sources: DEFAULT_CONTEXT_SOURCES });
      setStorageError("Локальное состояние повреждено. Показаны безопасные mock-данные.");
    } finally {
      setHydratedProjectId(projectId);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [projectId]);

  useEffect(() => {
    if (hydratedProjectId !== projectId) return;
    try {
      window.localStorage.setItem(contextStorageKey(projectId), JSON.stringify(state));
    } catch {
      setStorageError("Не удалось сохранить состояние контекста в этом браузере.");
    }
  }, [hydratedProjectId, projectId, state]);

  const connected = useMemo(
    () => state.sources.filter((source) => source.connected),
    [state.sources]
  );
  const used = connected.reduce((total, source) => total + source.size, 0);
  const percent = Math.min(100, Math.round((used / CONTEXT_LIMIT) * 100));
  const historySummary =
    messageCount === 0
      ? "В проекте пока нет сообщений. История появится после первой работы с Менеджером."
      : [
          `${projectTitle}: ${messageCount} сообщений.`,
          "Контекст хранит только выбранные источники и краткие резюме; секреты не отображаются."
        ].join(" ");

  const toggleSource = (source: ProjectContextSource): void => {
    if (!source.connected) {
      setPreview(source);
      return;
    }
    setState((current) => ({
      sources: current.sources.map((item) =>
        item.id === source.id ? { ...item, connected: false } : item
      )
    }));
  };

  const connectPreview = (): void => {
    if (!preview) return;
    setState((current) => ({
      sources: current.sources.map((item) =>
        item.id === preview.id ? { ...item, connected: true } : item
      )
    }));
    setPreview(null);
  };

  const clearContext = (): void => {
    setState((current) => ({
      sources: current.sources.map((source) => ({ ...source, connected: false }))
    }));
    setConfirmClear(false);
  };

  if (hydratedProjectId !== projectId) {
    return (
      <div className={styles.state} role="status">
        <strong>Загружаем контекст проекта…</strong>
        <p>Читаем только локальные настройки интерфейса.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel} role="tabpanel" aria-label="Контекст проекта">
      <header className={styles.header}>
        <div>
          <small>Project context · web preview</small>
          <h2>Контекст проекта</h2>
          <p>
            Выбирайте безопасные mock-источники для preview. Ключи, токены и секреты не
            отображаются.
          </p>
        </div>
        <span className={online ? styles.online : styles.offline}>
          {online ? "Локальное состояние доступно" : "Offline · изменения сохраняются локально"}
        </span>
      </header>

      {storageError && (
        <div className={styles.error} role="alert">
          {storageError}
        </div>
      )}

      <section className={styles.meter} aria-label="Размер контекста">
        <div className={styles.meterHeader}>
          <span>Использовано</span>
          <strong>
            {formatTokens(used)} / {formatTokens(CONTEXT_LIMIT)} токенов
          </strong>
        </div>
        <div className={styles.track} aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </div>
        <small>{percent}% лимита · mock estimate, backend-контракт не подключён</small>
      </section>

      <section className={styles.history} aria-label="Резюме истории проекта">
        <small>Краткая история</small>
        <p>{redactContextText(historySummary)}</p>
      </section>

      <section className={styles.sources} aria-labelledby="context-sources-title">
        <div className={styles.sectionTitle}>
          <div>
            <small>Источники</small>
            <h3 id="context-sources-title">
              Подключено {connected.length} из {state.sources.length}
            </h3>
          </div>
          <button
            type="button"
            className={styles.danger}
            disabled={connected.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            Очистить контекст
          </button>
        </div>

        {state.sources.length === 0 ? (
          <div className={styles.empty}>
            <strong>Источников пока нет</strong>
            <p>Произвольная загрузка файлов отключена.</p>
          </div>
        ) : (
          <div className={styles.sourceList}>
            {state.sources.map((source) => (
              <article key={source.id} className={source.connected ? styles.connected : undefined}>
                <div>
                  <span className={styles.kind}>
                    {source.kind === "document"
                      ? "Документ"
                      : source.kind === "project-history"
                        ? "История"
                        : "Workspace"}
                  </span>
                  <strong>{redactContextText(source.title)}</strong>
                  <p>{redactContextText(source.summary)}</p>
                  <small>{formatTokens(source.size)} токенов · mock estimate</small>
                </div>
                <button type="button" onClick={() => toggleSource(source)}>
                  {source.connected ? "Отключить" : "Подключить"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className={styles.boundary}>
        Browser-local preview only. Новая БД, миграции, загрузка файлов и runtime authority не
        используются.
      </p>

      {preview && (
        <div className={styles.backdrop} role="presentation">
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-preview-title"
          >
            <small>Предпросмотр перед добавлением</small>
            <h3 id="context-preview-title">{redactContextText(preview.title)}</h3>
            <p>{redactContextText(preview.summary)}</p>
            <dl>
              <div>
                <dt>Тип</dt>
                <dd>{preview.kind}</dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>{formatTokens(preview.size)} токенов</dd>
              </div>
            </dl>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondary} onClick={() => setPreview(null)}>
                Отмена
              </button>
              <button type="button" onClick={connectPreview}>
                Подключить источник
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmClear && (
        <div className={styles.backdrop} role="presentation">
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-clear-title"
          >
            <small>Явное подтверждение</small>
            <h3 id="context-clear-title">Очистить контекст проекта?</h3>
            <p>
              Будут отключены только локальные context-источники. История чата, проект и документы
              не удаляются.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setConfirmClear(false)}
              >
                Отмена
              </button>
              <button type="button" className={styles.dangerAction} onClick={clearContext}>
                Очистить контекст
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
