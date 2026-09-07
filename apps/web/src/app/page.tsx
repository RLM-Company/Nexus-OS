"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Project = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "FAILED" | "ARCHIVED";
  created_at: string;
  updated_at: string;
};

type ProjectSummary = Project & { last_message_preview: string | null };

type Message = {
  id: string;
  project_id: string;
  chat_id: string;
  role: "user" | "assistant" | "system_event";
  content_type: "text";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  reply_to_message_id: string | null;
  run_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

type AcceptedResponse = {
  project: Project;
  chat_id: string;
  user_message: Message;
  run_id: string;
  stream_url: string;
};

type CancelledRun = { run_id: string; status: "cancelled" };

type ProjectDetail = { project: Project; chat_id: string; messages: Message[] };

type AutonomyProfile = {
  base_level: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  version: number;
};

type ModelRuntimeStatus = {
  mode: "mock" | "openai-compatible";
  provider: "mock" | "primary";
  model: string;
  credential_configured: boolean;
  fallback_to_mock: boolean;
};

type RunPhase = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";

const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  idle: "Готов",
  queued: "В очереди",
  running: "Менеджер отвечает",
  completed: "Ответ получен",
  failed: "Ошибка запуска",
  cancelled: "Остановлен"
};

const PROJECT_STATUS_LABEL: Record<Project["status"], string> = {
  DRAFT: "Черновик",
  ACTIVE: "Активен",
  FAILED: "Требует внимания",
  ARCHIVED: "В архиве"
};

const SparkIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 2l1.55 5.3L19 9l-5.45 1.7L12 16l-1.55-5.3L5 9l5.45-1.7L12 2Z" />
    <path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z" />
  </svg>
);

const GridIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </svg>
);

const ShieldIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const SendIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="m4 4 17 8-17 8 3-8-3-8Z" />
    <path d="M7 12h14" />
  </svg>
);

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Cosmora API returned ${response.status}`);
  }
  return (await response.json()) as T;
};

const clientId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const displayedContent = (message: Message): string | null => {
  if (message.status === "cancelled") return "Запуск остановлен владельцем.";
  if (message.status === "failed")
    return `Запуск завершился с ошибкой: ${message.error_code ?? "UNKNOWN"}.`;
  if (message.content) return message.content;
  return null;
};

const restoredRunPhase = (messages: Message[]): RunPhase => {
  const latestRunMessage = [...messages].reverse().find((message) => message.run_id !== null);
  if (!latestRunMessage?.run_id) return "idle";
  const runId = latestRunMessage.run_id;

  const latestRunMessages = messages.filter((message) => message.run_id === runId);
  const assistant = [...latestRunMessages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!assistant) {
    return latestRunMessages.some((message) => message.role === "user") ? "queued" : "idle";
  }

  if (assistant.status === "pending" || assistant.status === "streaming") return "running";
  if (assistant.status === "completed") return "completed";
  if (assistant.status === "failed") return "failed";
  return "cancelled";
};

const messagePlaceholder = (
  id: string,
  projectId: string,
  chatId: string,
  runId: string
): Message => {
  const timestamp = new Date().toISOString();
  return {
    id,
    project_id: projectId,
    chat_id: chatId,
    role: "assistant",
    content_type: "text",
    content: "",
    status: "streaming",
    reply_to_message_id: null,
    run_id: runId,
    error_code: null,
    created_at: timestamp,
    updated_at: timestamp
  };
};

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [autonomyProfile, setAutonomyProfile] = useState<AutonomyProfile | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ModelRuntimeStatus | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const streamRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadProjects = useCallback(async () => {
    const data = await api<{ items: ProjectSummary[] }>("/api/v1/projects");
    setProjects(data.items);
  }, []);

  useEffect(() => {
    void Promise.all([
      loadProjects(),
      api<ModelRuntimeStatus>("/api/v1/model-runtime").then(setRuntime)
    ])
      .catch(() => setError("API Cosmora пока недоступен. Запусти web и api вместе."))
      .finally(() => setLoading(false));
    return () => streamRef.current?.close();
  }, [loadProjects]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const loadProjectView = useCallback(async (projectId: string) => {
    const [detail, profileResponse] = await Promise.all([
      api<ProjectDetail>(`/api/v1/projects/${projectId}`),
      api<{ profile: AutonomyProfile }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/autonomy-profile`
      ).catch(() => null)
    ]);
    setActiveProject(detail.project);
    setChatId(detail.chat_id);
    setMessages(detail.messages);
    setRunPhase(restoredRunPhase(detail.messages));
    setAutonomyProfile(profileResponse?.profile ?? null);
  }, []);

  const openProject = async (projectId: string): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      await loadProjectView(projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось открыть проект");
    } finally {
      setLoading(false);
    }
  };

  const refreshProject = useCallback(
    async (projectId: string) => {
      await loadProjectView(projectId);
      await loadProjects();
    },
    [loadProjectView, loadProjects]
  );

  const followStream = (accepted: AcceptedResponse): void => {
    streamRef.current?.close();
    setActiveRunId(accepted.run_id);
    const source = new EventSource(accepted.stream_url);
    streamRef.current = source;
    let assistantId: string | null = null;
    let finished = false;

    source.addEventListener("run.started", () => {
      setRunPhase("running");
    });

    source.addEventListener("message.started", (raw) => {
      const event = JSON.parse(String(raw.data)) as {
        data: { message_id: string; run_id: string };
      };
      assistantId = event.data.message_id;
      setMessages((current) => {
        if (current.some((message) => message.id === assistantId)) return current;
        return [
          ...current,
          messagePlaceholder(
            event.data.message_id,
            accepted.project.id,
            accepted.chat_id,
            event.data.run_id
          )
        ];
      });
    });

    source.addEventListener("message.delta", (raw) => {
      const event = JSON.parse(String(raw.data)) as {
        data: { message_id: string; delta: string };
      };
      assistantId = event.data.message_id;
      setMessages((current) =>
        current.map((message) =>
          message.id === event.data.message_id
            ? { ...message, content: message.content + event.data.delta }
            : message
        )
      );
    });

    source.addEventListener("run.completed", () => {
      finished = true;
      source.close();
      setSending(false);
      setActiveRunId(null);
      setRunPhase("completed");
      void refreshProject(accepted.project.id).catch(() => {
        if (assistantId) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, status: "completed" } : message
            )
          );
        }
      });
    });

    source.addEventListener("run.failed", (raw) => {
      finished = true;
      source.close();
      const event = JSON.parse(String(raw.data)) as { data: { error_code: string } };
      setSending(false);
      setActiveRunId(null);
      setRunPhase("failed");
      setError(`Запуск остановлен: ${event.data.error_code}`);
    });

    source.addEventListener("run.cancelled", () => {
      finished = true;
      source.close();
      setSending(false);
      setActiveRunId(null);
      setRunPhase("cancelled");
      void refreshProject(accepted.project.id);
    });

    source.onerror = () => {
      source.close();
      if (!finished) {
        setSending(false);
        setActiveRunId(null);
        setRunPhase("failed");
        setError("Поток ответа прерван. Сообщения уже сохранены — открой проект повторно.");
      }
    };
  };

  const cancelRun = async (): Promise<void> => {
    if (!activeRunId || !activeProject) return;
    setError(null);
    try {
      await api<CancelledRun>(`/api/v1/runs/${activeRunId}/cancel`, { method: "POST" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось остановить запуск");
      return;
    }
    streamRef.current?.close();
    setSending(false);
    setActiveRunId(null);
    setRunPhase("cancelled");
    await refreshProject(activeProject.id);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setRunPhase("queued");
    setError(null);
    setDraft("");
    try {
      const accepted = activeProject
        ? await api<AcceptedResponse>(`/api/v1/projects/${activeProject.id}/messages`, {
            method: "POST",
            body: JSON.stringify({ content, client_message_id: clientId() })
          })
        : await api<AcceptedResponse>("/api/v1/projects", {
            method: "POST",
            body: JSON.stringify({ initial_message: content, client_message_id: clientId() })
          });

      setActiveProject(accepted.project);
      setChatId(accepted.chat_id);
      setMessages((current) =>
        activeProject ? [...current, accepted.user_message] : [accepted.user_message]
      );
      void api<{ profile: AutonomyProfile }>(
        `/api/v1/projects/${encodeURIComponent(accepted.project.id)}/autonomy-profile`
      )
        .then((response) => setAutonomyProfile(response.profile))
        .catch(() => setAutonomyProfile(null));
      await loadProjects();
      followStream(accepted);
    } catch (cause) {
      setDraft(content);
      setSending(false);
      setRunPhase("failed");
      setError(cause instanceof Error ? cause.message : "Не удалось отправить сообщение");
    }
  };

  const newProject = (): void => {
    streamRef.current?.close();
    setActiveProject(null);
    setChatId(null);
    setMessages([]);
    setAutonomyProfile(null);
    setDraft("");
    setSending(false);
    setActiveRunId(null);
    setRunPhase("idle");
    setError(null);
  };

  const controlCenterHref = activeProject
    ? `/control-center?project=${encodeURIComponent(activeProject.id)}`
    : "/control-center";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <SparkIcon />
          </span>
          <span>Cosmora</span>
          <span className="version">Console</span>
        </div>

        <button className="new-project" onClick={newProject}>
          <span>＋</span> Новый проект
        </button>

        <nav className="navigation" aria-label="Основная навигация">
          <button className={!activeProject ? "nav-item active" : "nav-item"} onClick={newProject}>
            <GridIcon /> Рабочая область
          </button>
          <Link
            className="nav-item"
            href={
              activeProject
                ? `/agent-studio?project=${encodeURIComponent(activeProject.id)}`
                : "/agent-studio"
            }
          >
            <ShieldIcon /> Agent Studio
          </Link>
          <Link className="nav-item" href={controlCenterHref}>
            <ShieldIcon /> Control Center
          </Link>
          <span className="nav-label">Проекты</span>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.id}
                className={
                  activeProject?.id === project.id ? "project-item active" : "project-item"
                }
                onClick={() => void openProject(project.id)}
              >
                <span className="project-glyph">{project.title.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.last_message_preview ?? "Новый проект"}</small>
                </span>
              </button>
            ))}
            {!loading && projects.length === 0 && (
              <p className="empty-projects">Первый проект появится после отправки задачи.</p>
            )}
          </div>
        </nav>

        <div className="profile">
          <span className="avatar">M</span>
          <span>
            <strong>Владелец</strong>
            <small>Локальный контур</small>
          </span>
          <span className="profile-dot" />
        </div>
      </aside>

      <main className={activeProject ? "workspace chat-workspace" : "workspace"} id="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{activeProject ? "Активный проект" : "Рабочая область"}</span>
            <h1>{activeProject?.title ?? "Cosmora Control Center"}</h1>
          </div>
          <div className="system-status" aria-label="Статус системы">
            <span>
              <i className="status-dot" />
              {runtime?.mode === "openai-compatible" ? "Провайдер готов" : "Mock-режим"}
            </span>
            <span className="privacy-badge">
              <ShieldIcon />
              Данные под контролем
            </span>
          </div>
        </header>

        {activeProject && (
          <section className="project-facts" aria-label="Информация о проекте">
            <span>
              <small>Статус проекта</small>
              <strong>{PROJECT_STATUS_LABEL[activeProject.status]}</strong>
            </span>
            <span>
              <small>Автономность</small>
              <strong>
                {autonomyProfile
                  ? `${autonomyProfile.base_level} · v${autonomyProfile.version}`
                  : "Недоступно"}
              </strong>
            </span>
            <span>
              <small>Обновлён</small>
              <strong>
                {new Date(activeProject.updated_at).toLocaleString("ru", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </strong>
            </span>
            <span>
              <small>Сообщений</small>
              <strong>{messages.length}</strong>
            </span>
          </section>
        )}

        <div className="mobile-project-strip" aria-label="Быстрый выбор проекта">
          <button className={!activeProject ? "active" : ""} onClick={newProject}>
            ＋ Новый
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              className={activeProject?.id === project.id ? "active" : ""}
              onClick={() => void openProject(project.id)}
            >
              {project.title}
            </button>
          ))}
        </div>

        {activeProject ? (
          <section className="chat-panel" aria-label="Главный чат проекта">
            <div className="chat-heading">
              <span className="manager-avatar">
                <SparkIcon />
              </span>
              <div>
                <strong>Cosmora Manager</strong>
                <small>
                  {runtime?.mode === "openai-compatible"
                    ? `${runtime.model} · fallback ${runtime.fallback_to_mock ? "включён" : "выключен"}`
                    : "MockProvider · история сохраняется"}
                </small>
              </div>
              <span className={`live-badge ${runPhase}`} role="status" aria-live="polite">
                <i /> {RUN_PHASE_LABEL[runPhase]}
              </span>
            </div>
            <div className="messages" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span className="message-avatar">
                    {message.role === "user" ? "M" : <SparkIcon />}
                  </span>
                  <div>
                    <header>
                      <strong>{message.role === "user" ? "Вы" : "Cosmora Manager"}</strong>
                      <time>
                        {new Date(message.created_at).toLocaleTimeString("ru", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </time>
                    </header>
                    <p>
                      {displayedContent(message) || (
                        <span className="typing">
                          Формирую ответ<span>…</span>
                        </span>
                      )}
                    </p>
                  </div>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </section>
        ) : (
          <>
            <section className="hero">
              <div className="hero-symbol">
                <SparkIcon />
              </div>
              <span className="eyebrow">Первый рабочий сценарий</span>
              <h2>
                От задачи —<br />к управляемому проекту
              </h2>
              <p>
                Опишите результат. Cosmora создаст проект, сохранит контекст и откроет главный чат с
                менеджером.
              </p>
            </section>
            <section className="foundation-grid" aria-label="Возможности текущего этапа">
              <article className="foundation-card accent-card">
                <span className="card-icon">
                  <GridIcon />
                </span>
                <div>
                  <small>Работает</small>
                  <h3>Проекты и история</h3>
                  <p>Данные переживают перезапуск.</p>
                </div>
                <span className="progress">04 / 08</span>
              </article>
              <article className="foundation-card">
                <span className="card-icon">
                  <SparkIcon />
                </span>
                <div>
                  <small>В реальном времени</small>
                  <h3>Потоковый ответ</h3>
                  <p>Первый mock-менеджер подключён.</p>
                </div>
              </article>
              <article className="foundation-card">
                <span className="card-icon">
                  <ShieldIcon />
                </span>
                <div>
                  <small>Контроль</small>
                  <h3>Локальная SQLite</h3>
                  <p>Без внешнего облака и секретов.</p>
                </div>
              </article>
            </section>
          </>
        )}

        <form
          className={activeProject ? "composer chat-composer" : "composer"}
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="task">
            {activeProject ? "Сообщение менеджеру" : "Опишите результат, который хотите получить"}
          </label>
          <textarea
            id="task"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={sending}
            placeholder={
              activeProject
                ? "Уточните задачу или добавьте требование…"
                : "Например: создай и запусти цифровой бизнес…"
            }
          />
          <div className="composer-footer">
            <span>
              {error ??
                (sending
                  ? "Cosmora выполняет запуск…"
                  : chatId
                    ? "Enter — отправить · Shift+Enter — новая строка"
                    : "Проект создастся автоматически")}
            </span>
            {sending ? (
              <button
                type="button"
                className="cancel-run"
                disabled={!activeRunId}
                onClick={() => void cancelRun()}
              >
                <span className="stop-icon" /> Остановить
              </button>
            ) : (
              <button
                disabled={!draft.trim()}
                aria-label={activeProject ? "Отправить" : "Запустить"}
              >
                <SendIcon />
                {activeProject ? "Отправить" : "Запустить"}
              </button>
            )}
          </div>
        </form>
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <button className={!activeProject ? "active" : ""} onClick={newProject}>
          <GridIcon />
          <span>Главная</span>
        </button>
        <button
          className={activeProject ? "active" : ""}
          onClick={() => projects[0] && void openProject(projects[0].id)}
        >
          <SparkIcon />
          <span>Проекты</span>
        </button>
        <Link href={controlCenterHref}>
          <ShieldIcon />
          <span>Контроль</span>
        </Link>
      </nav>
    </div>
  );
}
