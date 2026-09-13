"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { InstallApp } from "./install-app";

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

type RunStreamTarget = Pick<AcceptedResponse, "project" | "chat_id" | "run_id" | "stream_url">;

type CancelledRun = { run_id: string; status: "cancelled" };

type ProjectDetail = { project: Project; chat_id: string; messages: Message[] };

type AutonomyProfile = {
  base_level: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  version: number;
};

type ModelRuntimeStatus = {
  mode: "mock" | "openai-compatible" | "anthropic-compatible";
  provider: string;
  model: string;
  credential_configured: boolean;
  fallback_to_mock: boolean;
};

type CompletedRoute = { provider: string; model: string };

type RunPhase = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";
type ProjectView = "chat" | "plan" | "project";

const isProjectView = (value: string | null): value is ProjectView =>
  value === "chat" || value === "plan" || value === "project";

const replaceConsoleRoute = (projectId: string | null, view: ProjectView = "chat"): void => {
  const route = projectId
    ? `/?project=${encodeURIComponent(projectId)}&view=${encodeURIComponent(view)}`
    : "/";
  window.history.replaceState(window.history.state, "", route);
};

type PendingConfirmation = {
  confirmation_id: string;
  operation_id: string;
  intent: { capability_ids: string[]; purpose: string };
  requires_step_up: boolean;
  expires_at: string;
};

type RecoveryRequiredOperation = {
  operation_id: string;
  capability_ids: string[];
  reasons: string[];
  reserved_at: string;
};

type PolicySignals = {
  pendingConfirmations: PendingConfirmation[] | null;
  recoveryRequired: RecoveryRequiredOperation[] | null;
};

type DemoManagerArtifact = {
  artifact_id: string;
  task_id: string;
  kind: "plan" | "analysis" | "handoff" | "checkpoint";
  content: string;
  created_at: string;
};

type DemoManagerRun = {
  demo_run_id: string;
  project_id: string;
  source_run_id: string;
  owner_goal: string;
  graph: {
    nodes: Array<{
      task_id: string;
      assigned_role: "manager" | "analyst" | "architect" | "researcher" | "critic";
      expected_output_kinds: string[];
    }>;
  };
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  checkpoint: { checkpoint_id: string; created_at: string } | null;
  artifacts: DemoManagerArtifact[];
  updated_at: string;
};

const EMPTY_POLICY_SIGNALS: PolicySignals = { pendingConfirmations: null, recoveryRequired: null };

const DEMO_RUN_STATUS_LABEL: Record<DemoManagerRun["status"], string> = {
  queued: "План готов к запуску",
  running: "Выполняется",
  succeeded: "Завершён с checkpoint",
  failed: "Требует внимания",
  cancelled: "Остановлен владельцем"
};

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

type RestoredRunState = {
  phase: RunPhase;
  activeRunId: string | null;
};

const restoredRunState = (messages: Message[]): RestoredRunState => {
  const latestRunMessage = [...messages].reverse().find((message) => message.run_id !== null);
  if (!latestRunMessage?.run_id) return { phase: "idle", activeRunId: null };
  const runId = latestRunMessage.run_id;

  const latestRunMessages = messages.filter((message) => message.run_id === runId);
  const assistant = [...latestRunMessages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!assistant) {
    return latestRunMessages.some((message) => message.role === "user")
      ? { phase: "queued", activeRunId: runId }
      : { phase: "idle", activeRunId: null };
  }

  if (assistant.status === "pending" || assistant.status === "streaming") {
    return { phase: "running", activeRunId: runId };
  }
  if (assistant.status === "completed") return { phase: "completed", activeRunId: null };
  if (assistant.status === "failed") return { phase: "failed", activeRunId: null };
  return { phase: "cancelled", activeRunId: null };
};

const recoverableUserMessage = (messages: Message[]): Message | null => {
  const latestRunMessage = [...messages].reverse().find((message) => message.run_id !== null);
  if (!latestRunMessage?.run_id) return null;
  const runId = latestRunMessage.run_id;
  const terminalAssistant = [...messages]
    .reverse()
    .find((message) => message.run_id === runId && message.role === "assistant");
  if (terminalAssistant?.status !== "failed" && terminalAssistant?.status !== "cancelled") {
    return null;
  }
  return (
    [...messages]
      .reverse()
      .find((message) => message.run_id === runId && message.role === "user") ?? null
  );
};

