/**
 * @cosmora/contracts — Kosmora Mission Control Domain Contracts
 * Covers Missions, MissionTasks, Built-in Agent Roles, Orchestration Events,
 * Human-in-the-Loop Reviews, Versioned Mission Artifacts, and Budget Ledger.
 */

export type MissionStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_for_review"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export const MISSION_STATUSES: readonly MissionStatus[] = Object.freeze([
  "draft",
  "ready",
  "running",
  "waiting_for_review",
  "paused",
  "completed",
  "failed",
  "cancelled"
]);

/**
 * Explicit, verifiable state transition map for Mission entities.
 */
export const MISSION_ALLOWED_TRANSITIONS: Readonly<
  Record<MissionStatus, readonly MissionStatus[]>
> = Object.freeze({
  draft: Object.freeze(["ready", "running", "cancelled"]),
  ready: Object.freeze(["draft", "running", "paused", "cancelled"]),
  running: Object.freeze([
    "waiting_for_review",
    "paused",
    "completed",
    "failed",
    "cancelled"
  ]),
  waiting_for_review: Object.freeze([
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled"
  ]),
  paused: Object.freeze(["ready", "running", "cancelled"]),
  failed: Object.freeze(["ready", "running", "cancelled"]),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});

export type MissionTaskStatus =
  | "blocked"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_review"
  | "completed"
  | "failed"
  | "cancelled";

export const MISSION_TASK_STATUSES: readonly MissionTaskStatus[] = Object.freeze([
  "blocked",
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_review",
  "completed",
  "failed",
  "cancelled"
]);

/**
 * Explicit, verifiable state transition map for MissionTask entities.
 */
export const MISSION_TASK_ALLOWED_TRANSITIONS: Readonly<
  Record<MissionTaskStatus, readonly MissionTaskStatus[]>
> = Object.freeze({
  blocked: Object.freeze(["queued", "cancelled"]),
  queued: Object.freeze(["blocked", "running", "cancelled"]),
  running: Object.freeze([
    "waiting_for_input",
    "waiting_for_review",
    "completed",
    "failed",
    "cancelled",
    "queued"
  ]),
  waiting_for_input: Object.freeze(["queued", "running", "failed", "cancelled"]),
  waiting_for_review: Object.freeze([
    "completed",
    "queued",
    "running",
    "failed",
    "cancelled"
  ]),
  completed: Object.freeze([]),
  failed: Object.freeze(["queued", "running", "cancelled"]),
  cancelled: Object.freeze([])
});

export type MissionAgentRole =
  | "researcher"
  | "analyst"
  | "writer"
  | "reviewer"
  | "developer"
  | "designer"
  | "operator";

export const MISSION_AGENT_ROLES: readonly MissionAgentRole[] = Object.freeze([
  "researcher",
  "analyst",
  "writer",
  "reviewer",
  "developer",
  "designer",
  "operator"
]);

export type MissionUsageStatus =
  | "usage_tracked"
  | "usage_pending"
  | "usage_unavailable";

export interface MissionAgentRoleDefinition {
  readonly role: MissionAgentRole;
  readonly name: string;
  readonly description: string;
  readonly allowed_tools: readonly string[];
  readonly system_instruction: string;
  readonly default_budget_limit: number;
  readonly output_requirements: readonly string[];
  readonly escalation_rules: readonly string[];
}

export const KOSMORA_MISSION_AGENT_CATALOG: Readonly<
  Record<MissionAgentRole, MissionAgentRoleDefinition>
