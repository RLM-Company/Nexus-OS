"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { assessTaskComplexity, chooseGreeting, type TaskComplexity } from "./chat-mode";
import { InstallApp } from "./install-app";
import { ChatResponse } from "./chat-response";
import { WebSearchPanel } from "./web-search-panel";
import { ChatHistoryActions } from "./chat-history-actions";
import { ChatArchivePanel } from "./chat-archive-panel";
import { ProjectContextPanel } from "./project-context-panel";
import { ProjectContextPreview } from "./project-context-preview";
import { ManagerWorkPanel } from "./manager-work-panel";
import { useExecutionGate } from "./use-execution-gate";
import { WorkspaceIcon } from "./workspace-icons";
import { AccountMenu, MobileNavigation } from "./workspace-navigation";
import {
  ChatAttachmentPicker,
  ChatMessageAttachments,
  useChatAttachments
} from "./chat-attachments";
import { isValidChatAttachments, type ChatAttachment } from "@cosmora/contracts/chat-attachments";
import {
  WorkspaceSections,
  TOOL_ITEMS,
  STUDIO_ITEMS,
  type ToolSurface,
  type UiPreferences
} from "./workspace-sections";

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
  attachments?: ChatAttachment[];
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

type LocalChatMessage = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content_type: "text";
  content: string;
  attachments?: ChatAttachment[];
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  run_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectProposal = {
  content: string;
  assessment: TaskComplexity;
  attachments?: ChatAttachment[];
};

type LocalChatSession = {
  id: string;
  title: string;
  messages: LocalChatMessage[];
  projectProposal: ProjectProposal | null;
  created_at: string;
  updated_at: string;
  last_message_preview?: string | null;
};

type GeneralChatAcceptedResponse = {
  chat: Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at">;
  user_message: LocalChatMessage;
  run_id: string;
  stream_url: string;
};

type GeneralChatDetail = {
  chat: Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at">;
  messages: LocalChatMessage[];
};

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

type RunPhase = "idle" | "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled";
type ProjectView = "chat" | "plan" | "project" | "context";
type ProjectTabKeyEvent = {
  key: string;
  currentTarget: HTMLButtonElement;
  preventDefault(): void;
};

const PROJECT_VIEW_ORDER: ProjectView[] = ["chat", "plan", "project", "context"];
type WorkspaceSurface = "manager" | ToolSurface;

const SURFACE_TITLE: Record<WorkspaceSurface, string> = {
  manager: "Cosmora Manager",
  studio: "Cosmora Studio",
  files: "Крупные файлы",
  skills: "Skills",
  code: "Code",
  work: "Work",
  images: "Изображения",
  video: "Видео",
  sound: "Sound",
  "multi-agent": "Мультиагент",
  apps: "Приложения",
  features: "Возможности",
  settings: "Настройки"
};

const isProjectView = (value: string | null): value is ProjectView =>
  value === "chat" || value === "plan" || value === "project" || value === "context";

const replaceConsoleRoute = (projectId: string | null, view: ProjectView = "chat"): void => {
  let route = projectId
    ? `/?project=${encodeURIComponent(projectId)}&view=${encodeURIComponent(view)}`
    : "/";
  if (new URLSearchParams(window.location.search).get("context_preview") === "1")
    route += `${route.includes("?") ? "&" : "?"}context_preview=1`;
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
  running: "Менеджер отвечает",
  succeeded: "Завершён с checkpoint",
  failed: "Требует внимания",
  cancelled: "Остановлен владельцем"
};

const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  idle: "Готов",
  queued: "В очереди",
  running: "Менеджер отвечает",
  streaming: "Менеджер отвечает · поток",
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

const SparkIcon = () => <WorkspaceIcon name="cosmora" />;

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

const ToolIcon = ({ kind }: { kind: ToolSurface | "projects" | "new-chat" | "chats" }) => (
  <WorkspaceIcon name={kind} />
);

const safeApiErrorMessage = (status: number): string => {
  if (status === 401 || status === 403) return "Недостаточно прав для этого действия.";
  if (status === 404) return "Запрошенные данные не найдены.";
  if (status === 409) return "Состояние изменилось. Обновите данные и повторите попытку.";
  if (status === 429) return "Слишком много запросов. Повторите попытку позже.";
  if (status >= 500) return "Сервис временно недоступен. Повторите попытку.";
  return "Не удалось выполнить запрос. Проверьте данные и повторите попытку.";
};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers
  });
  if (!response.ok) throw new Error(safeApiErrorMessage(response.status));
  return (await response.json()) as T;
};

const safeStreamUrl = (value: string, expectedPrefix: string): string | null => {
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.startsWith(expectedPrefix)) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

const clientId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const SIDEBAR_SECTIONS_STORAGE_KEY = "cosmora:sidebar-sections";
const WORKSPACE_SURFACE_STORAGE_KEY = "cosmora:workspace-surface";
const COMPOSER_DRAFT_STORAGE_PREFIX = "cosmora:composer-draft:";
const EMPTY_LOCAL_CHAT_MESSAGES: LocalChatMessage[] = [];

const composerDraftStorageKey = (projectId: string | null, chatId: string | null): string =>
  `${COMPOSER_DRAFT_STORAGE_PREFIX}${projectId ? `project:${projectId}` : chatId ? `chat:${chatId}` : "new-chat"}`;

const isToolSurface = (value: string | null): value is ToolSurface =>
  TOOL_ITEMS.some((item) => item.id === value);

