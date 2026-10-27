"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import { assessTaskComplexity, chooseGreeting, type TaskComplexity } from "./chat-mode";
import { SidebarResize, useSidebarWidth, useSidebarCollapse } from "./sidebar-resize";
import { InstallApp } from "./install-app";
import { ChatResponse } from "./chat-response";
import { VoiceComposer } from "./voice/voice-composer";
import { CompactVoicePlayback } from "./voice/voice-playback";
import { VoiceAssistant } from "./voice/voice-assistant";
import { LoadingDots } from "./ui/feedback";
import { ModelPicker, SystemMessage } from "./ui/kosmora-controls";
import { CanvasEditor } from "./canvas-editor/canvas-editor";
import canvasChat from "./canvas-editor/canvas-chat.module.css";
import { ChatHistoryActions } from "./chat-history-actions";
import { ChatBranches, ChatBranchButton } from "./chat-branches";
import { useChatNavigation, ChatContextPanel, ChatToCanvas } from "./chat-workspace";
import { ChatItemMenu } from "./chat-item-menu";
import { CreateProjectDialog } from "./create-project-dialog";
import { ChatSearchTrigger } from "./chat-search-trigger";
import { ProjectTitleEditor } from "./project-title-editor";
import { QuickSwitcher } from "./quick-switcher";
import { pinsFirst } from "./pinned-navigation";
import { clearComposerDraft, readComposerDraft, saveComposerDraft } from "./composer-draft-storage";
import {
  desktopDraftBridge,
  nativeDraftScope,
  purgeUnscopedLegacyDrafts
} from "./desktop-draft-bridge";
import { ProjectContextPanel } from "./project-context-panel";
import { ProjectContextPreview } from "./project-context-preview";
import { ManagerWorkPanel } from "./manager-work-panel";
import { useExecutionGate } from "./use-execution-gate";
import { WorkspaceIcon } from "./workspace-icons";
import { AccountMenu, MobileNavigation, WorkspaceModeMenu } from "./workspace-navigation";
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

type ChatMode = "kosmora" | "work" | "coscode";
type LocalChatSession = {
  mode?: ChatMode;
  id: string;
  title: string;
  messages: LocalChatMessage[];
  projectProposal: ProjectProposal | null;
  created_at: string;
  updated_at: string;
  last_message_preview?: string | null;
};

type GeneralChatAcceptedResponse = {
  chat: Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at" | "mode">;
  user_message: LocalChatMessage;
  run_id: string;
  stream_url: string;
};

type GeneralChatDetail = {
  chat: Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at" | "mode">;
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
  manager: "Kosmora",
  research: "Deep Research",
  presentations: "Презентации",
  sites: "Сайты",
  games: "Games",
  studio: "Kosmora Studio",
  files: "Анализ файлов",
  skills: "Skills",
  code: "Coscode",
  work: "Koswork",
  images: "Изображения",
  video: "Видео",
  sound: "Sound",
  "multi-agent": "Multi-Agent",
  apps: "Приложения",
  features: "Возможности",
  settings: "Настройки"
};

const isProjectView = (value: string | null): value is ProjectView =>
  value === "chat" || value === "plan" || value === "project" || value === "context";