> = Object.freeze({
  researcher: Object.freeze({
    role: "researcher",
    name: "Исследователь (Researcher)",
    description:
      "Поисковый агент для сбора первоисточников, верификации цитат и формирования доказательной базы.",
    allowed_tools: Object.freeze([
      "web_search",
      "document_parser",
      "knowledge_graph_query",
      "citation_verifier"
    ]),
    system_instruction:
      "Собирай проверяемые факты и первоисточники по цели задачи. Каждое утверждение сопровождай точной ссылкой или цитатой.",
    default_budget_limit: 5.0,
    output_requirements: Object.freeze([
      "Список проверенных источников с цитатами",
      "Краткая сводка ключевых фактов",
      "Оценка достоверности данных"
    ]),
    escalation_rules: Object.freeze([
      "Запросить уточнение у владельца, если область поиска неоднозначна",
      "Передать на ревью при обнаружении противоречивых первоисточников"
    ])
  }),
  analyst: Object.freeze({
    role: "analyst",
    name: "Аналитик (Analyst)",
    description:
      "Структурный и финансовый анализ рынка, конкурентов, метрик и рисков на основе собранных данных.",
    allowed_tools: Object.freeze([
      "sql_readonly_query",
      "python_sandbox",
      "table_builder",
      "knowledge_graph_query"
    ]),
    system_instruction:
      "Анализируй входные артефакты, выделяй структуру рынка, сегменты, конкурентов и матрицу рисков без домыслов.",
    default_budget_limit: 6.0,
    output_requirements: Object.freeze([
      "Сравнительная таблица показателей и конкурентов",
      "Перечень ключевых рисков и допущений",
      "Количественные выводы на основе входов"
    ]),
    escalation_rules: Object.freeze([
      "Запросить уточнение при нехватке базовых метрик во входных артефактах",
      "Эскалировать человеку при расхождении цифр более чем на 15%"
    ])
  }),
  writer: Object.freeze({
    role: "writer",
    name: "Редактор отчётов (Writer)",
    description:
      "Синтез структурированных отчётов, меморандумов и структуры презентаций по результатам исследования и аналитики.",
    allowed_tools: Object.freeze([
      "markdown_compiler",
      "slide_outline_builder",
      "citation_verifier"
    ]),
    system_instruction:
      "Формируй чёткий, логически связный документ или структуру презентации строго по подтверждённым артефактам предыдущих задач.",
    default_budget_limit: 4.5,
    output_requirements: Object.freeze([
      "Структурированный Markdown-отчёт или план слайдов",
      "Привязка тезисов к артефактам исследования и аналитики"
    ]),
    escalation_rules: Object.freeze([
      "Передать черновик на обязательное согласование при наличии незакрытых рисков"
    ])
  }),
  reviewer: Object.freeze({
    role: "reviewer",
    name: "Агент-Ревьюер (Reviewer)",
    description:
      "Контроль качества, проверка фактов, поиск логических противоречий и аудит соответствия цели миссии.",
    allowed_tools: Object.freeze([
      "citation_verifier",
      "fact_consistency_checker",
      "policy_compliance_scanner"
    ]),
    system_instruction:
      "Проверяй все входные артефакты на фактическую точность, полноту раскрытия цели миссии и отсутствие внутренних противоречий.",
    default_budget_limit: 4.0,
    output_requirements: Object.freeze([
      "Отчёт о проверке фактов и найденных противоречиях",
      "Рекомендация к принятию или список замечаний для доработки"
    ]),
    escalation_rules: Object.freeze([
      "Всегда передавать вердикт на контрольную точку владельца (waiting_for_review)"
    ])
  }),
  developer: Object.freeze({
    role: "developer",
    name: "Инженер-разработчик (Developer)",
    description:
      "Разработка и проверка кодовых модулей, скриптов автоматизации, SQL-схем и технических спецификаций.",
    allowed_tools: Object.freeze([
      "node_ts_runner",
      "python_sandbox",
      "ast_code_navigator",
      "unit_test_runner"
    ]),
    system_instruction:
      "Пиши детерминированный, типизированный и безопасный код. Проверяй решение тестами в изолированной песочнице.",
    default_budget_limit: 8.0,
    output_requirements: Object.freeze([
      "Исходный код или технический патч",
      "Результат выполнения проверок и тестов"
    ]),
    escalation_rules: Object.freeze([
      "Запросить подтверждение владельца перед любыми необратимыми изменениями схемы",
      "Эскалировать при падении тестов после исчерпания попыток"
    ])
  }),
  designer: Object.freeze({
    role: "designer",
    name: "Проектировщик интерфейсов и схем (Designer)",
    description:
      "Проектирование пользовательских сценариев, архитектурных диаграмм, сетки экранов и визуальных спецификаций.",
    allowed_tools: Object.freeze([
      "diagram_renderer",
      "ui_layout_specifier",
      "slide_outline_builder"
    ]),
    system_instruction:
      "Проектируй строгие, минималистичные интерфейсы и понятные схемы зависимостей в монохромной эстетике Kosmora.",
    default_budget_limit: 4.5,
    output_requirements: Object.freeze([
      "Спецификация компонентов и состояний интерфейса",
      "Схема пользовательского потока или архитектуры"
    ]),
    escalation_rules: Object.freeze([
      "Передать макет или схему на ревью владельцу перед финализацией"
    ])
  }),
  operator: Object.freeze({
    role: "operator",
    name: "Оператор исполнения (Operator)",
    description:
      "Координация регламентных операций, сборка итогового пакета миссии, проверка бюджетов и подготовка экспорта.",
    allowed_tools: Object.freeze([
      "archive_exporter",
      "budget_auditor",
      "webhook_notifier"
    ]),
    system_instruction:
      "Контролируй соблюдение регламентов, лимитов бюджета и полноту выходного пакета перед закрытием миссии.",
    default_budget_limit: 3.5,
    output_requirements: Object.freeze([
      "Итоговый операционный чеклист миссии",
      "Сводный отчёт о расходе бюджета и статусе задач"
    ]),
    escalation_rules: Object.freeze([
      "Немедленно остановить запуск и уведомить владельца при приближении к лимиту бюджета"
    ])
  })
});