const greetingSeed = (): number => {
  if (typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
};

const displayedContent = (message: Message): string | null => {
  if (message.status === "cancelled") return "Запуск остановлен владельцем.";
  if (message.status === "failed")
    return message.error_code === "CONTEXT_TOO_LARGE"
      ? "Сообщение и материалы слишком большие. Сократите текст или число файлов и повторите отправку."
      : message.error_code === "ROUTE_UNAVAILABLE"
        ? "Для этого запроса нет доступного маршрута модели с нужными возможностями."
        : "Запуск завершился с ошибкой.";
  if (message.content) return message.content;
  return null;
};

const displayedGeneralContent = (message: LocalChatMessage): string | null => {
  if (message.status === "cancelled") return "Ответ остановлен владельцем.";
  if (message.status === "failed")
    return message.error_code === "CONTEXT_TOO_LARGE"
      ? "Сообщение и материалы слишком большие. Сократите текст или число файлов и повторите отправку."
      : message.error_code === "ROUTE_UNAVAILABLE"
        ? "Для этого запроса нет доступного маршрута модели с нужными возможностями."
        : "Ответ завершился с ошибкой.";
  return message.content || null;
};

type RestoredRunState = {
  phase: RunPhase;
  activeRunId: string | null;
};

const restoredRunState = (
  messages: Array<Pick<Message, "run_id" | "role" | "status">>
): RestoredRunState => {
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

  if (assistant.status === "pending") {
    return { phase: "running", activeRunId: runId };
  }
  if (assistant.status === "streaming") {
    return { phase: "streaming", activeRunId: runId };
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

const generalMessagePlaceholder = (id: string, chatId: string, runId: string): LocalChatMessage => {
  const timestamp = new Date().toISOString();
  return {
    id,
    chat_id: chatId,
    role: "assistant",
    content_type: "text",
    content: "",
    status: "streaming",
    run_id: runId,
    error_code: null,
    created_at: timestamp,
    updated_at: timestamp
  };
};

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const executionGate = useExecutionGate(activeProject?.id);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [autonomyProfile, setAutonomyProfile] = useState<AutonomyProfile | null>(null);
  const [policySignals, setPolicySignals] = useState<PolicySignals>(EMPTY_POLICY_SIGNALS);
  const [demoRuns, setDemoRuns] = useState<DemoManagerRun[]>([]);
  const [demoActionPending, setDemoActionPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftStorageReadyKey, setDraftStorageReadyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ModelRuntimeStatus | null>(null);
  const [lastCompletedRoute, setLastCompletedRoute] = useState<CompletedRoute | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [projectView, setProjectView] = useState<ProjectView>("chat");
  const [contextPreview, setContextPreview] = useState(false);
  useEffect(() => {
    setContextPreview(new URLSearchParams(window.location.search).get("context_preview") === "1");
  }, []);
  const [surface, setSurface] = useState<WorkspaceSurface>("manager");
  const [greeting, setGreeting] = useState("Чем могу помочь?");
  const [localChats, setLocalChats] = useState<LocalChatSession[]>([]);
  const [activeLocalChatId, setActiveLocalChatId] = useState<string | null>(null);
  const [localChatsHydrated, setLocalChatsHydrated] = useState(false);
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [studioExpanded, setStudioExpanded] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [preferences, setPreferences] = useState<UiPreferences>({
    compact: false,
    largeText: false
  });
  const [preferencesNotice, setPreferencesNotice] = useState("");
  const [sidebarSectionsHydrated, setSidebarSectionsHydrated] = useState(false);
  const [workspaceSurfaceHydrated, setWorkspaceSurfaceHydrated] = useState(false);
  const streamRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const navigationSearchRef = useRef<HTMLInputElement | null>(null);
  const viewEpochRef = useRef(0);
  const selectedProjectRef = useRef<string | null>(null);
  const viewRequestRef = useRef(0);
  const initialRouteHandledRef = useRef(false);
  const previousGreetingRef = useRef<string | null>(null);
  const greetingInitializedRef = useRef(false);
  const submitPendingRef = useRef(false);
  const projectPromotionPendingRef = useRef(false);
  const activeLocalChat = localChats.find((chat) => chat.id === activeLocalChatId) ?? null;
  const navigationSearch = navigationQuery.trim().toLocaleLowerCase("ru");
  const matchingChats = navigationSearch
    ? localChats.filter((chat) => chat.title.toLocaleLowerCase("ru").includes(navigationSearch))
    : localChats;
  const matchingProjects = navigationSearch
    ? projects.filter((project) => project.title.toLocaleLowerCase("ru").includes(navigationSearch))
    : projects;
  const localChatMessages = activeLocalChat?.messages ?? EMPTY_LOCAL_CHAT_MESSAGES;
  const projectProposal = activeLocalChat?.projectProposal ?? null;
  const composerDraftKey = composerDraftStorageKey(activeProject?.id ?? null, activeLocalChatId);
  const chatAttachments = useChatAttachments(`${composerDraftKey}:${viewEpochRef.current}`);
  const pendingComposeRef = useRef<{ prompt: string; files: ChatAttachment[] } | null>(null);

  useEffect(() => {
    setDraftStorageReadyKey(null);
    try {
      setDraft(window.localStorage.getItem(composerDraftKey) ?? "");
    } catch {
      setDraft("");
    }
    setDraftStorageReadyKey(composerDraftKey);
  }, [composerDraftKey]);

  const attachmentScope = `${composerDraftKey}:${viewEpochRef.current}`;
  useEffect(() => {
    const pending = pendingComposeRef.current;
    if (!pending) return;
    pendingComposeRef.current = null;
    setDraft(pending.prompt);
    chatAttachments.replace(pending.files);
    window.requestAnimationFrame(() => composerRef.current?.focus());
    // Consume only after the new chat scope and its draft hydration have settled.
  }, [attachmentScope, chatAttachments]);

  useEffect(() => {
    if (draftStorageReadyKey !== composerDraftKey) return;
    try {
      if (draft) window.localStorage.setItem(composerDraftKey, draft);
      else window.localStorage.removeItem(composerDraftKey);
    } catch {
      // Draft remains available for the current session if persistent storage is unavailable.
    }
  }, [composerDraftKey, draft, draftStorageReadyKey]);

  useEffect(() => {
    try {
      const raw: unknown = JSON.parse(
        window.localStorage.getItem("cosmora:ui-preferences") ?? "{}"
      );
      if (raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        setPreferences({ compact: value.compact === true, largeText: value.largeText === true });
      }
    } catch {
      /* Keep defaults when storage is unavailable or malformed. */
    }
  }, []);

  const updatePreferences = (value: UiPreferences): void => {
    setPreferences(value);
    try {
      window.localStorage.setItem("cosmora:ui-preferences", JSON.stringify(value));
      setPreferencesNotice("Настройки сохранены в этом браузере.");
    } catch {
      setPreferencesNotice("Настройки применены. Сохранение в браузере недоступно.");
    }
  };

  const rotateGreeting = useCallback((): void => {
    const next = chooseGreeting({
      seed: greetingSeed(),
      hour: new Date().getHours(),
      previous: previousGreetingRef.current
    });
    previousGreetingRef.current = next;
    setGreeting(next);
    try {
      window.sessionStorage.setItem("cosmora:last-greeting", next);
    } catch {
      // Greeting rotation remains usable when session storage is unavailable.
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await api<{ items: ProjectSummary[] }>("/api/v1/projects");
    setProjects(data.items);
  }, []);

  const loadGeneralChats = useCallback(async () => {
    const data = await api<{
      items: Array<
        Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at"> & {
          last_message_preview: string | null;
        }
      >;
    }>("/api/v1/chats");
    setLocalChats((current) =>
      data.items.map((chat) => {
        const existing = current.find((candidate) => candidate.id === chat.id);
        return {
          ...chat,
          messages: existing?.messages ?? [],
          projectProposal: existing?.projectProposal ?? null
        };
      })
    );
    setLocalChatsHydrated(true);
  }, []);

  const reloadShellData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadProjects(),
        loadGeneralChats(),
        api<ModelRuntimeStatus>("/api/v1/model-runtime").then(setRuntime)
      ]);
    } catch {
      setError("API Cosmora пока недоступен. Проверьте локальное подключение и повторите попытку.");
    } finally {
      setLoading(false);
    }
  }, [loadGeneralChats, loadProjects]);

  useEffect(() => {
    if (greetingInitializedRef.current) return;
    greetingInitializedRef.current = true;
    try {
      previousGreetingRef.current = window.sessionStorage.getItem("cosmora:last-greeting");
    } catch {
      previousGreetingRef.current = null;
    }
    rotateGreeting();
  }, [rotateGreeting]);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY) ?? "{}"
      ) as { chats?: boolean; projects?: boolean; studio?: boolean };
      if (typeof saved.studio === "boolean") setStudioExpanded(saved.studio);
      if (typeof saved.chats === "boolean") setChatsExpanded(saved.chats);
      if (typeof saved.projects === "boolean") setProjectsExpanded(saved.projects);
    } catch {
      // Ignore malformed local UI preferences and keep both sections open.
    }
    setSidebarSectionsHydrated(true);
  }, []);

  useEffect(() => {
    if (!sidebarSectionsHydrated) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_SECTIONS_STORAGE_KEY,
        JSON.stringify({ chats: chatsExpanded, projects: projectsExpanded, studio: studioExpanded })
      );
    } catch {
      // Section toggles still work for the current page when storage is unavailable.
    }
  }, [chatsExpanded, projectsExpanded, studioExpanded, sidebarSectionsHydrated]);

  useEffect(() => {
    try {
      const requestedSurface = new URLSearchParams(window.location.search).get("surface");
      if (isToolSurface(requestedSurface)) {
        setSurface(requestedSurface);
        if (["studio", "files", "images", "video", "sound"].includes(requestedSurface))
          setStudioExpanded(true);
        setWorkspaceSurfaceHydrated(true);
        return;
      }
      const savedSurface = window.localStorage.getItem(WORKSPACE_SURFACE_STORAGE_KEY);
      if (isToolSurface(savedSurface)) {
        setSurface(savedSurface);
        if (["studio", "files", "images", "video", "sound"].includes(savedSurface))
          setStudioExpanded(true);
      }
    } catch {
      // Keep Manager as the safe default when local UI storage is unavailable.
    }
    setWorkspaceSurfaceHydrated(true);
  }, []);

  useEffect(() => {
    if (!workspaceSurfaceHydrated) return;
    try {
      window.localStorage.setItem(WORKSPACE_SURFACE_STORAGE_KEY, surface);
    } catch {
      // Surface selection remains usable for the current page without persistence.
    }
  }, [surface, workspaceSurfaceHydrated]);

  useEffect(() => {
    void reloadShellData();
    return () => {
      viewEpochRef.current += 1;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [reloadShellData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [localChatMessages, messages]);

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

  const loadGeneralChatView = useCallback(async (generalChatId: string) => {
    const epoch = viewEpochRef.current;
    const detail = await api<GeneralChatDetail>(
      `/api/v1/chats/${encodeURIComponent(generalChatId)}`
    );
    if (epoch !== viewEpochRef.current) return;
    const restoredRun = restoredRunState(detail.messages);
    if (restoredRun.activeRunId === null) {
      streamRef.current?.close();
      streamRef.current = null;
    }
    setLocalChats((current) => {
      const existing = current.find((chat) => chat.id === generalChatId);
      const updated: LocalChatSession = {
        ...detail.chat,
        last_message_preview:
          detail.messages[detail.messages.length - 1]?.content ??
          existing?.last_message_preview ??
          null,
        messages: detail.messages,
        projectProposal: existing?.projectProposal ?? null
      };
      return [updated, ...current.filter((chat) => chat.id !== generalChatId)];
    });
    setRunPhase(restoredRun.phase);
    setActiveRunId(restoredRun.activeRunId);
    setSending(restoredRun.activeRunId !== null);
  }, []);

  useEffect(() => {
    if (
      !activeProject ||
      (runPhase !== "queued" && runPhase !== "running" && runPhase !== "streaming")
    ) {
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

  useEffect(() => {
    if (
      activeProject ||
      !activeLocalChatId ||
      (runPhase !== "queued" && runPhase !== "running" && runPhase !== "streaming")
    ) {
      return;
    }
    const generalChatId = activeLocalChatId;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void loadGeneralChatView(generalChatId)
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeLocalChatId, activeProject, loadGeneralChatView, runPhase]);

  const openProject = useCallback(
    async (projectId: string, view: ProjectView = "chat"): Promise<void> => {
      const epoch = ++viewEpochRef.current;
      setSurface("manager");
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
      setActiveLocalChatId(null);
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
    const imported = params.get("github_import");
    if (imported && /^[a-f0-9-]{36}$/.test(imported)) {
      try {
        const key = `cosmora:github-import:${imported}`;
        const stored = window.sessionStorage.getItem(key);
        if (stored) {
          const material = JSON.parse(stored) as { attachment: ChatAttachment; prompt: string };
          if (
            isValidChatAttachments([material.attachment]) &&
            typeof material.prompt === "string" &&
            material.prompt.length <= 1000
          ) {
            chatAttachments.replace([material.attachment]);
            setDraft(material.prompt);
          }
          window.sessionStorage.removeItem(key);
        }
        window.history.replaceState(null, "", "/");
      } catch {
        setError("Не удалось открыть файл из GitHub. Прикрепите его к чату отдельно.");
      }
      return;
    }
    const projectId = params.get("project");
    if (!projectId) return;
    const requestedView = params.get("view");
    void openProject(projectId, isProjectView(requestedView) ? requestedView : "chat");
  }, [loading, openProject]);

  const selectProjectView = (view: ProjectView): void => {
    setProjectView(view);
    if (activeProject) replaceConsoleRoute(activeProject.id, view);
  };

  const handleProjectTabKeyDown = (event: ProjectTabKeyEvent, currentView: ProjectView): void => {
    const currentIndex = PROJECT_VIEW_ORDER.indexOf(currentView);
    const nextIndex = (currentIndex + 1) % PROJECT_VIEW_ORDER.length;
    const previousIndex =
      (currentIndex - 1 + PROJECT_VIEW_ORDER.length) % PROJECT_VIEW_ORDER.length;
    let nextView: ProjectView | null = null;

    if (event.key === "ArrowRight") {
      nextView = PROJECT_VIEW_ORDER[nextIndex] ?? null;
    } else if (event.key === "ArrowLeft") {
      nextView = PROJECT_VIEW_ORDER[previousIndex] ?? null;
    } else if (event.key === "Home") {
      nextView = PROJECT_VIEW_ORDER[0] ?? null;
    } else if (event.key === "End") {
      nextView = PROJECT_VIEW_ORDER[PROJECT_VIEW_ORDER.length - 1] ?? null;
    }

    if (!nextView) return;

    event.preventDefault();
    const tabList = event.currentTarget.parentElement;
    const selector = `button[data-project-view="${nextView}"]`;
    selectProjectView(nextView);
    window.requestAnimationFrame(() => {
      tabList?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };

  const refreshProject = useCallback(
    async (projectId: string) => {
      await loadProjectView(projectId);
      await loadProjects();
    },
    [loadProjectView, loadProjects]
  );

  const refreshGeneralChat = useCallback(
    async (generalChatId: string) => {
      await loadGeneralChatView(generalChatId);
      await loadGeneralChats();
    },
    [loadGeneralChatView, loadGeneralChats]
  );

  const followStream = useCallback(
    (accepted: RunStreamTarget): void => {
      const epoch = viewEpochRef.current;
      streamRef.current?.close();
      setActiveRunId(accepted.run_id);
      const streamUrl = safeStreamUrl(accepted.stream_url, "/api/v1/runs/");
      if (!streamUrl) {
        setActiveRunId(null);
        setSending(false);
        setRunPhase("failed");
        setError("Не удалось безопасно открыть поток ответа.");
        return;
      }
      const source = new EventSource(streamUrl);
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
        setRunPhase("streaming");
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

      source.addEventListener("run.failed", () => {
        if (!isCurrent()) return;
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("failed");
        setError("Запуск завершился с ошибкой. Внутренние детали скрыты.");
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

  const followGeneralChatStream = useCallback(
    (accepted: GeneralChatAcceptedResponse): void => {
      const epoch = viewEpochRef.current;
      const chatIdForRun = accepted.chat.id;
      streamRef.current?.close();
      setActiveRunId(accepted.run_id);
      const streamUrl = safeStreamUrl(accepted.stream_url, "/api/v1/chat-runs/");
      if (!streamUrl) {
        setActiveRunId(null);
        setSending(false);
        setRunPhase("failed");
        setError("Не удалось безопасно открыть поток ответа.");
        return;
      }
      const source = new EventSource(streamUrl);
      streamRef.current = source;
      let assistantId: string | null = null;
      let streamContent = "";
      let finished = false;
      const isCurrent = (): boolean =>
        epoch === viewEpochRef.current && streamRef.current === source;
      const closeSource = (): void => {
        source.close();
        if (streamRef.current === source) streamRef.current = null;
      };
      const updateMessages = (
        updater: (messages: LocalChatMessage[]) => LocalChatMessage[]
      ): void => {
        setLocalChats((current) =>
          current.map((chat) =>
            chat.id === chatIdForRun ? { ...chat, messages: updater(chat.messages) } : chat
          )
        );
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
        updateMessages((current) =>
          current.some((message) => message.id === event.data.message_id)
            ? current
            : [
                ...current,
                generalMessagePlaceholder(event.data.message_id, chatIdForRun, event.data.run_id)
              ]
        );
      });
      source.addEventListener("message.delta", (raw) => {
        if (!isCurrent()) return;
        setRunPhase("streaming");
        const event = JSON.parse(String(raw.data)) as {
          data: { message_id: string; seq: number; delta: string };
        };
        assistantId = event.data.message_id;
        streamContent = event.data.seq === 0 ? event.data.delta : streamContent + event.data.delta;
        updateMessages((current) =>
          current.map((message) =>
            message.id === event.data.message_id
              ? {
                  ...message,
                  content:
                    streamContent.length >= message.content.length ? streamContent : message.content
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
        finished = true;
        closeSource();
        setLastCompletedRoute({
          provider: event.data.provider,
          model: event.data.model_resolved
        });
        setSending(false);
        setActiveRunId(null);
        setRunPhase("completed");
        void refreshGeneralChat(chatIdForRun).catch(() => {
          if (!assistantId || epoch !== viewEpochRef.current) return;
          updateMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, status: "completed" } : message
            )
          );
        });
      });
      source.addEventListener("run.failed", () => {
        if (!isCurrent()) return;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("failed");
        setError("Ответ завершился с ошибкой. Внутренние детали скрыты.");
        void refreshGeneralChat(chatIdForRun).catch(() => undefined);
      });
      source.addEventListener("run.cancelled", () => {
        if (!isCurrent()) return;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("cancelled");
        void refreshGeneralChat(chatIdForRun).catch(() => undefined);
      });
      source.onerror = () => {
        if (!isCurrent()) return;
        closeSource();
        if (!finished) {
          setError("Поток ответа прерван. Проверяю сохранённое состояние на сервере.");
        }
      };
    },
    [refreshGeneralChat]
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

  useEffect(() => {
    if (activeProject || !activeLocalChat || !activeRunId || streamRef.current) return;
    followGeneralChatStream({
      chat: activeLocalChat,
      user_message:
        [...activeLocalChat.messages]
          .reverse()
          .find((message) => message.run_id === activeRunId && message.role === "user") ??
        activeLocalChat.messages[activeLocalChat.messages.length - 1]!,
      run_id: activeRunId,
      stream_url: `/api/v1/chat-runs/${encodeURIComponent(activeRunId)}/events`
    });
  }, [activeLocalChat, activeProject, activeRunId, followGeneralChatStream]);

  const cancelRun = async (): Promise<void> => {
    if (!activeRunId || (!activeProject && !activeLocalChatId)) return;
    const epoch = viewEpochRef.current;
    setError(null);
    try {
      const url = activeProject
        ? `/api/v1/runs/${activeRunId}/cancel`
        : `/api/v1/chat-runs/${activeRunId}/cancel`;
      await api<CancelledRun>(url, { method: "POST" });
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
    const refresh = activeProject
      ? refreshProject(activeProject.id)
      : refreshGeneralChat(activeLocalChatId as string);
    await refresh.catch(() => {
      if (epoch === viewEpochRef.current) {
        setError("Запуск остановлен. Не удалось обновить историю.");
      }
    });
  };

  const failedChatReply = localChatMessages.findLast((message) => message.role === "assistant");
  const recoverableChatMessage =
    failedChatReply && ["failed", "cancelled"].includes(failedChatReply.status)
      ? localChatMessages.find(
          (message) => message.role === "user" && message.run_id === failedChatReply.run_id
        )
      : undefined;
  const recoverableMessage = activeProject
    ? recoverableUserMessage(messages)
    : recoverableChatMessage;
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
    chatAttachments.replace(recoverableMessage.attachments ?? []);
    setError(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const content = draft.trim();
    if (
      !content ||
      sending ||
      loading ||
      chatAttachments.reading ||
      submitPendingRef.current ||
      executionGate !== "clear"
    )
      return;
    submitPendingRef.current = true;
    try {
      if (!activeProject) {
        const assessment = assessTaskComplexity(content);
        const epoch = viewEpochRef.current;
        setSending(true);
        setRunPhase("queued");
        setError(null);
        setLastCompletedRoute(null);
        setDraft("");
        try {
          const accepted = activeLocalChatId
            ? await api<GeneralChatAcceptedResponse>(
                `/api/v1/chats/${encodeURIComponent(activeLocalChatId)}/messages`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    content,
                    client_message_id: clientId(),
                    attachments: chatAttachments.files
                  })
                }
              )
            : await api<GeneralChatAcceptedResponse>("/api/v1/chats", {
                method: "POST",
                body: JSON.stringify({
                  initial_message: content,
                  client_message_id: clientId(),
                  attachments: chatAttachments.files
                })
              });
          if (epoch !== viewEpochRef.current) {
            void loadGeneralChats().catch(() => undefined);
            return;
          }
          chatAttachments.replace([]);
          const materials = [
            ...localChatMessages
              .filter((message) => message.role === "user")
              .flatMap((message) => message.attachments ?? []),
            ...chatAttachments.files
          ];
          const proposal =
            assessment.requiresProject && isValidChatAttachments(materials)
              ? { content, assessment, attachments: materials }
              : null;
          setLocalChats((current) => {
            const existing = current.find((chat) => chat.id === accepted.chat.id);
            const updated: LocalChatSession = {
              ...accepted.chat,
              last_message_preview: content.slice(0, 240),
              messages: [...(existing?.messages ?? []), accepted.user_message],
              projectProposal: proposal
            };
            return [updated, ...current.filter((chat) => chat.id !== accepted.chat.id)];
          });
          try {
            window.localStorage.removeItem(composerDraftKey);
          } catch {
            // Server acceptance is authoritative even when local draft cleanup is unavailable.
          }
          setActiveLocalChatId(accepted.chat.id);
          followGeneralChatStream(accepted);
          void loadGeneralChats().catch(() => {
            if (epoch === viewEpochRef.current) {
              setError("Сообщение принято. Не удалось обновить список чатов.");
            }
          });
        } catch (cause) {
          if (epoch !== viewEpochRef.current) return;
          setDraft(content);
          setSending(false);
          setRunPhase("failed");
          setError(cause instanceof Error ? cause.message : "Не удалось отправить сообщение");
        }
        return;
      }

      const epoch = viewEpochRef.current;

      setSending(true);
      selectProjectView("chat");
      setRunPhase("queued");
      setError(null);
      setLastCompletedRoute(null);
      setDraft("");
      try {
        const accepted = await api<AcceptedResponse>(
          `/api/v1/projects/${encodeURIComponent(activeProject.id)}/messages`,
          {
            method: "POST",
            body: JSON.stringify({
              content,
              client_message_id: clientId(),
              attachments: chatAttachments.files
            })
          }
        );

        if (epoch !== viewEpochRef.current) {
          void loadProjects().catch(() => undefined);
          return;
        }
        selectedProjectRef.current = accepted.project.id;
        chatAttachments.replace([]);
        replaceConsoleRoute(accepted.project.id, "chat");
        // Invalidate snapshots fetched before server acceptance of this run.
        viewRequestRef.current += 1;
        setActiveProject(accepted.project);
        setChatId(accepted.chat_id);
        setMessages((current) => [...current, accepted.user_message]);
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
    } finally {
      submitPendingRef.current = false;
    }
  };

  const promoteToProject = async (): Promise<void> => {
    if (executionGate !== "clear") return;
    if (!projectProposal || !activeLocalChatId || loading || projectPromotionPendingRef.current)
      return;
    projectPromotionPendingRef.current = true;
    const content = projectProposal.content;
    const sourceChatId = activeLocalChatId;
    let epoch = viewEpochRef.current;
    setSending(true);
    setRunPhase("queued");
    setError(null);
    setLastCompletedRoute(null);
    try {
      const accepted = await api<AcceptedResponse>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          initial_message: content,
          client_message_id: clientId(),
          attachments: projectProposal.attachments ?? []
        })
      });
      if (epoch !== viewEpochRef.current) {
        void loadProjects().catch(() => undefined);
        return;
      }
      // Promotion changes the active view. Ignore pending reads from the source chat.
      epoch = ++viewEpochRef.current;
      setSending(true);
      setRunPhase("queued");
      setLastCompletedRoute(null);
      selectedProjectRef.current = accepted.project.id;
      replaceConsoleRoute(accepted.project.id, "chat");
      viewRequestRef.current += 1;
      setSurface("manager");
      setProjectView("chat");
      setActiveProject(accepted.project);
      setChatId(accepted.chat_id);
      setMessages([accepted.user_message]);
      setLocalChats((current) =>
        current.map((chat) =>
          chat.id === sourceChatId ? { ...chat, projectProposal: null } : chat
        )
      );
      setActiveLocalChatId(null);
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
        if (epoch === viewEpochRef.current) {
          setError("Проект создан. Не удалось обновить список проектов.");
        }
      });
    } catch (cause) {
      if (epoch !== viewEpochRef.current) return;
      setSending(false);
      setRunPhase("failed");
      setError(cause instanceof Error ? cause.message : "Не удалось создать проект");
    } finally {
      projectPromotionPendingRef.current = false;
    }
  };

  const resetToLocalChat = (chatId: string | null, rotate = false): void => {
    viewEpochRef.current += 1;
    selectedProjectRef.current = null;
    streamRef.current?.close();
    streamRef.current = null;
    setActiveProject(null);
    setChatId(null);
    setMessages([]);
    setActiveLocalChatId(chatId);
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
    setSurface("manager");
    setError(null);
    setLoading(false);
    if (rotate) rotateGreeting();
    replaceConsoleRoute(null);
  };

  const newChat = (): void => resetToLocalChat(null, true);

  const openLocalChat = async (chatId: string): Promise<void> => {
    if (!localChats.some((chat) => chat.id === chatId)) return;
    resetToLocalChat(chatId);
    const epoch = viewEpochRef.current;
    setLoading(true);
    try {
      await loadGeneralChatView(chatId);
    } catch (cause) {
      if (epoch === viewEpochRef.current) {
        setError(cause instanceof Error ? cause.message : "Не удалось открыть чат");
      }
    } finally {
      if (epoch === viewEpochRef.current) setLoading(false);
    }
  };

  const dismissProjectProposal = (): void => {
    if (!activeLocalChatId) return;
    setLocalChats((current) =>
      current.map((chat) =>
        chat.id === activeLocalChatId ? { ...chat, projectProposal: null } : chat
      )
    );
  };

  const controlCenterHref = activeProject
    ? `/control-center?project=${encodeURIComponent(activeProject.id)}`
    : "/control-center";
  const agentStudioHref = activeProject
    ? `/agent-studio?project=${encodeURIComponent(activeProject.id)}`
    : "/agent-studio";

  const selectSurface = (nextSurface: ToolSurface): void => {
    setSurface(nextSurface);
    if (["studio", "files", "images", "video", "sound"].includes(nextSurface))
      setStudioExpanded(true);
    const route = new URL(window.location.href);
    route.searchParams.delete("project");
    route.searchParams.delete("view");
    route.searchParams.set("surface", nextSurface);
    window.history.replaceState(
      window.history.state,
      "",
      `${route.pathname}${route.search}${route.hash}`
    );
  };

  return (
    <div
      className={`app-shell product-shell${preferences.compact ? " compact-navigation" : ""}${preferences.largeText ? " large-text" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <SparkIcon />
          </span>
          <span>Cosmora</span>
        </div>

        <button className="new-project" onClick={newChat}>
          <span>
            <ToolIcon kind="new-chat" />
          </span>
          <span className="new-chat-label">Новый чат</span>
        </button>

        <div className="navigation-search">
          <WorkspaceIcon name="search" />
          <input
            ref={navigationSearchRef}
            aria-label="Поиск чатов и проектов"
            placeholder="Поиск чатов и проектов"
            value={navigationQuery}
            onChange={(event) => {
              setNavigationQuery(event.target.value);
              if (event.target.value.trim()) {
                setChatsExpanded(true);
                setProjectsExpanded(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNavigationQuery("");
            }}
          />
          {navigationQuery && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                setNavigationQuery("");
                navigationSearchRef.current?.focus();
              }}
            >
              <WorkspaceIcon name="close" />
            </button>
          )}
        </div>
        <nav className="navigation" aria-label="Основная навигация">
          <section className="sidebar-section">
            <button
              type="button"
              className="projects-heading sidebar-section-toggle"
              aria-expanded={chatsExpanded}
              aria-controls="sidebar-chat-list"
              onClick={() => setChatsExpanded((current) => !current)}
            >
              <ToolIcon kind="chats" />
              <span>Чаты</span>
              <small>{localChats.length}</small>
              <span className="section-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {chatsExpanded && (
              <div
                className={`project-list chat-list${localChats.length === 0 ? " empty-list" : ""}`}
                id="sidebar-chat-list"
              >
                {matchingChats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    className={
                      surface === "manager" && activeLocalChatId === chat.id
                        ? "project-item chat-item active"
                        : "project-item chat-item"
                    }
                    onClick={() => void openLocalChat(chat.id)}
                  >
                    <span>
                      <strong>{chat.title}</strong>
                      <small>{chat.last_message_preview ?? "Обычный чат"}</small>
                    </span>
                  </button>
                ))}
                {navigationSearch && matchingChats.length === 0 && (
                  <p className="empty-projects">Чаты не найдены.</p>
                )}
                {localChatsHydrated && localChats.length === 0 && !navigationSearch && (
                  <p className="empty-projects">Пока нет чатов</p>
                )}
              </div>
            )}
          </section>
          <ChatArchivePanel onRestore={() => void loadGeneralChats()} />
          <section className="sidebar-section">
            <button
              type="button"
              className="projects-heading sidebar-section-toggle"
              aria-expanded={projectsExpanded}
              aria-controls="sidebar-project-list"
              onClick={() => setProjectsExpanded((current) => !current)}
            >
              <ToolIcon kind="projects" />
              <span>Проекты</span>
              <small>{projects.length}</small>
              <span className="section-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {projectsExpanded && (
              <div className="project-list" id="sidebar-project-list">
                {matchingProjects.map((project) => (
                  <button
                    key={project.id}
                    className={
                      surface === "manager" && activeProject?.id === project.id
                        ? "project-item active"
                        : "project-item"
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
                {navigationSearch && matchingProjects.length === 0 && (
                  <p className="empty-projects">Проекты не найдены.</p>
                )}
                {!loading && projects.length === 0 && !navigationSearch && (
                  <p className="empty-projects">Пока нет проектов</p>
                )}
              </div>
            )}
          </section>
          <div className="sidebar-tools" aria-label="Рабочие области">
            {TOOL_ITEMS.filter(
              (item) =>
                ![
                  "studio",
                  "files",
                  "images",
                  "video",
                  "sound",
                  "settings",
                  "apps",
                  "features"
                ].includes(item.id)
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={surface === item.id ? "sidebar-tool active" : "sidebar-tool"}
                aria-current={surface === item.id ? "page" : undefined}
                onClick={() => selectSurface(item.id)}
              >
                <ToolIcon kind={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
            <section className="sidebar-section studio-section">
              <button
                type="button"
                className="projects-heading sidebar-section-toggle studio-toggle"
                aria-expanded={studioExpanded}
                aria-controls="studio-tools"
                onClick={() => {
                  if (!studioExpanded) selectSurface("studio");
                  else setStudioExpanded(false);
                }}
              >
                <ToolIcon kind="studio" />
                <span>Cosmora Studio</span>
                <span className="section-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {studioExpanded && (
                <div className="studio-tools" id="studio-tools">
                  <button
                    type="button"
                    className={surface === "studio" ? "sidebar-tool active" : "sidebar-tool"}
                    aria-current={surface === "studio" ? "page" : undefined}
                    onClick={() => selectSurface("studio")}
                  >
                    <ToolIcon kind="studio" />
                    <span>Обзор Studio</span>
                  </button>
                  {STUDIO_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={surface === item.id ? "sidebar-tool active" : "sidebar-tool"}
                      aria-current={surface === item.id ? "page" : undefined}
                      onClick={() => selectSurface(item.id)}
                    >
                      <ToolIcon kind={item.id} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <button
              type="button"
              className={surface === "apps" ? "sidebar-tool active" : "sidebar-tool"}
              aria-current={surface === "apps" ? "page" : undefined}
              onClick={() => selectSurface("apps")}
            >
              <ToolIcon kind="apps" />
              <span>Приложения</span>
            </button>
            <button
              type="button"
              className={surface === "features" ? "sidebar-tool active" : "sidebar-tool"}
              aria-current={surface === "features" ? "page" : undefined}
              onClick={() => selectSurface("features")}
            >
              <ToolIcon kind="features" />
              <span>Возможности</span>
            </button>
          </div>
        </nav>

        <AccountMenu
          onSettings={() => selectSurface("settings")}
          controlCenterHref={controlCenterHref}
        />
      </aside>

      <main
        className={
          surface === "manager" && (activeProject || localChatMessages.length > 0)
            ? `workspace chat-workspace${activeProject ? "" : " general-chat-workspace"}`
            : surface !== "manager"
              ? "workspace tool-workspace"
              : "workspace"
        }
        id="workspace"
      >
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {surface === "manager"
                ? activeProject
                  ? "Активный проект"
                  : "Обычный чат"
                : "Cosmora workspace"}
            </span>
            <h1>
              {surface === "manager"
                ? (activeProject?.title ?? "Новый чат")
                : SURFACE_TITLE[surface]}
            </h1>
          </div>
          <InstallApp />
        </header>

        {activeProject && (
          <nav className="project-tabs" role="tablist" aria-label="Разделы проекта">
            <button
              type="button"
              role="tab"
              data-project-view="chat"
              aria-selected={projectView === "chat"}
              tabIndex={projectView === "chat" ? 0 : -1}
              className={projectView === "chat" ? "active" : ""}
              onClick={() => selectProjectView("chat")}
              onKeyDown={(event) => handleProjectTabKeyDown(event, "chat")}
            >
              <SparkIcon />
              Чат
            </button>
            <button
              type="button"
              role="tab"
              data-project-view="plan"
              aria-selected={projectView === "plan"}
              tabIndex={projectView === "plan" ? 0 : -1}
              className={projectView === "plan" ? "active" : ""}
              onClick={() => selectProjectView("plan")}
              onKeyDown={(event) => handleProjectTabKeyDown(event, "plan")}
            >
              <GridIcon />
              План
              {latestDemoRun && <span className="tab-indicator" aria-hidden="true" />}
            </button>
            <button
              type="button"
              role="tab"
              data-project-view="project"
              aria-selected={projectView === "project"}
              tabIndex={projectView === "project" ? 0 : -1}
              className={projectView === "project" ? "active" : ""}
              onClick={() => selectProjectView("project")}
              onKeyDown={(event) => handleProjectTabKeyDown(event, "project")}
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
            <button
              type="button"
              role="tab"
              data-project-view="context"
              aria-selected={projectView === "context"}
              tabIndex={projectView === "context" ? 0 : -1}
              className={projectView === "context" ? "active" : ""}
              onClick={() => selectProjectView("context")}
              onKeyDown={(event) => handleProjectTabKeyDown(event, "context")}
            >
              <ToolIcon kind="work" />
              Контекст
            </button>
          </nav>
        )}

        <div className="mobile-project-strip" aria-label="Быстрый выбор чата или проекта">
          <button
            className={!activeProject && !activeLocalChatId ? "active" : ""}
            onClick={newChat}
          >
            ＋ Новый
          </button>
          {localChats.slice(0, 5).map((chat) => (
            <button
              key={chat.id}
              className={!activeProject && activeLocalChatId === chat.id ? "active" : ""}
              onClick={() => void openLocalChat(chat.id)}
            >
              Чат · {chat.title}
            </button>
          ))}
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

        {activeProject &&
          projectView === "context" &&
          (contextPreview ? (
            <ProjectContextPreview
              projectId={activeProject.id}
              projectTitle={activeProject.title}
              messageCount={messages.length}
            />
          ) : (
            <ProjectContextPanel
              projectId={activeProject.id}
              projectTitle={activeProject.title}
              messageCount={messages.length}
            />
          ))}

        {activeProject && projectView === "plan" && (
          <div className="project-context view-panel" role="tabpanel" aria-label="План">
            <ManagerWorkPanel
              key={activeProject.id}
              projectId={activeProject.id}
              initialGoal={
                [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
              }
            />
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
                <span className="project-mode-label">Менеджер · мультиагентный проект</span>
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
                    {message.role === "user" ? <WorkspaceIcon name="owner" /> : <SparkIcon />}
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
                    <ChatResponse
                      content={displayedContent(message)}
                      assistant={message.role === "assistant"}
                      complete={message.status === "completed"}
                    />
                    <ChatMessageAttachments files={message.attachments ?? []} />
                  </div>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </section>
        ) : localChatMessages.length > 0 ? (
          <section className="chat-panel general-chat-panel" aria-label="Обычный чат Cosmora">
            {activeLocalChat && (
              <ChatHistoryActions
                key={activeLocalChat.id}
                id={activeLocalChat.id}
                title={activeLocalChat.title}
                messages={localChatMessages}
                disabled={sending || loading}
                onChange={(title) =>
                  setLocalChats((current) =>
                    current.map((chat) =>
                      chat.id === activeLocalChat.id ? { ...chat, title } : chat
                    )
                  )
                }
                onArchive={() => {
                  setLocalChats((current) =>
                    current.filter((chat) => chat.id !== activeLocalChat.id)
                  );
                  newChat();
                }}
              />
            )}
            <div className="chat-heading general-chat-heading">
              <div>
                <strong>Cosmora</strong>
                <small>
                  {lastCompletedRoute
                    ? `${lastCompletedRoute.provider} · ${lastCompletedRoute.model}`
                    : runtime && runtime.mode !== "mock"
                      ? `${runtime.model} · обычный чат`
                      : "Обычный чат · история на сервере · проект не создан"}
                </small>
              </div>
              <span className={`live-badge ${runPhase}`} role="status" aria-live="polite">
                <i /> {RUN_PHASE_LABEL[runPhase]}
              </span>
            </div>
            <div className="messages" aria-live="polite">
              {localChatMessages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span className="message-avatar">
                    {message.role === "user" ? <WorkspaceIcon name="owner" /> : <SparkIcon />}
                  </span>
                  <div>
                    <header>
                      <strong>{message.role === "user" ? "Вы" : "Cosmora"}</strong>
                      <time>
                        {new Date(message.created_at).toLocaleTimeString("ru", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </time>
                    </header>
                    <ChatResponse
                      content={displayedGeneralContent(message)}
                      assistant={message.role === "assistant"}
                      complete={message.status === "completed"}
                    />
                    <ChatMessageAttachments files={message.attachments ?? []} />
                  </div>
                </article>
              ))}
              {projectProposal && (
                <aside className="project-proposal" aria-label="Предложение создать проект">
                  <span className="proposal-icon">
                    <ToolIcon kind="multi-agent" />
                  </span>
                  <div>
                    <small>Оценка сложности · {projectProposal.assessment.score}</small>
                    <strong>Оформить задачу как проект?</strong>
                    <p>
                      Откроется Менеджер и подготовка мультиагентной команды. Никакие агенты или
                      внешние действия автоматически не запускаются.
                    </p>
                    <div className="proposal-actions">
                      <button
                        type="button"
                        disabled={loading || executionGate !== "clear"}
                        onClick={() => void promoteToProject()}
                      >
                        Оформить как проект
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={loading}
                        onClick={dismissProjectProposal}
                      >
                        Остаться в чате
                      </button>
                    </div>
                  </div>
                </aside>
              )}
              <div ref={messagesEndRef} />
            </div>
          </section>
        ) : !activeProject ? (
          <>
            <section className="hero">
              <h2>{greeting}</h2>
            </section>
          </>
        ) : null}

        <form
          autoComplete="off"
          className={
            activeProject || localChatMessages.length > 0 ? "composer chat-composer" : "composer"
          }
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="task">
            {activeProject ? "Сообщение менеджеру" : "Сообщение Cosmora"}
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
              activeProject ? "Уточните задачу или добавьте требование…" : "Спросите что-нибудь…"
            }
          />
          <div className="composer-controls">
            <div className="composer-tools">
              {
                <ChatAttachmentPicker
                  files={chatAttachments.files}
                  reading={chatAttachments.reading}
                  error={chatAttachments.error}
                  disabled={sending || loading}
                  onAdd={(files) => void chatAttachments.add(files)}
                  onRemove={(index) =>
                    chatAttachments.replace(
                      chatAttachments.files.filter((_, position) => position !== index)
                    )
                  }
                />
              }
              <WebSearchPanel
                scope={composerDraftKey}
                disabled={sending || loading || chatAttachments.reading}
                onAttach={(file) => {
                  const next = [...chatAttachments.files, file];
                  if (!isValidChatAttachments(next)) return false;
                  chatAttachments.replace(next);
                  return true;
                }}
              />
            </div>
            <div className="composer-footer">
              <span role={error ? "alert" : undefined} aria-live={error ? "assertive" : "polite"}>
                {error ?? (sending ? "Cosmora выполняет запуск…" : "")}
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
                  {error && (
                    <button
                      type="button"
                      className="restore-run"
                      onClick={() => void reloadShellData()}
                    >
                      ↻ Повторить
                    </button>
                  )}
                  {recoverableMessage && !draft.trim() && (
                    <button type="button" className="restore-run" onClick={restoreRunDraft}>
                      ↻ Вернуть запрос в редактор
                    </button>
                  )}
                  <button
                    disabled={
                      !draft.trim() ||
                      loading ||
                      chatAttachments.reading ||
                      executionGate !== "clear"
                    }
                    aria-label="Отправить"
                  >
                    <SendIcon />
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>

        {surface !== "manager" && (
          <WorkspaceSections
            key={surface}
            surface={surface}
            projects={projects}
            agentStudioHref={agentStudioHref}
            controlCenterHref={controlCenterHref}
            activeProjectId={activeProject?.id ?? null}
            loading={loading}
            error={error}
            onRetry={() => void reloadShellData()}
            onOpenProject={(id, view) => void openProject(id, view)}
            onNavigate={selectSurface}
            onCompose={(prompt, files = []) => {
              pendingComposeRef.current = { prompt, files };
              newChat();
            }}
            preferences={preferences}
            onPreferences={updatePreferences}
            preferencesNotice={preferencesNotice}
            runtime={runtime}
          />
        )}
      </main>

      <MobileNavigation
        surface={surface}
        onNewChat={newChat}
        onNavigate={selectSurface}
        chats={localChats}
        projects={projects}
        onOpenChat={(id) => void openLocalChat(id)}
        onOpenProject={(id) => void openProject(id)}
      />
    </div>
  );
}