const replaceConsoleRoute = (
  projectId: string | null,
  view: ProjectView = "chat",
  generalChatId: string | null = null
): void => {
  let route = projectId
    ? `/?project=${encodeURIComponent(projectId)}&view=${encodeURIComponent(view)}`
    : generalChatId
      ? `/?chat=${encodeURIComponent(generalChatId)}`
      : "/";
  const currentParams = new URLSearchParams(window.location.search);
  const mode = currentParams.get("mode");
  if (mode && ["kosmora", "work", "coscode"].includes(mode))
    route += `${route.includes("?") ? "&" : "?"}mode=${encodeURIComponent(mode)}`;
  if (currentParams.get("space") === "coscode")
    route += `${route.includes("?") ? "&" : "?"}space=coscode`;
  const planId = currentParams.get("plan");
  if (projectId && view === "plan" && currentParams.get("project") === projectId && planId)
    route += `&plan=${encodeURIComponent(planId)}`;
  if (currentParams.get("context_preview") === "1")
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

const CHAT_RUN_PHASE_LABEL: Record<RunPhase, string> = {
  ...RUN_PHASE_LABEL,
  running: "Kosmora отвечает",
  streaming: "Kosmora отвечает · поток"
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
    <path
      d="M12 19V5m-6 6 6-6 6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ToolIcon = ({ kind }: { kind: ToolSurface | "projects" | "new-chat" | "chats" }) => (
  <WorkspaceIcon name={kind} />
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path
      d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6ZM12 14v7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
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
  if (message.status === "failed" && message.error_code?.startsWith("IMAGE_"))
    return message.error_code === "IMAGE_REFERENCES_UNSUPPORTED"
      ? "Этот режим пока создаёт изображения по текстовому описанию. Уберите вложения и повторите запрос."
      : message.error_code === "IMAGE_PROMPT_TOO_LONG"
        ? "Сократите описание изображения до 2000 символов."
        : "Не удалось создать изображение. Автоматического повторного списания не было; можно повторить запрос вручную.";
  if (message.status === "failed" && message.error_code === "MEDIA_UNAVAILABLE")
    return "Генерация изображений сейчас недоступна. Текстовый чат продолжает работать.";
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
  const [canvasOpen, setCanvasOpen] = useState(false);
  const executionGate = useExecutionGate(activeProject?.id);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [autonomyProfile, setAutonomyProfile] = useState<AutonomyProfile | null>(null);
  const [policySignals, setPolicySignals] = useState<PolicySignals>(EMPTY_POLICY_SIGNALS);
  const [demoRuns, setDemoRuns] = useState<DemoManagerRun[]>([]);
  const [demoActionPending, setDemoActionPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftStorageReadyKey, setDraftStorageReadyKey] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftRecoveryNotice, setDraftRecoveryNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialRouteReady, setInitialRouteReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ModelRuntimeStatus | null>(null);
  const [, setLastCompletedRoute] = useState<CompletedRoute | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [projectView, setProjectView] = useState<ProjectView>("chat");
  const [contextPreview, setContextPreview] = useState(false);
  useEffect(() => {
    setContextPreview(new URLSearchParams(window.location.search).get("context_preview") === "1");
  }, []);
  const sidebarWidth = useSidebarWidth();
  const sidebarCollapse = useSidebarCollapse();
  const [surface, setSurface] = useState<WorkspaceSurface>("manager");
  const [chatMode, setChatMode] = useState<ChatMode>("kosmora");
  const [codeSpace, setCodeSpace] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [greeting, setGreeting] = useState("Чем могу помочь?");
  const [localChats, setLocalChats] = useState<LocalChatSession[]>([]);
  const chatNavigation = useChatNavigation();
  const pins = chatNavigation.navigation;
  const pinsHydrated = chatNavigation.ready;
  const pinNotice = chatNavigation.notice;
  const [contextChatId, setContextChatId] = useState<string | null>(null);
  const [activeLocalChatId, setActiveLocalChatId] = useState<string | null>(null);
  const [branchSelection, setBranchSelection] = useState<{
    chatId: string;
    message: LocalChatMessage;
  } | null>(null);
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
  const followMessagesRef = useRef(true);
  const [fileDragActive, setFileDragActive] = useState(false);

  const [voiceAssistantOpen, setVoiceAssistantOpen] = useState(false);
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
  const spaceChats = localChats.filter((chat) =>
    codeSpace ? ["coscode", "work"].includes(chat.mode ?? "kosmora") : chat.mode !== "coscode"
  );
  const matchingChats = pinsFirst(
    spaceChats.filter(
      (chat) => !navigationSearch || chat.title.toLocaleLowerCase("ru").includes(navigationSearch)
    ),
    pins.chats
  );
  const matchingProjects = pinsFirst(
    navigationSearch
      ? projects.filter((project) =>
          project.title.toLocaleLowerCase("ru").includes(navigationSearch)
        )
      : projects,
    pins.projects
  );
  const localChatMessages = activeLocalChat?.messages ?? EMPTY_LOCAL_CHAT_MESSAGES;
  const projectProposal = activeLocalChat?.projectProposal ?? null;
  const composerDraftKey = composerDraftStorageKey(
    activeProject?.id ?? selectedProjectRef.current,
    activeLocalChatId
  );
  const chatAttachments = useChatAttachments(`${composerDraftKey}:${viewEpochRef.current}`);
  const pendingComposeRef = useRef<{ prompt: string; files: ChatAttachment[] } | null>(null);
  const acceptedDraftRef = useRef<{ key: string; text: string } | null>(null);
  const pendingComposerFocusRef = useRef(false);
  const draftRecoveryKeyRef = useRef<string | null>(null);
  const attachmentScope = `${composerDraftKey}:${viewEpochRef.current}`;

  useEffect(() => {
    const field = composerRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(176, Math.max(56, field.scrollHeight))}px`;
  }, [draft, surface, activeProject?.id, localChatMessages.length]);
  const changePin = (kind: "chats" | "projects", id: string) => {
    void chatNavigation.mutate(`/api/v1/chat-navigation/pins/${kind}/${encodeURIComponent(id)}`, {
      pinned: !pins[kind].includes(id)
    });
  };

  useEffect(() => {
    setDraftStorageReadyKey(null);
    acceptedDraftRef.current = null;
    const native = desktopDraftBridge(window);
    const scope = nativeDraftScope(composerDraftKey);
    if (native) {
      // The pre-v0.11.1 localStorage drafts have no owner ID; removing them even
      // before login prevents the next account from reading their contents.
      try {
        purgeUnscopedLegacyDrafts(window.localStorage);
      } catch {
        /* best effort */
      }
      setDraft("");
      chatAttachments.replace([]); // Never restore file bytes into a native text-only draft.
      setDraftRecoveryNotice(null);
      let cancelled = false;
      if (!scope) {
        setDraftRecoveryNotice("Недопустимый идентификатор черновика.");
        setDraftStorageReadyKey(attachmentScope);
        return;
      }
      void native
        .load(scope)
        .then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setDraft(result.text ?? "");
            setDraftRecoveryNotice(
              result.text ? "Восстановлен локальный текстовый черновик Windows." : null
            );
          } else {
            setDraftRecoveryNotice(
              result.message ?? "Для восстановления требуется подтверждённый вход."
            );
          }
        })
        .catch(() => {
          if (!cancelled) setDraftRecoveryNotice("Черновик Windows пока недоступен.");
        })
        .finally(() => {
          if (!cancelled) setDraftStorageReadyKey(attachmentScope);
        });
      return () => {
        cancelled = true;
      };
    }
    try {
      const saved = readComposerDraft(window.localStorage, composerDraftKey);
      setDraft(saved.text);
      chatAttachments.replace(saved.files);
      const sameScope = draftRecoveryKeyRef.current === composerDraftKey;
      draftRecoveryKeyRef.current = composerDraftKey;
      // Strict-mode remount/reconciliation must not erase a recovery warning after
      // the available text has already been saved without the damaged materials.
      setDraftRecoveryNotice((current) => saved.notice ?? (sameScope ? current : null));
    } catch {
      setDraftRecoveryNotice("Сохранение черновика в этом браузере недоступно.");
    }
    setDraftStorageReadyKey(attachmentScope);
  }, [attachmentScope]);

  useEffect(() => {
    const pending = pendingComposeRef.current;
    if (!pending || draftStorageReadyKey !== attachmentScope) return;
    pendingComposeRef.current = null;
    setDraft(pending.prompt);
    chatAttachments.replace(pending.files);
    pendingComposerFocusRef.current = true;
    // Consume only after the new chat scope and its draft hydration have settled.
  }, [attachmentScope, chatAttachments, draftStorageReadyKey]);

  useEffect(() => {
    if (
      !pendingComposerFocusRef.current ||
      surface !== "manager" ||
      loading ||
      !initialRouteReady ||
      draftStorageReadyKey !== attachmentScope
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const composer = composerRef.current;
      if (!composer || composer.disabled) return;
      composer.focus();
      pendingComposerFocusRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attachmentScope, draftStorageReadyKey, initialRouteReady, loading, surface]);

  useEffect(() => {
    if (draftStorageReadyKey !== attachmentScope) return;
    const native = desktopDraftBridge(window);
    if (native) {
      const scope = nativeDraftScope(composerDraftKey);
      if (!scope) return;
      const flush = () => {
        // Do not resurrect a server-acknowledged message if the window closes
        // before React has committed the empty composer after acceptance.
        if (
          acceptedDraftRef.current?.key === composerDraftKey &&
          acceptedDraftRef.current.text === draft
        )
          return;
        native.flush(scope, draft);
      };
      window.addEventListener("pagehide", flush);
      let cancelled = false;
      const timer = window.setTimeout(() => {
        // A POST still in flight can have been accepted even if its HTTP response was lost.
        // Do not race a delayed autosave against a server-acknowledged clear.
        if (
          submitPendingRef.current ||
          (acceptedDraftRef.current?.key === composerDraftKey &&
            acceptedDraftRef.current.text === draft)
        )
          return;
        if (!draft) acceptedDraftRef.current = null;
        void native
          .save(scope, draft)
          .then((result) => {
            if (!cancelled)
              setDraftNotice(
                result.ok ? null : (result.message ?? "Не удалось сохранить черновик Windows.")
              );
          })
          .catch(() => {
            if (!cancelled) setDraftNotice("Не удалось сохранить черновик Windows.");
          });
      }, 300);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        window.removeEventListener("pagehide", flush);
      };
    }
    try {
      setDraftNotice(
        saveComposerDraft(window.localStorage, composerDraftKey, draft, chatAttachments.files)
      );
    } catch {
      setDraftNotice("Сохранение черновика в этом браузере недоступно.");
    }
  }, [attachmentScope, composerDraftKey, draft, draftStorageReadyKey, chatAttachments.files]);

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
        Pick<LocalChatSession, "id" | "title" | "created_at" | "updated_at" | "mode"> & {
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
      setError("API Kosmora пока недоступен. Проверьте локальное подключение и повторите попытку.");
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
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get("mode");
      const requestedSurface = params.get("surface");
      if (
        !isToolSurface(requestedSurface) &&
        ["kosmora", "work", "coscode"].includes(requestedMode ?? "")
      ) {
        setChatMode(requestedMode as ChatMode);
        setCodeSpace(requestedMode === "coscode" || params.get("space") === "coscode");
        setSurface("manager");
        setWorkspaceSurfaceHydrated(true);
        return;
      }
      if (requestedSurface === "work" || requestedSurface === "code") {
        setChatMode(requestedSurface === "code" ? "coscode" : "work");
        setCodeSpace(requestedSurface === "code");
        setSurface("manager");
        setWorkspaceSurfaceHydrated(true);
        return;
      }
      if (isToolSurface(requestedSurface)) {
        setSurface(requestedSurface);
        if (["studio", "files", "images", "video", "sound"].includes(requestedSurface))
          setStudioExpanded(true);
        setWorkspaceSurfaceHydrated(true);
        return;
      }
      const savedSurface = window.localStorage.getItem(WORKSPACE_SURFACE_STORAGE_KEY);
      if (isToolSurface(savedSurface)) {
        if (savedSurface === "work" || savedSurface === "code") {
          setChatMode(savedSurface === "code" ? "coscode" : "work");
          setCodeSpace(savedSurface === "code");
          setSurface("manager");
        } else setSurface(savedSurface);
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
      window.localStorage.setItem(
        WORKSPACE_SURFACE_STORAGE_KEY,
        surface === "manager"
          ? chatMode === "coscode"
            ? "code"
            : chatMode === "work"
              ? "work"
              : "manager"
          : surface
      );
    } catch {
      // Surface selection remains usable for the current page without persistence.
    }
  }, [surface, chatMode, workspaceSurfaceHydrated]);

  useEffect(() => {
    void reloadShellData();
    return () => {
      viewEpochRef.current += 1;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [reloadShellData]);

  useEffect(() => {
    followMessagesRef.current = true;
  }, [activeLocalChatId, activeProject?.id]);
  useEffect(() => {
    if (!followMessagesRef.current) return;
    const frame = requestAnimationFrame(() =>
      messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" })
    );
    return () => cancelAnimationFrame(frame);
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
    const requestId = ++viewRequestRef.current;
    const detail = await api<GeneralChatDetail>(
      `/api/v1/chats/${encodeURIComponent(generalChatId)}`
    );
    if (epoch !== viewEpochRef.current || requestId !== viewRequestRef.current) return;
    setChatMode(detail.chat.mode ?? "kosmora");
    if (detail.chat.mode !== "work") setCodeSpace(detail.chat.mode === "coscode");
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
        messages: detail.messages.map((message) => {
          const live = existing?.messages.find((candidate) => candidate.id === message.id);
          return message.status === "streaming" &&
            live &&
            live.content.length > message.content.length
            ? { ...message, content: live.content }
            : message;
        }),
        projectProposal: existing?.projectProposal ?? null
      };
      // Reading history updates cached content, not the server's activity order.
      return existing
        ? current.map((chat) => (chat.id === generalChatId ? updated : chat))
        : [...current, updated];
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
    async (
      projectId: string,
      view: ProjectView = "chat",
      restoredSurface: WorkspaceSurface = "manager"
    ): Promise<void> => {
      const epoch = ++viewEpochRef.current;
      setSurface(restoredSurface);
      selectedProjectRef.current = projectId;
      replaceConsoleRoute(projectId, view);
      if (restoredSurface !== "manager") {
        const route = new URL(window.location.href);
        route.searchParams.set("surface", restoredSurface);
        window.history.replaceState(
          window.history.state,
          "",
          `${route.pathname}${route.search}${route.hash}`
        );
      }
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
            setSurface("manager");
            pendingComposerFocusRef.current = true;
          }
          window.sessionStorage.removeItem(key);
        }
        window.history.replaceState(null, "", "/");
      } catch {
        setError("Не удалось открыть файл из GitHub. Прикрепите его к чату отдельно.");
      }
      setInitialRouteReady(true);
      return;
    }
    const projectId = params.get("project");
    if (!projectId) {
      const generalChatId = params.get("chat");
      if (generalChatId) {
        setActiveLocalChatId(generalChatId);
        setLoading(true);
        const epoch = viewEpochRef.current;
        void loadGeneralChatView(generalChatId)
          .catch(() => {
            if (epoch === viewEpochRef.current)
              setError("Не удалось открыть чат. Повторите выбор в истории.");
          })
          .finally(() => {
            if (epoch === viewEpochRef.current) {
              setLoading(false);
              setInitialRouteReady(true);
            }
          });
      } else {
        setInitialRouteReady(true);
      }
      return;
    }
    const requestedView = params.get("view");
    const requestedSurface = params.get("surface");
    void openProject(
      projectId,
      isProjectView(requestedView) ? requestedView : "chat",
      isToolSurface(requestedSurface) ? requestedSurface : "manager"
    ).finally(() => {
      setInitialRouteReady(true);
    });
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

      source.onopen = () => {
        if (isCurrent()) setError(null);
      };

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
        // EventSource reconnects to this read-only observer; it never resubmits input.
        if (source.readyState === EventSource.CLOSED) closeSource();
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
      source.onopen = () => {
        if (isCurrent()) setError(null);
      };
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
        viewRequestRef.current += 1;
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
      source.addEventListener("run.failed", (raw) => {
        if (!isCurrent()) return;
        const failure = JSON.parse(String(raw.data)) as { data: { error_code: string } };
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("failed");
        setError(
          failure.data.error_code === "RELAY_UNAVAILABLE"
            ? "Перевод не выполнен. Запрос не отправлен без English Relay. Можно выключить перевод и отправить исходный запрос вручную."
            : failure.data.error_code === "USAGE_LIMIT_EXCEEDED"
              ? "Лимит токенов достигнут. Измените квоту в персональных настройках."
              : "Ответ завершился с ошибкой. Внутренние детали скрыты."
        );
        void refreshGeneralChat(chatIdForRun).catch(() => undefined);
      });
      source.addEventListener("run.cancelled", () => {
        if (!isCurrent()) return;
        viewRequestRef.current += 1;
        finished = true;
        closeSource();
        setSending(false);
        setActiveRunId(null);
        setRunPhase("cancelled");
        void refreshGeneralChat(chatIdForRun).catch(() => undefined);
      });
      source.onerror = () => {
        if (!isCurrent()) return;
        if (source.readyState === EventSource.CLOSED) closeSource();
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
    viewRequestRef.current += 1;
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

  const submit = async (event?: FormEvent, voiceContent?: string): Promise<void> => {
    event?.preventDefault();
    const content = (voiceContent ?? draft).trim();
    if (
      !content ||
      sending ||
      loading ||
      !initialRouteReady ||
      draftStorageReadyKey !== attachmentScope ||
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
                  mode: chatMode,
                  client_message_id: clientId(),
                  attachments: chatAttachments.files
                })
              });
          acceptedDraftRef.current = { key: composerDraftKey, text: draft };
          const acceptedScope = nativeDraftScope(composerDraftKey);
          if (acceptedScope)
            void desktopDraftBridge(window)
              ?.clear(acceptedScope)
              .catch(() => undefined);
          try {
            clearComposerDraft(window.localStorage, composerDraftKey);
          } catch {
            /* Acceptance is authoritative. */
          }
          if (epoch !== viewEpochRef.current) {
            void loadGeneralChats().catch(() => undefined);
            return;
          }
          chatAttachments.replace([]);
          setDraft("");
          viewRequestRef.current += 1;
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
              messages: [
                ...(existing?.messages ?? []).filter(
                  (message) => message.id !== accepted.user_message.id
                ),
                accepted.user_message
              ],
              projectProposal: proposal
            };
            return [updated, ...current.filter((chat) => chat.id !== accepted.chat.id)];
          });
          try {
            clearComposerDraft(window.localStorage, composerDraftKey);
          } catch {
            // Server acceptance is authoritative even when local draft cleanup is unavailable.
          }
          setActiveLocalChatId(accepted.chat.id);
          replaceConsoleRoute(null, "chat", accepted.chat.id);
          followGeneralChatStream(accepted);
          void loadGeneralChats().catch(() => {
            if (epoch === viewEpochRef.current) {
              setError("Сообщение принято. Не удалось обновить список чатов.");
            }
          });
        } catch (cause) {
          if (epoch !== viewEpochRef.current) return;
          setDraft(content);
          const scope = nativeDraftScope(composerDraftKey);
          if (scope)
            void desktopDraftBridge(window)
              ?.save(scope, content)
              .catch(() => undefined);
          setSending(false);
          setRunPhase("failed");
          setError(
            `${cause instanceof Error ? cause.message : "Не удалось подтвердить отправку"} ` +
              "Если соединение прервалось, результат запроса неизвестен. Проверьте историю чата перед ручной повторной отправкой: она может списать токены повторно."
          );
        }
        return;
      }

      const epoch = viewEpochRef.current;

      setSending(true);
      selectProjectView("chat");
      setRunPhase("queued");
      setError(null);
      setLastCompletedRoute(null);
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

        acceptedDraftRef.current = { key: composerDraftKey, text: draft };
        const acceptedScope = nativeDraftScope(composerDraftKey);
        if (acceptedScope)
          void desktopDraftBridge(window)
            ?.clear(acceptedScope)
            .catch(() => undefined);
        try {
          clearComposerDraft(window.localStorage, composerDraftKey);
        } catch {
          /* Acceptance is authoritative. */
        }
        if (epoch !== viewEpochRef.current) {
          void loadProjects().catch(() => undefined);
          return;
        }
        selectedProjectRef.current = accepted.project.id;
        chatAttachments.replace([]);
        setDraft("");
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
        const scope = nativeDraftScope(composerDraftKey);
        if (scope)
          void desktopDraftBridge(window)
            ?.save(scope, content)
            .catch(() => undefined);
        setSending(false);
        setRunPhase("failed");
        setError(
          `${cause instanceof Error ? cause.message : "Не удалось подтвердить отправку"} ` +
            "Если соединение прервалось, результат запроса неизвестен. Проверьте историю чата перед ручной повторной отправкой: она может списать токены повторно."
        );
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
    // An explicit navigation replaces a still-pending initial route selection.
    setInitialRouteReady(true);
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
    replaceConsoleRoute(null, "chat", chatId);
  };

  const newChat = (): void => {
    // Explicitly starting afresh from the unnamed composer discards that draft.
    // Named chats/projects retain their own draft when navigating away.
    if (!activeProject && !selectedProjectRef.current && !activeLocalChatId) {
      const scope = nativeDraftScope(composerDraftKey);
      if (scope)
        void desktopDraftBridge(window)
          ?.clear(scope)
          .catch(() => undefined);
      try {
        clearComposerDraft(window.localStorage, composerDraftKey);
      } catch {
        /* Still clear the current view. */
      }
    }
    if (codeSpace) setChatMode("coscode");
    resetToLocalChat(null, true);
  };

  const openLocalChat = async (chatId: string): Promise<void> => {
    if (!localChats.some((chat) => chat.id === chatId)) return;
    const openingMode = localChats.find((chat) => chat.id === chatId)?.mode ?? "kosmora";
    setChatMode(openingMode);
    if (openingMode !== "work") setCodeSpace(openingMode === "coscode");
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

  const openChatBranch = async (
    id: string,
    accepted?: GeneralChatAcceptedResponse
  ): Promise<void> => {
    setBranchSelection(null);
    resetToLocalChat(id);
    const epoch = viewEpochRef.current;
    setLoading(true);
    try {
      await loadGeneralChats();
      if (epoch !== viewEpochRef.current) return;
      await loadGeneralChatView(id);
      if (epoch === viewEpochRef.current && accepted) {
        setSending(true);
        setRunPhase("queued");
        followGeneralChatStream(accepted);
      }
    } catch {
      if (epoch === viewEpochRef.current)
        setError("Вариант сохранён. Не удалось открыть переписку; выберите её в истории.");
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

  const selectSurface = (nextSurface: WorkspaceSurface): void => {
    if (["manager", "work", "code"].includes(nextSurface)) {
      const nextMode: ChatMode =
        nextSurface === "code" ? "coscode" : nextSurface === "work" ? "work" : "kosmora";
      if ((nextMode !== chatMode || surface !== "manager") && (activeLocalChatId || activeProject))
        resetToLocalChat(null);
      setChatMode(nextMode);
      setCodeSpace(nextMode === "coscode");
      setSurface("manager");
      const route = new URL(window.location.href);
      route.searchParams.delete("surface");
      route.searchParams.set("mode", nextMode);
      route.searchParams.set("space", nextMode === "coscode" ? "coscode" : "kosmora");
      window.history.replaceState(window.history.state, "", route.pathname + route.search);
      return;
    }
    if (nextSurface === "research" || nextSurface === "presentations") {
      window.location.assign(nextSurface === "research" ? "/research-workspace" : "/presentations");
      return;
    }
    setSurface(nextSurface);
    if (nextSurface === "manager") {
      replaceConsoleRoute(
        activeProject?.id ?? selectedProjectRef.current,
        projectView,
        activeLocalChatId
      );
      return;
    }
    if (["studio", "files", "images", "video", "sound"].includes(nextSurface))
      setStudioExpanded(true);
    const route = new URL(window.location.href);
    route.searchParams.delete("mode");
    route.searchParams.delete("space");
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
      style={{ "--sidebar-width": `${sidebarWidth.width}px` } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapse.collapsed || undefined}
    >
      <button
        type="button"
        className="sidebar-collapse-toggle"
        aria-label={
          sidebarCollapse.collapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"
        }
        title={sidebarCollapse.collapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"}
        aria-expanded={!sidebarCollapse.collapsed}
        onClick={sidebarCollapse.toggle}
      >
        <WorkspaceIcon name={sidebarCollapse.collapsed ? "panel-open" : "panel-close"} />
      </button>
      <aside
        className="sidebar"
        data-space={codeSpace ? "coscode" : "kosmora"}
        inert={sidebarCollapse.collapsed}
      >
        <SidebarResize width={sidebarWidth.width} onChange={sidebarWidth.setWidth} />
        <WorkspaceModeMenu
          surface={
            surface === "manager"
              ? codeSpace
                ? "code"
                : chatMode === "work"
                  ? "work"
                  : "manager"
              : surface
          }
          onNavigate={selectSurface}
        />
        {codeSpace && (
          <div className="coscode-space-tools">
            <Link
              href={
                activeProject
                  ? `/code-agent?project=${encodeURIComponent(activeProject.id)}`
                  : "/code-agent"
              }
            >
              <WorkspaceIcon name="code" /> Репозиторий и изменения
            </Link>
            <Link href="/github">
              <WorkspaceIcon name="projects" /> GitHub
            </Link>
            <Link href={controlCenterHref}>
              <WorkspaceIcon name="settings" /> Настройки Coscode
            </Link>
          </div>
        )}

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
              <small>{spaceChats.length}</small>
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
                  <div className="pinnable-navigation-item" key={chat.id}>
                    <button
                      type="button"
                      className={
                        surface === "manager" && activeLocalChatId === chat.id
                          ? "project-item chat-item active"
                          : "project-item chat-item"
                      }
                      onClick={() => void openLocalChat(chat.id)}
                    >
                      <span>
                        <strong id={`pin-chat-${chat.id}`}>{chat.title}</strong>
                        <small>{chat.last_message_preview ?? "Обычный чат"}</small>
                      </span>
                    </button>
                    <ChatItemMenu
                      id={chat.id}
                      title={chat.title}
                      pinned={pins.chats.includes(chat.id)}
                      disabled={!pinsHydrated || (sending && activeLocalChatId === chat.id)}
                      onPin={() => changePin("chats", chat.id)}
                      onOpen={() => void openLocalChat(chat.id)}
                      onRename={(title) =>
                        setLocalChats((current) =>
                          current.map((item) => (item.id === chat.id ? { ...item, title } : item))
                        )
                      }
                      onDelete={() => {
                        setLocalChats((current) => current.filter((item) => item.id !== chat.id));
                        if (activeLocalChatId === chat.id) newChat();
                      }}
                    />
                  </div>
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
          {pinNotice && (
            <p className="pin-notice" role="status">
              {pinNotice}
            </p>
          )}
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
                <button
                  type="button"
                  className="sidebar-create-project"
                  onClick={() => setCreateProjectOpen(true)}
                >
                  <WorkspaceIcon name="projects" />
                  <span>Создать проект</span>
                  <span aria-hidden="true">+</span>
                </button>
                {matchingProjects.map((project) => (
                  <div className="pinnable-navigation-item" key={project.id}>
                    <button
                      className={
                        surface === "manager" && activeProject?.id === project.id
                          ? "project-item active"
                          : "project-item"
                      }
                      onClick={() => void openProject(project.id)}
                    >
                      <span className="project-glyph">
                        {project.title.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong id={`pin-project-${project.id}`}>{project.title}</strong>
                        <small>{project.last_message_preview ?? "Новый проект"}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="navigation-pin"
                      aria-label={`${pins.projects.includes(project.id) ? "Открепить" : "Закрепить"} проект`}
                      aria-describedby={`pin-project-${project.id}`}
                      aria-pressed={pins.projects.includes(project.id)}
                      disabled={!pinsHydrated}
                      onClick={() => changePin("projects", project.id)}
                    >
                      <PinIcon />
                    </button>
                  </div>
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
                  "work",
                  "code",
                  "studio",
                  "files",
                  "images",
                  "video",
                  "sound",
                  "settings",
                  "apps",
                  "features",
                  "multi-agent",
                  "research",
                  "presentations",
                  "sites",
                  "games",
                  "skills"
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
            {!codeSpace && (
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
                  <span>Kosmora Studio</span>
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
            )}
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
        <header
          className={`topbar${surface === "manager" && !activeProject && !activeLocalChatId && !codeSpace ? " has-mode-switch" : ""}`}
        >
          <div>
            <span className="eyebrow">
              {surface === "manager"
                ? activeProject
                  ? "Активный проект"
                  : "Обычный чат"
                : "Kosmora workspace"}
            </span>
            <h1 id="workspace-title">
              {surface === "manager"
                ? (activeProject?.title ?? activeLocalChat?.title ?? "Новый чат")
                : SURFACE_TITLE[surface]}
            </h1>
          </div>
          {surface === "manager" && !activeProject && !activeLocalChatId && !codeSpace && (
            <div className="chat-mode-switch" role="group" aria-label="Режим нового чата">
              <button
                type="button"
                aria-pressed={chatMode === "kosmora"}
                onClick={() => selectSurface("manager")}
              >
                Чат
              </button>
              <button
                type="button"
                aria-pressed={chatMode === "work"}
                onClick={() => selectSurface("work")}
              >
                Работа
              </button>
            </div>
          )}
          <div className="topbar-actions">
            <InstallApp />
            {surface === "manager" && (
              <ChatHistoryActions
                key={`${activeLocalChat?.id ?? activeProject?.id ?? "new-chat"}:${activeLocalChat?.title ?? activeProject?.title ?? ""}`}
                id={activeProject ? null : (activeLocalChat?.id ?? null)}
                title={activeProject?.title ?? activeLocalChat?.title ?? "Новый чат"}
                messages={activeProject ? messages : localChatMessages}
                conversationId={activeProject ? chatId : (activeLocalChat?.id ?? null)}
                projectId={activeProject?.id ?? null}
                disabled={sending || loading}
                showRelay={!activeProject}
                onRecover={restoreRunDraft}
                runError={error}
                onVoice={() => {
                  setVoiceAssistantOpen(true);
                }}
                onChange={(title) =>
                  setLocalChats((current) =>
                    current.map((chat) =>
                      chat.id === activeLocalChat?.id ? { ...chat, title } : chat
                    )
                  )
                }
                onArchive={() => {
                  setLocalChats((current) =>
                    current.filter((chat) => chat.id !== activeLocalChat?.id)
                  );
                  newChat();
                }}
              />
            )}
            {surface === "manager" && (
              <ChatSearchTrigger
                title={activeProject?.title ?? activeLocalChat?.title ?? "Новый чат"}
                messages={activeProject ? messages : localChatMessages}
              />
            )}
            <QuickSwitcher
              hiddenTrigger
              chats={pinsFirst(spaceChats, pins.chats)}
              projects={pinsFirst(projects, pins.projects)}
              onNewChat={newChat}
              onOpenChat={(id) => void openLocalChat(id)}
              onOpenProject={(id) => void openProject(id)}
              onNavigate={selectSurface}
            />
            {surface === "manager" && (activeProject || activeLocalChat) && (
              <button
                type="button"
                className="topbar-pin"
                disabled={!pinsHydrated}
                aria-pressed={
                  activeProject
                    ? pins.projects.includes(activeProject.id)
                    : pins.chats.includes(activeLocalChat!.id)
                }
                aria-label={
                  activeProject
                    ? `${pins.projects.includes(activeProject.id) ? "Открепить" : "Закрепить"} проект`
                    : `${pins.chats.includes(activeLocalChat!.id) ? "Открепить" : "Закрепить"} чат`
                }
                aria-describedby="workspace-title"
                onClick={() =>
                  activeProject
                    ? changePin("projects", activeProject.id)
                    : changePin("chats", activeLocalChat!.id)
                }
              >
                <PinIcon />
              </button>
            )}
          </div>
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
          {spaceChats.slice(0, 5).map((chat) => (
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
            <ProjectTitleEditor
              key={activeProject.id}
              project={activeProject}
              onSaved={(renamed) => {
                setActiveProject((current) =>
                  current?.id === renamed.id ? { ...current, ...renamed } : current
                );
                setProjects((current) =>
                  current
                    .map((project) =>
                      project.id === renamed.id ? { ...project, ...renamed } : project
                    )
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                );
              }}
            />
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
                <strong>Kosmora Manager</strong>
                <span className="project-mode-label">Менеджер · мультиагентный проект</span>
                <small>Переписка</small>
              </div>
              <span className={`live-badge ${runPhase}`} role="status" aria-live="polite">
                <i /> {RUN_PHASE_LABEL[runPhase]}
              </span>
            </div>
            <button
              className={canvasChat.chatAction}
              type="button"
              onClick={() => setCanvasOpen((open) => !open)}
              aria-expanded={canvasOpen}
            >
              {canvasOpen ? "Закрыть Canvas" : "Открыть Canvas"}
            </button>
            <div className={canvasOpen ? canvasChat.chatSplit : canvasChat.chatBody}>
              <div
                className="messages"
                aria-live="polite"
                onScroll={(event) => {
                  const area = event.currentTarget;
                  followMessagesRef.current =
                    area.scrollHeight - area.scrollTop - area.clientHeight < 64;
                }}
              >
                {messages.map((message) => (
                  <article
                    key={message.id}
                    id={`chat-message-${message.id}`}
                    tabIndex={-1}
                    className={`message ${message.role}`}
                  >
                    {message.role === "user" && (
                      <span className="message-avatar">
                        <WorkspaceIcon name="owner" />
                      </span>
                    )}
                    <div>
                      {message.role !== "assistant" && (
                        <header>
                          <strong>Вы</strong>
                          <time>
                            {new Date(message.created_at).toLocaleTimeString("ru", {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </time>
                        </header>
                      )}
                      <ChatResponse
                        content={displayedContent(message)}
                        assistant={message.role === "assistant"}
                        complete={message.status === "completed" && message.role !== "system_event"}
                        streaming={message.status === "streaming"}
                        actions={
                          message.role === "assistant" && message.status === "completed" ? (
                            <CompactVoicePlayback text={message.content} />
                          ) : null
                        }
                        onFollowUp={(prompt) => {
                          setDraft((current) =>
                            current.trim() ? `${current}\n\n${prompt}` : prompt
                          );
                          composerRef.current?.focus();
                        }}
                      />
                      <ChatMessageAttachments files={message.attachments ?? []} />
                    </div>
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>
              {canvasOpen && (
                <div className={canvasChat.chatEditor}>
                  <CanvasEditor key={activeProject.id} projectId={activeProject.id} />
                </div>
              )}
            </div>
          </section>
        ) : localChatMessages.length > 0 ? (
          <section className="chat-panel general-chat-panel" aria-label="Обычный чат Kosmora">
            {activeLocalChatId && (
              <ChatBranches
                key={activeLocalChatId}
                chatId={activeLocalChatId}
                message={
                  branchSelection?.chatId === activeLocalChatId ? branchSelection.message : null
                }
                disabled={sending || loading}
                onClose={() => setBranchSelection(null)}
                onOpen={(id) => void openChatBranch(id)}
                onCreated={(accepted) => void openChatBranch(accepted.chat.id, accepted)}
              />
            )}
            {activeLocalChatId && contextChatId === activeLocalChatId && (
              <ChatContextPanel
                key={`context:${activeLocalChatId}`}
                chatId={activeLocalChatId}
                messages={localChatMessages}
                disabled={sending || loading || executionGate !== "clear"}
                onClose={() => setContextChatId(null)}
              />
            )}
            <div className="chat-heading general-chat-heading">
              <div>
                <strong>Kosmora</strong>
                <small>Переписка</small>
              </div>
              <span className={`live-badge ${runPhase}`} role="status" aria-live="polite">
                <i /> {CHAT_RUN_PHASE_LABEL[runPhase]}
              </span>
            </div>
            <div
              className="messages"
              aria-live="polite"
              onScroll={(event) => {
                const area = event.currentTarget;
                followMessagesRef.current =
                  area.scrollHeight - area.scrollTop - area.clientHeight < 64;
              }}
            >
              {localChatMessages.map((message) => (
                <article
                  key={message.id}
                  id={`chat-message-${message.id}`}
                  tabIndex={-1}
                  className={`message ${message.role}`}
                >
                  {message.role === "user" && (
                    <span className="message-avatar">
                      <WorkspaceIcon name="owner" />
                    </span>
                  )}
                  <div>
                    {message.role === "user" && (
                      <header>
                        <strong>Вы</strong>
                        <time>
                          {new Date(message.created_at).toLocaleTimeString("ru", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </time>
                      </header>
                    )}
                    <ChatResponse
                      content={displayedGeneralContent(message)}
                      assistant={message.role === "assistant"}
                      complete={message.status === "completed"}
                      streaming={message.status === "streaming"}
                      actions={
                        <>
                          {message.role === "assistant" && message.status === "completed" && (
                            <CompactVoicePlayback text={message.content} />
                          )}
                          {activeLocalChatId &&
                            message.role === "assistant" &&
                            message.status === "completed" && (
                              <ChatToCanvas
                                key={message.id}
                                chatId={activeLocalChatId}
                                message={message}
                                projects={projects}
                              />
                            )}
                          {activeLocalChatId &&
                            message.status !== "streaming" &&
                            message.status !== "pending" && (
                              <ChatBranchButton
                                assistant={message.role === "assistant"}
                                disabled={sending || loading || executionGate !== "clear"}
                                onClick={() =>
                                  setBranchSelection({ chatId: activeLocalChatId, message })
                                }
                              />
                            )}
                        </>
                      }
                      onFollowUp={(prompt) => {
                        setDraft((current) =>
                          current.trim() ? `${current}\n\n${prompt}` : prompt
                        );
                        composerRef.current?.focus();
                      }}
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
          data-file-drag={fileDragActive || undefined}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            if (
              !sending &&
              !loading &&
              initialRouteReady &&
              !chatAttachments.reading &&
              draftStorageReadyKey === attachmentScope
            )
              setFileDragActive(true);
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setFileDragActive(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setFileDragActive(false);
            if (
              sending ||
              loading ||
              !initialRouteReady ||
              chatAttachments.reading ||
              draftStorageReadyKey !== attachmentScope
            )
              return;
            const files = Array.from(event.dataTransfer.files);
            if (files.length) void chatAttachments.add(files);
          }}
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="task">
            {activeProject ? "Сообщение менеджеру" : "Сообщение Kosmora"}
          </label>
          <textarea
            id="task"
            ref={composerRef}
            value={draft}
            onChange={(event) => {
              setDraftRecoveryNotice(null);
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={
              sending || loading || !initialRouteReady || draftStorageReadyKey !== attachmentScope
            }
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
                  error={chatAttachments.error ?? draftNotice ?? draftRecoveryNotice}
                  disabled={
                    sending ||
                    loading ||
                    !initialRouteReady ||
                    draftStorageReadyKey !== attachmentScope
                  }
                  onAdd={(files) => void chatAttachments.add(files)}
                  onRemove={(index) =>
                    chatAttachments.replace(
                      chatAttachments.files.filter((_, position) => position !== index)
                    )
                  }
                />
              }
              <ModelPicker disabled={sending || loading || !initialRouteReady} />
            </div>
            <div className="composer-footer">
              <VoiceComposer
                disabled={sending || loading || !initialRouteReady}
                onInsert={(text) => setDraft((current) => (current ? `${current} ${text}` : text))}
              />
              {error ? (
                <SystemMessage>{error}</SystemMessage>
              ) : sending ? (
                <LoadingDots label="Kosmora выполняет запуск" />
              ) : (
                <span />
              )}
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
                  <span
                    className="composer-send-control"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!loading && initialRouteReady && !draft.trim())
                        setVoiceAssistantOpen(true);
                    }}
                  >
                    <button
                      type={draft.trim() ? "submit" : "button"}
                      data-send-mode={draft.trim() ? "text" : "voice"}
                      onClick={() => {
                        if (!draft.trim()) setVoiceAssistantOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ContextMenu" ||
                          (event.shiftKey && event.key === "F10")
                        ) {
                          event.preventDefault();
                          if (!draft.trim()) setVoiceAssistantOpen(true);
                        }
                      }}
                      disabled={
                        loading ||
                        !initialRouteReady ||
                        chatAttachments.reading ||
                        executionGate !== "clear"
                      }
                      aria-label={draft.trim() ? "Отправить" : "Открыть голосового помощника"}
                      title={draft.trim() ? "Отправить" : "Голосовой помощник"}
                    >
                      {draft.trim() ? <SendIcon /> : <WorkspaceIcon name="sound" />}
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>
        </form>

        {voiceAssistantOpen && (
          <VoiceAssistant
            onClose={() => setVoiceAssistantOpen(false)}
            onSend={(text) => submit(undefined, text)}
            busy={sending || loading}
            canSend={
              initialRouteReady &&
              draftStorageReadyKey === attachmentScope &&
              !draft.trim() &&
              !chatAttachments.files.length &&
              !chatAttachments.reading &&
              executionGate === "clear"
            }
            error={error}
            reply={(() => {
              const last = (activeProject ? messages : localChatMessages)
                .filter((message) => message.role === "assistant" && message.status === "completed")
                .at(-1);
              return last ? { id: last.id, text: last.content } : null;
            })()}
          />
        )}

        {surface !== "manager" && (
          <WorkspaceSections
            key={surface}
            surface={surface}
            projects={projects}
            agentStudioHref={agentStudioHref}
            controlCenterHref={controlCenterHref}
            activeProjectId={activeProject?.id ?? null}
            loading={loading || !initialRouteReady}
            error={error}
            onRetry={() => void reloadShellData()}
            onOpenProject={(id, view) => void openProject(id, view)}
            onLibraryProjectCreated={(id) => {
              void loadProjects().catch(() => undefined);
              void openProject(id, "chat", "files");
            }}
            onDataProjectAvailable={() => {
              void loadProjects().catch(() => undefined);
            }}
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

      {createProjectOpen && (
        <CreateProjectDialog
          onClose={() => setCreateProjectOpen(false)}
          onCreated={(id) => {
            setCreateProjectOpen(false);
            setProjectsExpanded(true);
            void loadProjects().catch(() => undefined);
            void openProject(id);
          }}
        />
      )}
      <MobileNavigation
        surface={
          surface === "manager"
            ? codeSpace
              ? "code"
              : chatMode === "work"
                ? "work"
                : "manager"
            : surface
        }
        onNewChat={newChat}
        onNavigate={selectSurface}
        chats={pinsFirst(spaceChats, pins.chats)}
        projects={pinsFirst(projects, pins.projects)}
        onOpenChat={(id) => void openLocalChat(id)}
        onOpenProject={(id) => void openProject(id)}
      />
    </div>
  );
}