export type MissionEventType =
  | "mission.created"
  | "mission.started"
  | "mission.paused"
  | "mission.completed"
  | "task.queued"
  | "task.started"
  | "task.progress"
  | "task.waiting_for_review"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "artifact.created"
  | "budget.warning"
  | "budget.exceeded";

export const MISSION_EVENT_TYPES: readonly MissionEventType[] = Object.freeze([
  "mission.created",
  "mission.started",
  "mission.paused",
  "mission.completed",
  "task.queued",
  "task.started",
  "task.progress",
  "task.waiting_for_review",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "artifact.created",
  "budget.warning",
  "budget.exceeded"
]);

export type MissionArtifactKind =
  | "note"
  | "research"
  | "table"
  | "markdown_report"
  | "link"
  | "file"
  | "code_execution_result";

export const MISSION_ARTIFACT_KINDS: readonly MissionArtifactKind[] =
  Object.freeze([
    "note",
    "research",
    "table",
    "markdown_report",
    "link",
    "file",
    "code_execution_result"
  ]);

export type MissionTaskExecutionMode =
  | "auto"
  | "review_required"
  | "clarification_needed";

export type MissionReviewDecision = "approve" | "reject" | "send_back";

export interface Mission {
  id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  goal: string;
  context: string;
  status: MissionStatus;
  priority: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  budget_limit: number;
  budget_spent: number;
  usage_status: MissionUsageStatus;
  final_summary: string | null;
  final_artifact_id: string | null;
  version: number;
}

export interface AgentRunStepRecord {
  step_index: number;
  tool_or_action: string;
  summary: string;
  timestamp: string;
}

export interface AgentRunRecord {
  run_id: string;
  mission_id: string;
  task_id: string;
  agent_role: MissionAgentRole;
  attempt: number;
  input_snapshot: {
    instruction: string;
    mission_goal: string;
    mission_context: string;
    input_artifact_ids: string[];
    allowed_tools: string[];
    reviewer_feedback?: string | null;
    clarification_answer?: string | null;
  };
  steps: AgentRunStepRecord[];
  output_summary: string | null;
  status:
    | "running"
    | "waiting_for_input"
    | "waiting_for_review"
    | "completed"
    | "failed";
  cost_spent: number | null;
  usage_status: "recorded" | "usage_pending" | "usage_unavailable";
  provider_id: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface MissionTask {
  id: string;
  mission_id: string;
  project_id: string;
  tenant_id: string;
  title: string;
  instruction: string;
  assigned_agent_role: MissionAgentRole;
  execution_mode: MissionTaskExecutionMode;
  requested_tools: string[];
  status: MissionTaskStatus;
  priority: number;
  dependencies: string[];
  input_artifact_ids: string[];
  output_artifact_ids: string[];
  attempt_count: number;
  max_attempts: number;
  budget_limit: number;
  budget_spent: number;
  usage_status: MissionUsageStatus;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  clarification_question: string | null;
  clarification_answer: string | null;
  last_review_decision: MissionReviewDecision | null;
  last_review_comment: string | null;
  last_run: AgentRunRecord | null;
  version: number;
}

export interface MissionEvent {
  id: string;
  sequence_num: number;
  mission_id: string;
  project_id: string;
  tenant_id: string;
  task_id: string | null;
  artifact_id: string | null;
  event_type: MissionEventType;
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MissionArtifact {
  id: string;
  mission_id: string;
  task_id: string | null;
  project_id: string;
  tenant_id: string;
  kind: MissionArtifactKind;
  title: string;
  content: string;
  preview: string;
  version: number;
  final: boolean;
  metadata: Record<string, unknown>;
  created_by_role: MissionAgentRole | "owner";
  created_at: string;
}

export interface MissionBudgetLedgerEntry {
  id: string;
  mission_id: string;
  task_id: string | null;
  project_id: string;
  tenant_id: string;
  run_id: string;
  agent_role: MissionAgentRole | "system";
  amount_spent: number | null;
  usage_status: "recorded" | "usage_pending" | "usage_unavailable";
  provider_id: string;
  description: string;
  created_at: string;
}

export interface MissionDetailsSnapshot {
  mission: Mission;
  tasks: MissionTask[];
  artifacts: MissionArtifact[];
  events: MissionEvent[];
  budget_ledger: MissionBudgetLedgerEntry[];
  roles_catalog: readonly MissionAgentRoleDefinition[];
  runtime_available: boolean;
  runtime_status_message: string;
}

export interface MissionExportBundle {
  export_version: "1.0";
  exported_at: string;
  mission: Omit<Mission, "tenant_id">;
  tasks: Array<Omit<MissionTask, "tenant_id">>;
  artifacts: Array<Omit<MissionArtifact, "tenant_id">>;
  events: Array<Omit<MissionEvent, "tenant_id">>;
  budget_ledger: Array<Omit<MissionBudgetLedgerEntry, "tenant_id">>;
}