const latestDemoSource = (messages: Message[]): Message | null =>
  [...messages].reverse().find((message) => message.role === "user" && message.run_id !== null) ??
  null;

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
  const [policySignals, setPolicySignals] = useState<PolicySignals>(EMPTY_POLICY_SIGNALS);
  const [demoRuns, setDemoRuns] = useState<DemoManagerRun[]>([]);
  const [demoActionPending, setDemoActionPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ModelRuntimeStatus | null>(null);
  const [lastCompletedRoute, setLastCompletedRoute] = useState<CompletedRoute | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [projectView, setProjectView] = useState<ProjectView>("chat");
  const streamRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const viewEpochRef = useRef(0);
  const selectedProjectRef = useRef<string | null>(null);
  const viewRequestRef = useRef(0);
  const initialRouteHandledRef = useRef(false);

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
    return () => {
      viewEpochRef.current += 1;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [loadProjects]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const loadProjectView = useCallback(async (projectId: string) => {
    const epoch = viewEpochRef.current;
    const requestId = ++viewRequestRef.current;
    const encodedProjectId = encodeURIComponent(projectId);
    const [detail, profileResponse, confirmationsResponse, recoveryResponse, demosResponse] =
      await Promise.all([
        api<ProjectDetail>(`/api/v1/projects/${encodedProjectId}`),
        api<{ profile: AutonomyProfile }>(
          `/api/v1/projects/${encodedProjectId}/autonomy-profile`
        ).catch(() => null),
        api<{ items: PendingConfirmation[] }>(
          `/api/v1/projects/${encodedProjectId}/confirmations?status=PENDING`
        ).catch(() => null),
        api<{ items: RecoveryRequiredOperation[] }>(
          `/api/v1/projects/${encodedProjectId}/recovery-required?limit=50`
        ).catch(() => null),
        api<{ items: DemoManagerRun[] }>(
          `/api/v1/projects/${encodedProjectId}/manager-demo-runs`
        ).catch(() => null)
      ]);
    if (
      epoch !== viewEpochRef.current ||
      projectId !== selectedProjectRef.current ||
      requestId !== viewRequestRef.current
    )
      return;
    const restoredRun = restoredRunState(detail.messages);
    if (restoredRun.activeRunId === null) {
      streamRef.current?.close();
      streamRef.current = null;
    }
    setActiveProject(detail.project);
    setChatId(detail.chat_id);
    setMessages((current) =>
      detail.messages.map((message) => {
        const live = current.find((candidate) => candidate.id === message.id);
        // A persisted snapshot can predate an already received SSE delta.
        return message.status === "streaming" &&
          live &&
          live.content.length > message.content.length
          ? { ...message, content: live.content }
          : message;
      })
    );
    setRunPhase(restoredRun.phase);
    setActiveRunId(restoredRun.activeRunId);
    setSending(restoredRun.activeRunId !== null);
    setAutonomyProfile(profileResponse?.profile ?? null);
    setPolicySignals({
      pendingConfirmations: confirmationsResponse?.items ?? null,
      recoveryRequired: recoveryResponse?.items ?? null
    });
    setDemoRuns(demosResponse?.items ?? []);
  }, []);

  useEffect(() => {
    if (!activeProject || (runPhase !== "queued" && runPhase !== "running")) {
      return;
    }
    const projectId = activeProject.id;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void loadProjectView(projectId)
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeProject, loadProjectView, runPhase]);

  const openProject = useCallback(
    async (projectId: string, view: ProjectView = "chat"): Promise<void> => {
      const epoch = ++viewEpochRef.current;
      selectedProjectRef.current = projectId;
      replaceConsoleRoute(projectId, view);
      streamRef.current?.close();
      streamRef.current = null;
      setActiveRunId(null);
      setSending(false);
      setRunPhase("idle");
      setProjectView(view);
      setActiveProject(null);
      setMessages([]);
      setChatId(null);
      setDraft("");
      setLastCompletedRoute(null);
      setAutonomyProfile(null);
      setPolicySignals(EMPTY_POLICY_SIGNALS);
      setDemoRuns([]);
      setDemoActionPending(false);
      setError(null);
      setLoading(true);
      try {
        await loadProjectView(projectId);
      } catch (cause) {
        if (epoch !== viewEpochRef.current) return;
        setError(cause instanceof Error ? cause.message : "Не удалось открыть проект");
      } finally {
        if (epoch === viewEpochRef.current) setLoading(false);
      }
    },
    [loadProjectView]
  );

  useEffect(() => {
    if (loading || initialRouteHandledRef.current) return;
    initialRouteHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    if (!projectId) return;
    const requestedView = params.get("view");
    void openProject(projectId, isProjectView(requestedView) ? requestedView : "chat");
  }, [loading, openProject]);

  const selectProjectView = (view: ProjectView): void => {
    setProjectView(view);
    if (activeProject) replaceConsoleRoute(activeProject.id, view);
  };

  const refreshProject = useCallback(
    async (projectId: string) => {
      await loadProjectView(projectId);
      await loadProjects();
    },
    [loadProjectView, loadProjects]
  );

  const followStream = useCallback(
    (accepted: RunStreamTarget): void => {
      const epoch = viewEpochRef.current;
      streamRef.current?.close();
      setActiveRunId(accepted.run_id);
      const source = new EventSource(accepted.stream_url);
      streamRef.current = source;
      let assistantId: string | null = null;
      let finished = false;
      let streamContent = "";
      const isCurrent = (): boolean =>
        epoch === viewEpochRef.current && streamRef.current === source;

      const closeSource = (): void => {
        source.close();
        if (streamRef.current === source) streamRef.current = null;
      };

      source.addEventListener("run.started", () => {
        if (!isCurrent()) return;
        setError(null);
        setRunPhase("running");
      });

      source.addEventListener("message.started", (raw) => {
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        const event = JSON.parse(String(raw.data)) as {
          data: { message_id: string; seq: number; delta: string };
        };
        assistantId = event.data.message_id;
        streamContent = event.data.seq === 0 ? event.data.delta : streamContent + event.data.delta;
        const content = streamContent;
        setMessages((current) =>
          current.map((message) =>
            message.id === event.data.message_id
              ? {
                  ...message,
                  content: content.length >= message.content.length ? content : message.content
                }
              : message
          )
        );
      });

      source.addEventListener("run.completed", (raw) => {
        if (!isCurrent()) return;
        const event = JSON.parse(String(raw.data)) as {
          data: { provider: string; model_resolved: string };
        };
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        setLastCompletedRoute({
          provider: event.data.provider,
          model: event.data.model_resolved
        });
        setSending(false);
        setActiveRunId(null);
        setRunPhase("completed");
        void refreshProject(accepted.project.id).catch(() => {
          if (assistantId && epoch === viewEpochRef.current) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, status: "completed" } : message
              )
            );
          }
        });
      });

      source.addEventListener("run.failed", (raw) => {
        if (!isCurrent()) return;
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        const event = JSON.parse(String(raw.data)) as { data: { error_code: string } };
        setSending(false);
        setActiveRunId(null);
        setRunPhase("failed");
        setError(`Запуск остановлен: ${event.data.error_code}`);
        void refreshProject(accepted.project.id).catch(() => undefined);
      });

      source.addEventListener("run.cancelled", () => {
        if (!isCurrent()) return;
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("cancelled");
        void refreshProject(accepted.project.id).catch(() => undefined);
      });

      source.onerror = () => {
        if (!isCurrent()) return;
        closeSource();
        if (!finished) {
          setError("Поток ответа прерван. Проверяю сохранённое состояние запуска на сервере.");
        }
      };
    },
    [refreshProject]
  );

  useEffect(() => {
    if (!activeProject || !chatId || !activeRunId || streamRef.current) return;
    followStream({
      project: activeProject,
      chat_id: chatId,
      run_id: activeRunId,
      stream_url: `/api/v1/runs/${encodeURIComponent(activeRunId)}/events`
    });
  }, [activeProject, activeRunId, chatId, followStream]);

  const cancelRun = async (): Promise<void> => {
    if (!activeRunId || !activeProject) return;
    const epoch = viewEpochRef.current;
    setError(null);
    try {
      await api<CancelledRun>(`/api/v1/runs/${activeRunId}/cancel`, { method: "POST" });
    } catch (cause) {
      if (epoch !== viewEpochRef.current) return;
      setError(cause instanceof Error ? cause.message : "Не удалось остановить запуск");
      return;
    }
    if (epoch !== viewEpochRef.current) return;
    streamRef.current?.close();
    streamRef.current = null;
    setSending(false);
    setActiveRunId(null);
    setRunPhase("cancelled");
    await refreshProject(activeProject.id).catch(() => {
      if (epoch === viewEpochRef.current)
        setError("Запуск остановлен. Не удалось обновить историю.");
    });
  };

  const recoverableMessage = recoverableUserMessage(messages);
  const demoSource = latestDemoSource(messages);
  const latestDemoRun = demoRuns[0] ?? null;

  const prepareManagerDemo = async (): Promise<void> => {
    if (!activeProject || !demoSource?.run_id) return;
    const epoch = viewEpochRef.current;
    setDemoActionPending(true);
    setError(null);
    try {
      const created = await api<DemoManagerRun>(
        `/api/v1/projects/${encodeURIComponent(activeProject.id)}/manager-demo-runs`,
        {
          method: "POST",
          body: JSON.stringify({ source_run_id: demoSource.run_id, owner_goal: demoSource.content })
        }
      );
      if (epoch !== viewEpochRef.current) return;
      setDemoRuns((current) => [
        created,
        ...current.filter((run) => run.demo_run_id !== created.demo_run_id)
      ]);
    } catch (cause) {
      if (epoch === viewEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Не удалось подготовить Manager plan");
      }
    } finally {
      if (epoch === viewEpochRef.current) setDemoActionPending(false);
    }
  };

  const executeManagerDemo = async (): Promise<void> => {
    if (!activeProject || !latestDemoRun) return;
    const epoch = viewEpochRef.current;
    setDemoActionPending(true);
    setError(null);
    try {
      const completed = await api<DemoManagerRun>(
        `/api/v1/projects/${encodeURIComponent(activeProject.id)}/manager-demo-runs/${encodeURIComponent(
          latestDemoRun.demo_run_id
        )}/execute`,
        { method: "POST" }
      );
      if (epoch !== viewEpochRef.current) return;
      setDemoRuns((current) =>
        current.map((run) => (run.demo_run_id === completed.demo_run_id ? completed : run))
      );
    } catch (cause) {
      if (epoch === viewEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Не удалось запустить demo workflow");
      }
    } finally {
      if (epoch === viewEpochRef.current) setDemoActionPending(false);
    }
  };

  const cancelManagerDemo = async (): Promise<void> => {
    if (!activeProject || !latestDemoRun) return;
    const epoch = viewEpochRef.current;
    setDemoActionPending(true);
    setError(null);
    try {
      const cancelled = await api<DemoManagerRun>(
        `/api/v1/projects/${encodeURIComponent(activeProject.id)}/manager-demo-runs/${encodeURIComponent(
          latestDemoRun.demo_run_id
        )}/cancel`,
        { method: "POST" }
      );
      if (epoch !== viewEpochRef.current) return;
      setDemoRuns((current) =>
        current.map((run) => (run.demo_run_id === cancelled.demo_run_id ? cancelled : run))
      );
    } catch (cause) {
      if (epoch === viewEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Не удалось остановить demo workflow");
      }
    } finally {
      if (epoch === viewEpochRef.current) setDemoActionPending(false);
    }
  };

  const restoreRunDraft = (): void => {
    if (!recoverableMessage) return;
    setDraft(recoverableMessage.content);
    setError(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending || loading) return;
    const epoch = viewEpochRef.current;

    setSending(true);
    selectProjectView("chat");
    setRunPhase("queued");
    setError(null);
    setLastCompletedRoute(null);
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

      if (epoch !== viewEpochRef.current) {
        void loadProjects().catch(() => undefined);
        return;
      }
      selectedProjectRef.current = accepted.project.id;
      replaceConsoleRoute(accepted.project.id, "chat");
      // Invalidate snapshots fetched before server acceptance of this run.
      viewRequestRef.current += 1;
      setActiveProject(accepted.project);
      setChatId(accepted.chat_id);
      setMessages((current) =>
        activeProject ? [...current, accepted.user_message] : [accepted.user_message]
      );
      setPolicySignals(EMPTY_POLICY_SIGNALS);
      void api<{ profile: AutonomyProfile }>(
        `/api/v1/projects/${encodeURIComponent(accepted.project.id)}/autonomy-profile`
      )
        .then((response) => {
          if (epoch === viewEpochRef.current) setAutonomyProfile(response.profile);
        })
        .catch(() => {
          if (epoch === viewEpochRef.current) setAutonomyProfile(null);
        });
      followStream(accepted);
      void loadProjects().catch(() => {
        if (epoch === viewEpochRef.current)
          setError("Запуск принят. Не удалось обновить список проектов.");
      });
    } catch (cause) {
      if (epoch !== viewEpochRef.current) return;
      setDraft(content);
      setSending(false);
      setRunPhase("failed");
      setError(cause instanceof Error ? cause.message : "Не удалось отправить сообщение");
    }
  };

  const newProject = (): void => {
    viewEpochRef.current += 1;
    selectedProjectRef.current = null;
    streamRef.current?.close();
    streamRef.current = null;
    setActiveProject(null);
    setChatId(null);
    setMessages([]);
    setAutonomyProfile(null);
    setPolicySignals(EMPTY_POLICY_SIGNALS);
    setDemoRuns([]);
    setDemoActionPending(false);
    setDraft("");
    setSending(false);
    setActiveRunId(null);
    setLastCompletedRoute(null);
    setRunPhase("idle");
    setProjectView("chat");
    setError(null);
    setLoading(false);
    replaceConsoleRoute(null);
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
          <span className="version">Manager</span>
        </div>

        <button className="new-project" onClick={newProject}>
          <span>＋</span> Новый проект
        </button>

        <nav className="navigation" aria-label="Основная навигация">
          <button className={!activeProject ? "nav-item active" : "nav-item"} onClick={newProject}>
            <SparkIcon />
            <span className="nav-copy">
              <strong>Менеджер</strong>
              <small>Главный чат</small>
            </span>
          </button>
          <Link
            className="nav-item"
            href={
              activeProject
                ? `/agent-studio?project=${encodeURIComponent(activeProject.id)}`
                : "/agent-studio"
            }
          >
            <GridIcon />
            <span className="nav-copy">
              <strong>Агенты</strong>
              <small>Agent Studio</small>
            </span>
          </Link>
          <Link className="nav-item" href={controlCenterHref}>
            <ShieldIcon />
            <span className="nav-copy">
              <strong>Безопасность</strong>
              <small>Control Center</small>
            </span>
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
              {runtime && runtime.mode !== "mock" ? "Провайдер настроен" : "Mock-режим"}
            </span>
            <span className="privacy-badge">
              <ShieldIcon />
              {runtime && runtime.mode !== "mock" ? "Внешний провайдер" : "Локальные данные"}
            </span>
          </div>
          <InstallApp />
        </header>

        {activeProject && (
          <nav className="project-tabs" role="tablist" aria-label="Разделы проекта">
            <button
              type="button"
              role="tab"
              aria-selected={projectView === "chat"}
              className={projectView === "chat" ? "active" : ""}
              onClick={() => selectProjectView("chat")}
            >
              <SparkIcon />
              Чат
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={projectView === "plan"}
              className={projectView === "plan" ? "active" : ""}
              onClick={() => selectProjectView("plan")}
            >
              <GridIcon />
              План
              {latestDemoRun && <span className="tab-indicator" aria-hidden="true" />}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={projectView === "project"}
              className={projectView === "project" ? "active" : ""}
              onClick={() => selectProjectView("project")}
            >
              <ShieldIcon />
              Проект
              {((policySignals.pendingConfirmations?.length ?? 0) > 0 ||
                (policySignals.recoveryRequired?.length ?? 0) > 0) && (
                <span className="tab-count">
                  {(policySignals.pendingConfirmations?.length ?? 0) +
                    (policySignals.recoveryRequired?.length ?? 0)}
                </span>
              )}
            </button>
          </nav>
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

        {activeProject && projectView === "project" && (
          <div className="project-context view-panel" role="tabpanel" aria-label="Проект">
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
                <small>Решения владельца</small>
                <strong>
                  {policySignals.pendingConfirmations === null
                    ? "Нет данных"
                    : policySignals.pendingConfirmations.length === 0
                      ? "Нет"
                      : `${policySignals.pendingConfirmations?.length} ожидает`}
                </strong>
              </span>
              <span>
                <small>Recovery</small>
                <strong>
                  {policySignals.recoveryRequired === null
                    ? "Нет данных"
                    : policySignals.recoveryRequired.length === 0
                      ? "Не требуется"
                      : `${policySignals.recoveryRequired?.length} требует внимания`}
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

            {((policySignals.pendingConfirmations?.length ?? 0) > 0 ||
              (policySignals.recoveryRequired?.length ?? 0) > 0) && (
              <section className="manager-attention" aria-label="Требуется внимание владельца">
                <header>
                  <span className="attention-icon">
                    <ShieldIcon />
                  </span>
                  <span>
                    <small>Server-confirmed state</small>
                    <strong>Требуется внимание владельца</strong>
                  </span>
                </header>
                <div className="attention-list">
                  {policySignals.pendingConfirmations?.slice(0, 1).map((confirmation) => (
                    <article
                      className="attention-card confirmation"
                      key={confirmation.confirmation_id}
                    >
                      <div>
                        <small>
                          Решение владельца · {policySignals.pendingConfirmations?.length}
                        </small>
                        <strong>{confirmation.intent.purpose}</strong>
                        <p>{confirmation.intent.capability_ids.join(" · ")}</p>
                        <span>
                          {confirmation.requires_step_up
                            ? "Потребуется step-up"
                            : "Текущая сессия владельца"}
                        </span>
                      </div>
                      <Link href={`${controlCenterHref}#pending-confirmations`}>
                        Проверить решение
                      </Link>
                    </article>
                  ))}
                  {policySignals.recoveryRequired?.slice(0, 1).map((operation) => (
                    <article className="attention-card recovery" key={operation.operation_id}>
                      <div>
                        <small>Recovery · {policySignals.recoveryRequired?.length}</small>
                        <strong>Внешний результат неизвестен</strong>
                        <p>{operation.reasons.join(" · ")}</p>
                        <span>{operation.capability_ids.join(" · ")}</span>
                      </div>
                      <Link href={`${controlCenterHref}#policy-recovery-required-title`}>
                        Сверить recovery
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeProject && projectView === "plan" && (
          <div className="project-context view-panel" role="tabpanel" aria-label="План">
            <section className="manager-demo" aria-label="Manager demo workflow">
              <header>
                <div>
                  <small>Manager demo · server-persisted</small>
                  <strong>План и безопасное выполнение</strong>
                </div>
                {latestDemoRun && (
                  <span className={`demo-status ${latestDemoRun.status}`}>
                    {DEMO_RUN_STATUS_LABEL[latestDemoRun.status]}
                  </span>
                )}
              </header>
              {!latestDemoRun ? (
                <div className="demo-empty">
                  <p>
                    Manager соберёт видимый трёхшаговый plan из последней задачи. Запуск остаётся
                    отдельным явным действием владельца.
                  </p>
                  <button
                    type="button"
                    onClick={() => void prepareManagerDemo()}
                    disabled={!demoSource || demoActionPending || sending}
                  >
                    Подготовить Manager plan
                  </button>
                </div>
              ) : (
                <div className="demo-content">
                  <p className="demo-goal">
                    <small>Задача владельца</small>
                    {latestDemoRun.owner_goal}
                  </p>
                  <ol className="demo-steps">
                    {latestDemoRun.graph.nodes.map((step, index) => (
                      <li key={step.task_id}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>
                            {step.assigned_role === "manager" ? "Manager" : "Analyst"}
                          </strong>
                          <small>{step.expected_output_kinds.join(" · ")}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {latestDemoRun.artifacts.length > 0 && (
                    <div className="demo-artifacts">
                      {latestDemoRun.artifacts.map((artifact) => (
                        <article key={artifact.artifact_id}>
                          <small>{artifact.kind}</small>
                          <p>{artifact.content}</p>
                        </article>
                      ))}
                    </div>
                  )}
                  {latestDemoRun.checkpoint && (
                    <p className="demo-checkpoint">
                      Checkpoint сохранён ·{" "}
                      {new Date(latestDemoRun.checkpoint.created_at).toLocaleTimeString("ru", {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </p>
                  )}
                  <p className="demo-boundary">
                    Synthetic/read-only demo: без модели, сети, файлов, Tool Runtime и внешних
                    действий.
                  </p>
                  {latestDemoRun.status === "queued" && (
                    <div className="demo-actions">
                      <button
                        type="button"
                        onClick={() => void executeManagerDemo()}
                        disabled={demoActionPending || sending}
                      >
                        Запустить безопасный шаг
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void cancelManagerDemo()}
                        disabled={demoActionPending || sending}
                      >
                        Остановить
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {activeProject && projectView === "chat" ? (
          <section className="chat-panel" aria-label="Главный чат проекта">
            <div className="chat-heading">
              <span className="manager-avatar">
                <SparkIcon />
              </span>
              <div>
                <strong>Cosmora Manager</strong>
                <small>
                  {lastCompletedRoute
                    ? `Последний ответ: ${lastCompletedRoute.provider} · ${lastCompletedRoute.model}`
                    : runtime && runtime.mode !== "mock"
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
        ) : !activeProject ? (
          <>
            <section className="hero">
              <div className="hero-symbol">
                <SparkIcon />
              </div>
              <h2>Чем займёмся?</h2>
              <p>
                Опишите результат — Менеджер создаст проект, сохранит контекст и поможет пройти к
                следующему шагу.
              </p>
            </section>
            <section className="foundation-grid" aria-label="Возможности текущего этапа">
              <button
                type="button"
                className="foundation-card"
                onClick={() => {
                  setDraft("Помоги сформулировать цель нового проекта");
                  composerRef.current?.focus();
                }}
              >
                <span className="card-icon">
                  <GridIcon />
                </span>
                <div>
                  <h3>Создать проект</h3>
                  <p>Сформулировать цель и первый результат</p>
                </div>
              </button>
              <button
                type="button"
                className="foundation-card"
                onClick={() => {
                  setDraft("Составь понятный пошаговый план по моей задаче");
                  composerRef.current?.focus();
                }}
              >
                <span className="card-icon">
                  <SparkIcon />
                </span>
                <div>
                  <h3>Составить план</h3>
                  <p>Разложить задачу на ясные шаги</p>
                </div>
              </button>
              <button
                type="button"
                className="foundation-card"
                onClick={() => {
                  setDraft("Проверь статус проекта и предложи следующий шаг");
                  composerRef.current?.focus();
                }}
              >
                <span className="card-icon">
                  <ShieldIcon />
                </span>
                <div>
                  <h3>Проверить статус</h3>
                  <p>Увидеть состояние и точки внимания</p>
                </div>
              </button>
            </section>
          </>
        ) : null}

        <form
          className={activeProject ? "composer chat-composer" : "composer"}
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="task">
            {activeProject ? "Сообщение менеджеру" : "Опишите результат, который хотите получить"}
          </label>
          <textarea
            id="task"
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={sending || loading}
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
              <div className="composer-actions">
                {recoverableMessage && !draft.trim() && (
                  <button type="button" className="restore-run" onClick={restoreRunDraft}>
                    ↻ Вернуть запрос в редактор
                  </button>
                )}
                <button
                  disabled={!draft.trim() || loading}
                  aria-label={activeProject ? "Отправить" : "Запустить"}
                >
                  <SendIcon />
                  {activeProject ? "Отправить" : "Запустить"}
                </button>
              </div>
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
