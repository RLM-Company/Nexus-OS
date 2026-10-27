/**
 * Kosmora Mission Control — Core Domain, Role Catalog, DAG Orchestrator,
 * Human-in-the-Loop (HITL) Checkpoints, Budget Ledger, Artifact Versioning & Export Engine.
 */

import { createHash } from "node:crypto";
import {
  KosmoraEnterpriseSecurityEngine,
  type TenantPrincipal
} from "./kosmora-enterprise-security.js";
import {
  KosmoraRuntimeStore,
  type StoredMissionArtifactRow,
  type StoredMissionBudgetLedgerRow,
  type StoredMissionEventRow,
  type StoredMissionRow,
  type StoredMissionTaskRow
} from "./kosmora-runtime-store.js";

export type MissionStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_for_review"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionPriority = "low" | "medium" | "high" | "critical";

export type MissionTaskStatus =
  | "blocked"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_review"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionAgentRole =
  | "researcher"
  | "analyst"
  | "writer"
  | "reviewer"
  | "developer"
  | "designer"
  | "operator";

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

export type MissionArtifactKind =
  | "note"
  | "research"
  | "table"
  | "markdown_report"
  | "link"
  | "file"
  | "code_execution_result";

export type MissionReviewDecision = "approve" | "reject" | "send_back";

export type BudgetUsageStatus =
  | "tracked"
  | "usage_pending"
  | "usage_unavailable";

export type MissionTaskExecutionMode =
  | "autonomous"
  | "require_review"
  | "require_clarification";

export interface Mission {
  id: string;
  project_id: string;
  owner_id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  goal: string;
  context: string;
  status: MissionStatus;
  priority: MissionPriority;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  budget_limit: number;
  budget_spent: number;
  budget_usage_status: BudgetUsageStatus;
  final_summary: string | null;
  final_artifact_id: string | null;
  version: number;
}

export interface MissionTask {
  id: string;
  mission_id: string;
  title: string;
  instruction: string;
  assigned_agent_role: MissionAgentRole;
  execution_mode: MissionTaskExecutionMode;
  requested_tools: string[];
  status: MissionTaskStatus;
  priority: MissionPriority;
  dependencies: string[];
  input_artifact_ids: string[];
  output_artifact_ids: string[];
  attempt_count: number;
  max_attempts: number;
  budget_limit: number;
  budget_spent: number;
  budget_usage_status: BudgetUsageStatus;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  clarification_prompt: string | null;
  clarification_response: string | null;
  review_comment: string | null;
  version: number;
}

export interface AgentRoleSpec {
  role: MissionAgentRole;
  title: string;
  description: string;
  allowed_tools: readonly string[];
  system_instruction: string;
  default_budget_limit: number;
  output_requirements: readonly string[];
  escalation_rules: readonly string[];
}

export interface AgentRunStepRecord {
  step_index: number;
  timestamp: string;
  tool_used: string;
  summary: string;
}

export interface AgentRunRecord {
  run_id: string;
  mission_id: string;
  task_id: string;
  attempt_number: number;
  agent_role: MissionAgentRole;
  status:
    | "running"
    | "waiting_for_input"
    | "waiting_for_review"
    | "completed"
    | "failed"
    | "cancelled";
  input_snapshot: {
    instruction: string;
    context: string;
    input_artifact_ids: string[];
    allowed_tools: readonly string[];
    clarification_response: string | null;
    review_comment: string | null;
  };
  steps: AgentRunStepRecord[];
  output_summary: string | null;
  output_artifact_ids: string[];
  usage_cost: number | null;
  usage_status: BudgetUsageStatus;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface MissionEvent {
  id: string;
  mission_id: string;
  task_id: string | null;
  event_type: MissionEventType;
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MissionArtifact {
  id: string;
  mission_id: string;
  task_id: string | null;
  title: string;
  kind: MissionArtifactKind;
  version: number;
  preview: string;
  content: string;
  final: boolean;
  created_by_role: MissionAgentRole | "owner";
  created_at: string;
}

export interface MissionBudgetLedgerEntry {
  id: string;
  mission_id: string;
  task_id: string | null;
  run_id: string | null;
  agent_role: MissionAgentRole | "system";
  amount: number | null;
  usage_status: BudgetUsageStatus;
  description: string;
  created_at: string;
}

export interface MissionExportBundle {
  schema_version: "kosmora.mission.export.v1";
  exported_at: string;
  mission: Omit<Mission, "tenant_id" | "workspace_id">;
  tasks: MissionTask[];
  artifacts: MissionArtifact[];
  events: MissionEvent[];
  budget_ledger: MissionBudgetLedgerEntry[];
  runs: AgentRunRecord[];
}

export const MISSION_ALLOWED_TRANSITIONS: Readonly<
  Record<MissionStatus, readonly MissionStatus[]>
> = Object.freeze({
  draft: ["ready", "running", "cancelled"],
  ready: ["running", "paused", "cancelled", "draft"],
  running: [
    "waiting_for_review",
    "paused",
    "completed",
    "failed",
    "cancelled"
  ],
  waiting_for_review: [
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled"
  ],
  paused: ["ready", "running", "cancelled"],
  completed: [],
  failed: ["ready", "running", "cancelled"],
  cancelled: []
});

export const MISSION_TASK_ALLOWED_TRANSITIONS: Readonly<
  Record<MissionTaskStatus, readonly MissionTaskStatus[]>
> = Object.freeze({
  blocked: ["queued", "cancelled"],
  queued: ["blocked", "running", "failed", "cancelled"],
  running: [
    "waiting_for_input",
    "waiting_for_review",
    "completed",
    "failed",
    "cancelled",
    "queued"
  ],
  waiting_for_input: ["queued", "running", "failed", "cancelled"],
  waiting_for_review: ["completed", "queued", "failed", "cancelled"],
  completed: ["queued"],
  failed: ["queued", "cancelled"],
  cancelled: []
});

export const KOSMORA_MISSION_AGENT_CATALOG: Readonly<
  Record<MissionAgentRole, AgentRoleSpec>
> = Object.freeze({
  researcher: {
    role: "researcher",
    title: "Исследователь (Researcher)",
    description:
      "Поиск первоисточников, верификация фактов, сбор цитат и формирование доказательной базы.",
    allowed_tools: [
      "web_search",
      "knowledge_graph_query",
      "citation_extractor",
      "document_reader"
    ],
    system_instruction:
      "Находи проверяемые источники, фиксируй точные цитаты и ссылки, не выдумывай неподтверждённые данные.",
    default_budget_limit: 5.0,
    output_requirements: [
      "Минимум 2 проверенных источника или ссылки",
      "Структурированная сводка фактов с цитатами"
    ],
    escalation_rules: [
      "Запросить уточнение человека при противоречивых вводных или закрытом доступе к источнику"
    ]
  },
  analyst: {
    role: "analyst",
    title: "Аналитик (Analyst)",
    description:
      "Анализ рынка, конкурентов, метрик, рисков и построение сравнительных таблиц.",
    allowed_tools: [
      "data_table_builder",
      "risk_matrix_evaluator",
      "knowledge_graph_query",
      "metric_calculator"
    ],
    system_instruction:
      "Выделяй сегменты рынка, конкурентов, ключевые метрики и риски на основе входных артефактов.",
    default_budget_limit: 6.0,
    output_requirements: [
      "Сравнительная таблица показателей или конкурентов",
      "Реестр рисков с оценкой влияния"
    ],
    escalation_rules: [
      "Передать на ревью человеку при обнаружении критического риска или нехватки исходных данных"
    ]
  },
  writer: {
    role: "writer",
    title: "Автор-редактор (Writer)",
    description:
      "Синтез результатов исследования и аналитики в структурированные отчёты, меморандумы и презентации.",
    allowed_tools: [
      "markdown_composer",
      "outline_structurer",
      "document_reader"
    ],
    system_instruction:
      "Формируй чёткую структуру документа или презентации на русском языке строго по проверенным артефактам.",
    default_budget_limit: 4.5,
    output_requirements: [
      "Логичная структура разделов и тезисов",
      "Отсутствие неподтверждённых утверждений"
    ],
    escalation_rules: [
      "Передать черновик на утверждение владельцу миссии перед финализацией"
    ]
  },
  reviewer: {
    role: "reviewer",
    title: "Рецензент-верификатор (Reviewer)",
    description:
      "Проверка фактов, полноты покрытия цели, отсутствия внутренних противоречий и галлюцинаций.",
    allowed_tools: [
      "fact_consistency_checker",
      "citation_verifier",
      "policy_compliance_auditor"
    ],
    system_instruction:
      "Проверяй соответствие выводов первоисточникам и требованиям миссии, фиксируй замечания.",
    default_budget_limit: 3.5,
    output_requirements: [
      "Протокол верификации фактов и противоречий",
      "Вердикт готовности к сдаче владельцу"
    ],
    escalation_rules: [
      "Обязательная передача результата в статус waiting_for_review для финального решения человека"
    ]
  },
  developer: {
    role: "developer",
    title: "Инженер-разработчик (Developer)",
    description:
      "Проектирование кода, выполнение скриптов в песочнице, проверка алгоритмов и технических спецификаций.",
    allowed_tools: [
      "sandbox_code_runner",
      "ast_inspector",
      "schema_validator"
    ],
    system_instruction:
      "Пиши детерминированный, проверяемый код и возвращай воспроизводимый результат выполнения.",
    default_budget_limit: 7.0,
    output_requirements: [
      "Результат выполнения кода или проверенная спецификация",
      "Лог проверки без необработанных исключений"
    ],
    escalation_rules: [
      "Эскалация человеку при необходимости изменения внешних контрактов или превышении лимита попыток"
    ]
  },
  designer: {
    role: "designer",
    title: "Системный дизайнер (Designer)",
    description:
      "Проектирование структуры экранов, пользовательских сценариев, схем и информационных панелей.",
    allowed_tools: [
      "wireframe_spec_builder",
      "accessibility_checker",
      "layout_grid_planner"
    ],
    system_instruction:
      "Соблюдай строгую монохромную эстетику Kosmora (чёрный, белый, серый, без фиолетового) и ясную иерархию.",
    default_budget_limit: 4.0,
    output_requirements: [
      "Спецификация компонентов и состояний интерфейса",
      "Проверка контрастности и монохромной палитры"
    ],
    escalation_rules: [
      "Согласовать спорные UX-решения с владельцем миссии"
    ]
  },
  operator: {
    role: "operator",
    title: "Оператор исполнения (Operator)",
    description:
      "Оркестрация выпуска, сборка итогового пакета, проверка бюджетов и подготовка экспорта.",
    allowed_tools: [
      "export_packager",
      "budget_auditor",
      "runbook_executor"
    ],
    system_instruction:
      "Контролируй соблюдение бюджетов, целостность связей задач и готовность финального пакета миссии.",
    default_budget_limit: 3.0,
    output_requirements: [
      "Сводный отчёт исполнения и контрольная сумма пакета",
      "Подтверждение соблюдения бюджетных и проектных ограничений"
    ],
    escalation_rules: [
      "Немедленная остановка и уведомление владельца при достижении 80%/100% бюджета"
    ]
  }
});

export class MissionVersionConflictError extends Error {
  constructor(
    public readonly entity_type: "mission" | "task",
    public readonly entity_id: string,
    public readonly expected_version: number,
    public readonly actual_version: number
  ) {
    super(
      `Optimistic concurrency conflict on ${entity_type} '${entity_id}': expected version ${expected_version}, actual version ${actual_version}.`
    );
    this.name = "MissionVersionConflictError";
  }
}

export class MissionAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionAccessDeniedError";
  }
}

export class MissionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionNotFoundError";
  }
}

export class MissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionValidationError";
  }
}

export class MissionDependencyCycleError extends MissionValidationError {
  constructor(message: string) {
    super(message);
    this.name = "MissionDependencyCycleError";
  }
}

export class MissionRoleToolViolationError extends MissionValidationError {
  constructor(
    public readonly role: MissionAgentRole,
    public readonly forbidden_tools: string[]
  ) {
    super(
      `Role '${role}' is not allowed to use tools: ${forbidden_tools.join(", ")}.`
    );
    this.name = "MissionRoleToolViolationError";
  }
}

export class MissionBudgetExceededError extends MissionValidationError {
  constructor(message: string) {
    super(message);
    this.name = "MissionBudgetExceededError";
  }
}

export interface MissionAgentRuntimeResult {
  status:
    | "completed"
    | "waiting_for_review"
    | "waiting_for_input"
    | "failed";
  steps: AgentRunStepRecord[];
  output_summary: string;
  artifacts: Array<{
    title: string;
    kind: MissionArtifactKind;
    content: string;
    preview?: string;
    final?: boolean;
  }>;
  usage_cost: number | null;
  usage_status: BudgetUsageStatus;
  clarification_prompt?: string;
  failure_reason?: string;
}

export interface MissionAgentRuntimeAdapter {
  isRuntimeAvailable(): boolean;
  executeTaskRun(params: {
    mission: Mission;
    task: MissionTask;
    roleSpec: AgentRoleSpec;
    attemptNumber: number;
    inputArtifacts: MissionArtifact[];
  }): Promise<MissionAgentRuntimeResult> | MissionAgentRuntimeResult;
}

const PRIORITY_WEIGHT: Readonly<Record<MissionPriority, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

const ROLE_DEFAULT_ARTIFACT_KIND: Readonly<
  Record<MissionAgentRole, MissionArtifactKind>
> = {
  researcher: "research",
  analyst: "table",
  writer: "markdown_report",
  reviewer: "note",
  developer: "code_execution_result",
  designer: "file",
  operator: "link"
};

/**
 * Default deterministic runtime adapter for Kosmora Mission Control.
 * Can be toggled offline (`setAvailable(false)`) or configured to simulate provider
 * `usage_pending` / `usage_unavailable` states without fabricating fake numbers.
 */
export class DefaultKosmoraMissionRuntimeAdapter
  implements MissionAgentRuntimeAdapter
{
  private available = true;
  private usageMode: BudgetUsageStatus = "tracked";
  private customStepCost: number | null = null;

  public setRuntimeAvailable(available: boolean): void {
    this.available = available;
  }

  public setUsageReportingMode(
    mode: BudgetUsageStatus,
    customStepCost: number | null = null
  ): void {
    this.usageMode = mode;
    this.customStepCost = customStepCost;
  }

  public isRuntimeAvailable(): boolean {
    return this.available;
  }

  public executeTaskRun(params: {
    mission: Mission;
    task: MissionTask;
    roleSpec: AgentRoleSpec;
    attemptNumber: number;
    inputArtifacts: MissionArtifact[];
  }): MissionAgentRuntimeResult {
    if (!this.available) {
      return {
        status: "failed",
        steps: [],
        output_summary: "",
        artifacts: [],
        usage_cost: null,
        usage_status: "usage_unavailable",
        failure_reason:
          "Агентский runtime не подключён — выполнение задачи невозможно без активного рантайма."
      };
    }

    const { mission, task, roleSpec, attemptNumber, inputArtifacts } = params;
    const nowIso = new Date().toISOString();
    const toolsToUse =
      task.requested_tools.length > 0
        ? task.requested_tools
        : roleSpec.allowed_tools.slice(0, 2);

    const steps: AgentRunStepRecord[] = toolsToUse.map((tool, idx) => ({
      step_index: idx + 1,
      timestamp: nowIso,
      tool_used: tool,
      summary: `[${roleSpec.role}] Вызов ${tool} для задачи «${task.title}» (попытка #${attemptNumber})`
    }));

    if (
      task.execution_mode === "require_clarification" &&
      !task.clarification_response
    ) {
      return {
        status: "waiting_for_input",
        steps,
        output_summary: `Требуется уточнение владельца миссии по задаче «${task.title}».`,
        artifacts: [],
        usage_cost: this.usageMode === "tracked" ? (this.customStepCost ?? 0.25) : null,
        usage_status: this.usageMode,
        clarification_prompt: `Уточните, пожалуйста, ключевые параметры и ограничения для задачи «${task.title}» (цель миссии: ${mission.goal}).`
      };
    }

    const inputContextSummary =
      inputArtifacts.length > 0
        ? `Использованы входные артефакты (${inputArtifacts.length}): ${inputArtifacts
            .map((a) => `${a.title} (v${a.version})`)
            .join(", ")}.`
        : "Первичный этап без входных артефактов.";

    const reviewRevisionNote = task.review_comment
      ? `\nУчтён комментарий ревью человека: «${task.review_comment}».`
      : "";
    const clarificationNote = task.clarification_response
      ? `\nУчтено уточнение человека: «${task.clarification_response}».`
      : "";

    const artifactKind = ROLE_DEFAULT_ARTIFACT_KIND[task.assigned_agent_role];
    const artifactContent = [
      `# ${task.title}`,
      `- **Миссия**: ${mission.title}`,
      `- **Цель**: ${mission.goal}`,
      `- **Роль агента**: ${roleSpec.title}`,
      `- **Попытка**: #${attemptNumber}`,
      `- **Инструкция**: ${task.instruction}`,
      `- **Связь с предыдущими этапами**: ${inputContextSummary}${reviewRevisionNote}${clarificationNote}`,
      "",
      `## Результат выполнения (${roleSpec.role})`,
      roleSpec.output_requirements
        .map((req, idx) => `${idx + 1}. Выполнено требование: ${req}`)
        .join("\n")
    ].join("\n");

    const needsHumanReview =
      task.execution_mode === "require_review" ||
      task.assigned_agent_role === "reviewer";

    const computedCost =
      this.usageMode === "tracked"
        ? (this.customStepCost ??
          Number(Math.min(task.budget_limit * 0.4, 1.25).toFixed(4)))
        : null;

    return {
      status: needsHumanReview ? "waiting_for_review" : "completed",
      steps,
      output_summary: `Задача «${task.title}» выполнена ролью ${roleSpec.role} (попытка #${attemptNumber}). ${inputContextSummary}`,
      artifacts: [
        {
          title: `Результат: ${task.title}`,
          kind: artifactKind,
          content: artifactContent,
          preview: artifactContent.slice(0, 180),
          final: false
        }
      ],
      usage_cost: computedCost,
      usage_status: this.usageMode
    };
  }
}

export function isValidMissionTransition(
  from: MissionStatus,
  to: MissionStatus
): boolean {
  if (from === to) return true;
  return MISSION_ALLOWED_TRANSITIONS[from].includes(to);
}

export function isValidMissionTaskTransition(
  from: MissionTaskStatus,
  to: MissionTaskStatus
): boolean {
  if (from === to) return true;
  return MISSION_TASK_ALLOWED_TRANSITIONS[from].includes(to);
}

function sanitizeSecretsFromText(input: string): string {
  return input
    .replace(/ksm_sess\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9]{12,}/g, "[REDACTED_API_KEY]")
    .replace(/vault_secret_[A-Za-z0-9_-]+/gi, "[REDACTED_VAULT_SECRET]");
}

export class KosmoraMissionControlService {
  private readonly runtimeAdapter: DefaultKosmoraMissionRuntimeAdapter;
  private customAdapter: MissionAgentRuntimeAdapter | null = null;
  private readonly activeTaskLocks = new Set<string>();
  private readonly activeMissionLoops = new Set<string>();
  private readonly sseListeners = new Map<
    string,
    Set<(event: MissionEvent) => void>
  >();
  private readonly agentRunsByMission = new Map<string, AgentRunRecord[]>();
  private idCounter = 0;

  constructor(
    private readonly store: KosmoraRuntimeStore,
    private readonly security: KosmoraEnterpriseSecurityEngine,
    adapter?: MissionAgentRuntimeAdapter
  ) {
    this.store.ensureMissionControlSchema();
    this.runtimeAdapter = new DefaultKosmoraMissionRuntimeAdapter();
    if (adapter) {
      this.customAdapter = adapter;
    }
  }

  public getDefaultRuntimeAdapter(): DefaultKosmoraMissionRuntimeAdapter {
    return this.runtimeAdapter;
  }

  public setCustomRuntimeAdapter(
    adapter: MissionAgentRuntimeAdapter | null
  ): void {
    this.customAdapter = adapter;
  }

  private getAdapter(): MissionAgentRuntimeAdapter {
    return this.customAdapter ?? this.runtimeAdapter;
  }

  public listAgentRoles(): AgentRoleSpec[] {
    return Object.values(KOSMORA_MISSION_AGENT_CATALOG);
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    const entropy = createHash("sha256")
      .update(`${prefix}:${Date.now()}:${this.idCounter}:${Math.random()}`)
      .digest("hex")
      .slice(0, 10);
    return `${prefix}_${entropy}`;
  }

  private assertPrincipalAccessToMission(
    principal: TenantPrincipal,
    mission: Mission,
    requiredPermission: "workspace:read" | "workspace:write" | "dag:execute"
  ): void {
    const auth = this.security.authorizeAction(
      principal,
      mission.tenant_id,
      mission.workspace_id,
      requiredPermission
    );
    if (!auth.allowed) {
      throw new MissionAccessDeniedError(auth.reason);
    }
    if (
      principal.role !== "owner" &&
      principal.role !== "admin" &&
      mission.owner_id !== principal.user_id
    ) {
      throw new MissionAccessDeniedError(
        `Access denied: user '${principal.user_id}' does not own mission '${mission.id}' in project '${mission.project_id}'.`
      );
    }
  }

  private assertRoleToolsAllowed(
    role: MissionAgentRole,
    requestedTools: string[]
  ): AgentRoleSpec {
    const spec = KOSMORA_MISSION_AGENT_CATALOG[role];
    if (!spec) {
      throw new MissionValidationError(`Unknown agent role '${role}'.`);
    }
    const forbidden = requestedTools.filter(
      (tool) => !spec.allowed_tools.includes(tool)
    );
    if (forbidden.length > 0) {
      throw new MissionRoleToolViolationError(role, forbidden);
    }
    return spec;
  }

  private assertNoDependencyCycles(
    tasks: Array<{ id: string; dependencies: string[] }>
  ): void {
    const taskMap = new Map<string, string[]>();
    for (const t of tasks) {
      taskMap.set(t.id, t.dependencies);
    }

    for (const t of tasks) {
      for (const depId of t.dependencies) {
        if (!taskMap.has(depId)) {
          throw new MissionValidationError(
            `Task '${t.id}' references non-existent dependency '${depId}'.`
          );
        }
        if (depId === t.id) {
          throw new MissionDependencyCycleError(
            `Task '${t.id}' cannot depend on itself.`
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (visiting.has(nodeId)) {
        throw new MissionDependencyCycleError(
          `Dependency cycle detected in mission tasks: ${[...path, nodeId].join(" -> ")}`
        );
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      const deps = taskMap.get(nodeId) ?? [];
      for (const dep of deps) {
        dfs(dep, [...path, nodeId]);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    for (const t of tasks) {
      dfs(t.id, []);
    }
  }

  private priorityToNumber(p: MissionPriority | number): number {
    if (typeof p === "number") return p;
    return PRIORITY_WEIGHT[p] ?? 2;
  }

  private numberToPriority(n: number | string): MissionPriority {
    if (typeof n === "string") {
      if (n === "critical" || n === "high" || n === "medium" || n === "low") {
        return n;
      }
      const parsed = Number(n);
      if (!Number.isNaN(parsed)) n = parsed;
    }
    if (Number(n) >= 4) return "critical";
    if (Number(n) === 3) return "high";
    if (Number(n) === 1) return "low";
    return "medium";
  }

  private rowToMission(row: StoredMissionRow): Mission {
    return {
      id: row.id,
      project_id: row.project_id,
      owner_id: row.owner_id,
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
      title: row.title,
      goal: row.goal,
      context: row.context,
      status: row.status as MissionStatus,
      priority: this.numberToPriority(row.priority),
      created_at: row.created_at,
      updated_at: row.updated_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      budget_limit: Number(row.budget_limit),
      budget_spent: Number(row.budget_spent),
      budget_usage_status: (row.usage_status || "tracked") as BudgetUsageStatus,
      final_summary: row.final_summary,
      final_artifact_id: row.final_artifact_id,
      version: Number(row.version)
    };
  }

  private rowToTask(row: StoredMissionTaskRow): MissionTask {
    return {
      id: row.id,
      mission_id: row.mission_id,
      title: row.title,
      instruction: row.instruction,
      assigned_agent_role: row.assigned_agent_role as MissionAgentRole,
      execution_mode: row.execution_mode as MissionTaskExecutionMode,
      requested_tools: JSON.parse(row.requested_tools_json || "[]") as string[],
      status: row.status as MissionTaskStatus,
      priority: this.numberToPriority(row.priority),
      dependencies: JSON.parse(row.dependencies_json || "[]") as string[],
      input_artifact_ids: JSON.parse(
        row.input_artifact_ids_json || "[]"
      ) as string[],
      output_artifact_ids: JSON.parse(
        row.output_artifact_ids_json || "[]"
      ) as string[],
      attempt_count: Number(row.attempt_count),
      max_attempts: Number(row.max_attempts),
      budget_limit: Number(row.budget_limit),
      budget_spent: Number(row.budget_spent),
      budget_usage_status: (row.usage_status || "tracked") as BudgetUsageStatus,
      started_at: row.started_at,
      completed_at: row.completed_at,
      failure_reason: row.failure_reason,
      clarification_prompt: row.clarification_question,
      clarification_response: row.clarification_answer,
      review_comment: row.last_review_comment,
      version: Number(row.version)
    };
  }

  private rowToEvent(row: StoredMissionEventRow): MissionEvent {
    return {
      id: row.id,
      mission_id: row.mission_id,
      task_id: row.task_id,
      event_type: row.event_type as MissionEventType,
      actor_id: row.actor_id,
      payload: JSON.parse(row.payload_json || "{}") as Record<string, unknown>,
      created_at: row.created_at
    };
  }

  private rowToArtifact(row: StoredMissionArtifactRow): MissionArtifact {
    return {
      id: row.id,
      mission_id: row.mission_id,
      task_id: row.task_id,
      title: row.title,
      kind: row.kind as MissionArtifactKind,
      version: Number(row.version),
      preview: row.preview,
      content: row.content,
      final: Number(row.is_final) === 1,
      created_by_role: row.created_by_role as MissionAgentRole | "owner",
      created_at: row.created_at
    };
  }

  private rowToBudgetLedger(
    row: StoredMissionBudgetLedgerRow
  ): MissionBudgetLedgerEntry {
    return {
      id: row.id,
      mission_id: row.mission_id,
      task_id: row.task_id,
      run_id: row.run_id,
      agent_role: row.agent_role as MissionAgentRole | "system",
      amount: row.amount_spent === null ? null : Number(row.amount_spent),
      usage_status: row.usage_status as BudgetUsageStatus,
      description: row.description,
      created_at: row.created_at
    };
  }

  private emitEvent(params: {
    mission_id: string;
    task_id?: string | null;
    artifact_id?: string | null;
    event_type: MissionEventType;
    actor_id: string;
    payload?: Record<string, unknown>;
  }): MissionEvent {
    const mRow = this.store.getMissionRowById(params.mission_id);
    const existingEvents = this.store.listMissionEventRows(params.mission_id);
    const nextSeq = existingEvents.length + 1;
    const eventRow: StoredMissionEventRow = {
      id: this.nextId("mev"),
      sequence_num: nextSeq,
      mission_id: params.mission_id,
      project_id: mRow?.project_id ?? "proj_default",
      tenant_id: mRow?.tenant_id ?? "tenant_default",
      task_id: params.task_id ?? null,
      artifact_id: params.artifact_id ?? null,
      event_type: params.event_type,
      actor_id: params.actor_id,
      payload_json: JSON.stringify(params.payload ?? {}),
      created_at: new Date().toISOString()
    };
    this.store.insertMissionEventRow(eventRow);
    const event = this.rowToEvent(eventRow);
    const listeners = this.sseListeners.get(params.mission_id);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Ignore individual listener errors
        }
      }
    }
    return event;
  }

  public subscribeMissionEvents(
    missionId: string,
    listener: (event: MissionEvent) => void
  ): () => void {
    let set = this.sseListeners.get(missionId);
    if (!set) {
      set = new Set();
      this.sseListeners.set(missionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.sseListeners.delete(missionId);
      }
    };
  }

  private saveMissionWithTransition(
    current: Mission,
    patch: Partial<Omit<Mission, "id" | "version">>,
    expectedVersion?: number
  ): Mission {
    const nextStatus = patch.status ?? current.status;
    if (!isValidMissionTransition(current.status, nextStatus)) {
      throw new MissionValidationError(
        `Invalid mission status transition: '${current.status}' -> '${nextStatus}'.`
      );
    }
    const versionToMatch = expectedVersion ?? current.version;
    const nowIso = new Date().toISOString();
    const nextPriority = patch.priority ?? current.priority;
    const updatedRow: StoredMissionRow = {
      id: current.id,
      project_id: patch.project_id ?? current.project_id,
      owner_id: patch.owner_id ?? current.owner_id,
      tenant_id: patch.tenant_id ?? current.tenant_id,
      workspace_id: patch.workspace_id ?? current.workspace_id,
      title: patch.title ?? current.title,
      goal: patch.goal ?? current.goal,
      context: patch.context ?? current.context,
      status: nextStatus,
      priority: this.priorityToNumber(nextPriority),
      created_at: current.created_at,
      updated_at: nowIso,
      started_at:
        patch.started_at !== undefined ? patch.started_at : current.started_at,
      completed_at:
        patch.completed_at !== undefined
          ? patch.completed_at
          : current.completed_at,
      budget_limit: patch.budget_limit ?? current.budget_limit,
      budget_spent: patch.budget_spent ?? current.budget_spent,
      usage_status: patch.budget_usage_status ?? current.budget_usage_status,
      final_summary:
        patch.final_summary !== undefined
          ? patch.final_summary
          : current.final_summary,
      final_artifact_id:
        patch.final_artifact_id !== undefined
          ? patch.final_artifact_id
          : current.final_artifact_id,
      version: versionToMatch + 1
    };

    const ok = this.store.updateMissionRowOptimistic(
      updatedRow,
      versionToMatch
    );
    if (!ok) {
      const latest = this.store.getMissionRowById(current.id);
      throw new MissionVersionConflictError(
        "mission",
        current.id,
        versionToMatch,
        latest?.version ?? -1
      );
    }
    return this.rowToMission(updatedRow);
  }

  private saveTaskWithTransition(
    current: MissionTask,
    patch: Partial<Omit<MissionTask, "id" | "mission_id" | "version">>,
    expectedVersion?: number
  ): MissionTask {
    const nextStatus = patch.status ?? current.status;
    if (!isValidMissionTaskTransition(current.status, nextStatus)) {
      throw new MissionValidationError(
        `Invalid task status transition on '${current.id}': '${current.status}' -> '${nextStatus}'.`
      );
    }
    const versionToMatch = expectedVersion ?? current.version;
    const mRow = this.store.getMissionRowById(current.mission_id);
    const nextPriority = patch.priority ?? current.priority;
    const updatedRow: StoredMissionTaskRow = {
      id: current.id,
      mission_id: current.mission_id,
      project_id: mRow?.project_id ?? "proj_default",
      tenant_id: mRow?.tenant_id ?? "tenant_default",
      title: patch.title ?? current.title,
      instruction: patch.instruction ?? current.instruction,
      assigned_agent_role:
        patch.assigned_agent_role ?? current.assigned_agent_role,
      execution_mode: patch.execution_mode ?? current.execution_mode,
      requested_tools_json: JSON.stringify(
        patch.requested_tools ?? current.requested_tools
      ),
      status: nextStatus,
      priority: this.priorityToNumber(nextPriority),
      dependencies_json: JSON.stringify(
        patch.dependencies ?? current.dependencies
      ),
      input_artifact_ids_json: JSON.stringify(
        patch.input_artifact_ids ?? current.input_artifact_ids
      ),
      output_artifact_ids_json: JSON.stringify(
        patch.output_artifact_ids ?? current.output_artifact_ids
      ),
      attempt_count: patch.attempt_count ?? current.attempt_count,
      max_attempts: patch.max_attempts ?? current.max_attempts,
      budget_limit: patch.budget_limit ?? current.budget_limit,
      budget_spent: patch.budget_spent ?? current.budget_spent,
      usage_status: patch.budget_usage_status ?? current.budget_usage_status,
      started_at:
        patch.started_at !== undefined ? patch.started_at : current.started_at,
      completed_at:
        patch.completed_at !== undefined
          ? patch.completed_at
          : current.completed_at,
      failure_reason:
        patch.failure_reason !== undefined
          ? patch.failure_reason
          : current.failure_reason,
      clarification_question:
        patch.clarification_prompt !== undefined
          ? patch.clarification_prompt
          : current.clarification_prompt,
      clarification_answer:
        patch.clarification_response !== undefined
          ? patch.clarification_response
          : current.clarification_response,
      last_review_decision: null,
      last_review_comment:
        patch.review_comment !== undefined
          ? patch.review_comment
          : current.review_comment,
      last_run_json: null,
      version: versionToMatch + 1
    };

    const ok = this.store.updateMissionTaskRowOptimistic(
      updatedRow,
      versionToMatch
    );
    if (!ok) {
      const latest = this.store.getMissionTaskRowById(current.id);
      throw new MissionVersionConflictError(
        "task",
        current.id,
        versionToMatch,
        latest?.version ?? -1
      );
    }
    return this.rowToTask(updatedRow);
  }

  public createMission(params: {
    principal: TenantPrincipal;
    workspace_id?: string;
    project_id: string;
    title: string;
    goal: string;
    context?: string;
    priority?: MissionPriority;
    budget_limit?: number;
  }): Mission {
    const workspaceId = params.workspace_id ?? "ws_default";
    const auth = this.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      workspaceId,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new MissionAccessDeniedError(auth.reason);
    }

    const title = params.title.trim();
    const goal = params.goal.trim();
    if (!title || !goal) {
      throw new MissionValidationError(
        "Mission title and goal are required and cannot be empty."
      );
    }
    const budgetLimit = Number(params.budget_limit ?? 25.0);
    if (!Number.isFinite(budgetLimit) || budgetLimit <= 0) {
      throw new MissionValidationError(
        "Mission budget_limit must be a positive number."
      );
    }

    const nowIso = new Date().toISOString();
    const row: StoredMissionRow = {
      id: this.nextId("msn"),
      project_id: params.project_id.trim(),
      owner_id: params.principal.user_id,
      tenant_id: params.principal.tenant_id,
      workspace_id: workspaceId,
      title,
      goal,
      context: (params.context ?? "").trim(),
      status: "draft",
      priority: this.priorityToNumber(params.priority ?? "medium"),
      created_at: nowIso,
      updated_at: nowIso,
      started_at: null,
      completed_at: null,
      budget_limit: budgetLimit,
      budget_spent: 0,
      usage_status: "tracked",
      final_summary: null,
      final_artifact_id: null,
      version: 1
    };

    this.store.insertMissionRow(row);
    const mission = this.rowToMission(row);

    this.emitEvent({
      mission_id: mission.id,
      event_type: "mission.created",
      actor_id: params.principal.user_id,
      payload: {
        title: mission.title,
        goal: mission.goal,
        project_id: mission.project_id,
        budget_limit: mission.budget_limit,
        priority: mission.priority
      }
    });

    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, "mission.create", mission.id, "allow", {
        project_id: mission.project_id,
        budget_limit: mission.budget_limit
      });

    return mission;
  }

  public listMissions(params: {
    principal: TenantPrincipal;
    project_id?: string;
    status?: MissionStatus;
  }): Mission[] {
    const rows = this.store.listMissionRows({
      tenant_id: params.principal.tenant_id,
      project_id: params.project_id,
      status: params.status
    });
    return rows
      .map((r) => this.rowToMission(r))
      .filter(
        (m) =>
          params.principal.role === "owner" ||
          params.principal.role === "admin" ||
          m.owner_id === params.principal.user_id
      );
  }

  public getMissionDetails(params: {
    principal: TenantPrincipal;
    mission_id: string;
  }): {
    mission: Mission;
    tasks: MissionTask[];
    artifacts: MissionArtifact[];
    events: MissionEvent[];
    budget_ledger: MissionBudgetLedgerEntry[];
    runs: AgentRunRecord[];
    roles: AgentRoleSpec[];
    runtime_available: boolean;
  } {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:read"
    );

    const tasks = this.store
      .listMissionTaskRows(mission.id)
      .map((t) => this.rowToTask(t));
    const artifacts = this.store
      .listMissionArtifactRows(mission.id)
      .map((a) => this.rowToArtifact(a));
    const events = this.store
      .listMissionEventRows(mission.id)
      .map((e) => this.rowToEvent(e));
    const budgetLedger = this.store
      .listMissionBudgetLedgerRows(mission.id)
      .map((b) => this.rowToBudgetLedger(b));
    const runs = [...(this.agentRunsByMission.get(mission.id) ?? [])];

    return {
      mission,
      tasks,
      artifacts,
      events,
      budget_ledger: budgetLedger,
      runs,
      roles: this.listAgentRoles(),
      runtime_available: this.getAdapter().isRuntimeAvailable()
    };
  }

  public updateMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
    expected_version?: number;
    title?: string;
    goal?: string;
    context?: string;
    priority?: MissionPriority;
    status?: MissionStatus;
    budget_limit?: number;
  }): Mission {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const current = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      current,
      "workspace:write"
    );

    if (
      params.budget_limit !== undefined &&
      (!Number.isFinite(params.budget_limit) || params.budget_limit <= 0)
    ) {
      throw new MissionValidationError(
        "budget_limit must be a positive number."
      );
    }

    return this.saveMissionWithTransition(
      current,
      {
        title: params.title?.trim() ?? current.title,
        goal: params.goal?.trim() ?? current.goal,
        context:
          params.context !== undefined
            ? params.context.trim()
            : current.context,
        priority: params.priority ?? current.priority,
        status: params.status ?? current.status,
        budget_limit: params.budget_limit ?? current.budget_limit
      },
      params.expected_version
    );
  }

  public createTask(params: {
    principal: TenantPrincipal;
    mission_id: string;
    id?: string;
    title: string;
    instruction: string;
    assigned_agent_role: MissionAgentRole;
    execution_mode?: MissionTaskExecutionMode;
    requested_tools?: string[];
    priority?: MissionPriority;
    dependencies?: string[];
    input_artifact_ids?: string[];
    max_attempts?: number;
    budget_limit?: number;
  }): MissionTask {
    const missionRow = this.store.getMissionRowById(params.mission_id);
    if (!missionRow) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(missionRow);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    if (
      mission.status === "completed" ||
      mission.status === "cancelled"
    ) {
      throw new MissionValidationError(
        `Cannot add tasks to a mission in '${mission.status}' status.`
      );
    }

    const title = params.title.trim();
    const instruction = params.instruction.trim();
    if (!title || !instruction) {
      throw new MissionValidationError(
        "Task title and instruction are required."
      );
    }

    const requestedTools = params.requested_tools ?? [];
    const roleSpec = this.assertRoleToolsAllowed(
      params.assigned_agent_role,
      requestedTools
    );

    const existingTasks = this.store
      .listMissionTaskRows(mission.id)
      .map((r) => this.rowToTask(r));
    const taskId = params.id?.trim() || this.nextId("tsk");
    const dependencies = Array.from(new Set(params.dependencies ?? []));

    this.assertNoDependencyCycles([
      ...existingTasks.map((t) => ({ id: t.id, dependencies: t.dependencies })),
      { id: taskId, dependencies }
    ]);

    const allDepsCompleted = dependencies.every((depId) => {
      const depTask = existingTasks.find((t) => t.id === depId);
      return depTask?.status === "completed";
    });
    const initialStatus: MissionTaskStatus = allDepsCompleted
      ? "queued"
      : "blocked";

    const maxAttempts = Number(params.max_attempts ?? 3);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new MissionValidationError(
        "Task max_attempts must be an integer >= 1."
      );
    }

    const budgetLimit = Number(
      params.budget_limit ?? roleSpec.default_budget_limit
    );
    if (!Number.isFinite(budgetLimit) || budgetLimit <= 0) {
      throw new MissionValidationError(
        "Task budget_limit must be a positive number."
      );
    }

    const row: StoredMissionTaskRow = {
      id: taskId,
      mission_id: mission.id,
      project_id: mission.project_id,
      tenant_id: mission.tenant_id,
      title,
      instruction,
      assigned_agent_role: params.assigned_agent_role,
      execution_mode:
        params.execution_mode ??
        (params.assigned_agent_role === "reviewer"
          ? "require_review"
          : "autonomous"),
      requested_tools_json: JSON.stringify(requestedTools),
      status: initialStatus,
      priority: this.priorityToNumber(params.priority ?? mission.priority),
      dependencies_json: JSON.stringify(dependencies),
      input_artifact_ids_json: JSON.stringify(params.input_artifact_ids ?? []),
      output_artifact_ids_json: JSON.stringify([]),
      attempt_count: 0,
      max_attempts: maxAttempts,
      budget_limit: budgetLimit,
      budget_spent: 0,
      usage_status: "tracked",
      started_at: null,
      completed_at: null,
      failure_reason: null,
      clarification_question: null,
      clarification_answer: null,
      last_review_decision: null,
      last_review_comment: null,
      last_run_json: null,
      version: 1
    };

    this.store.insertMissionTaskRow(row);
    const createdTask = this.rowToTask(row);

    if (mission.status === "draft") {
      this.saveMissionWithTransition(mission, { status: "ready" });
    }

    if (initialStatus === "queued") {
      this.emitEvent({
        mission_id: mission.id,
        task_id: createdTask.id,
        event_type: "task.queued",
        actor_id: params.principal.user_id,
        payload: {
          title: createdTask.title,
          assigned_agent_role: createdTask.assigned_agent_role,
          priority: createdTask.priority
        }
      });
    }

    return createdTask;
  }

  public updateTask(params: {
    principal: TenantPrincipal;
    mission_id: string;
    task_id: string;
    expected_version?: number;
    title?: string;
    instruction?: string;
    assigned_agent_role?: MissionAgentRole;
    execution_mode?: MissionTaskExecutionMode;
    requested_tools?: string[];
    priority?: MissionPriority;
    dependencies?: string[];
    input_artifact_ids?: string[];
    max_attempts?: number;
    budget_limit?: number;
    status?: MissionTaskStatus;
    clarification_response?: string;
  }): MissionTask {
    const missionRow = this.store.getMissionRowById(params.mission_id);
    if (!missionRow) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(missionRow);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    const taskRow = this.store.getMissionTaskRowById(params.task_id);
    if (!taskRow || taskRow.mission_id !== mission.id) {
      throw new MissionNotFoundError(
        `Task '${params.task_id}' not found in mission '${mission.id}'.`
      );
    }
    const currentTask = this.rowToTask(taskRow);

    const nextRole =
      params.assigned_agent_role ?? currentTask.assigned_agent_role;
    const nextTools = params.requested_tools ?? currentTask.requested_tools;
    this.assertRoleToolsAllowed(nextRole, nextTools);

    const allTasks = this.store
      .listMissionTaskRows(mission.id)
      .map((r) => this.rowToTask(r));
    const nextDependencies =
      params.dependencies !== undefined
        ? Array.from(new Set(params.dependencies))
        : currentTask.dependencies;

    this.assertNoDependencyCycles(
      allTasks.map((t) =>
        t.id === currentTask.id
          ? { id: t.id, dependencies: nextDependencies }
          : { id: t.id, dependencies: t.dependencies }
      )
    );

    let nextStatus = params.status ?? currentTask.status;

    if (nextStatus === "running") {
      const unfulfilled = nextDependencies.filter((depId) => {
        const dep = allTasks.find((t) => t.id === depId);
        return dep?.status !== "completed";
      });
      if (unfulfilled.length > 0) {
        throw new MissionValidationError(
          `Cannot start task '${currentTask.id}' while dependencies are incomplete: ${unfulfilled.join(", ")}.`
        );
      }
    }

    if (
      params.dependencies !== undefined &&
      (currentTask.status === "blocked" || currentTask.status === "queued")
    ) {
      const allDepsCompleted = nextDependencies.every((depId) => {
        const dep = allTasks.find((t) => t.id === depId);
        return dep?.status === "completed";
      });
      nextStatus = allDepsCompleted ? "queued" : "blocked";
    }

    if (
      params.clarification_response !== undefined &&
      currentTask.status === "waiting_for_input"
    ) {
      nextStatus = "queued";
    }

    const updated = this.saveTaskWithTransition(
      currentTask,
      {
        title: params.title?.trim() ?? currentTask.title,
        instruction: params.instruction?.trim() ?? currentTask.instruction,
        assigned_agent_role: nextRole,
        execution_mode: params.execution_mode ?? currentTask.execution_mode,
        requested_tools: nextTools,
        priority: params.priority ?? currentTask.priority,
        dependencies: nextDependencies,
        input_artifact_ids:
          params.input_artifact_ids ?? currentTask.input_artifact_ids,
        max_attempts: params.max_attempts ?? currentTask.max_attempts,
        budget_limit: params.budget_limit ?? currentTask.budget_limit,
        status: nextStatus,
        clarification_response:
          params.clarification_response !== undefined
            ? params.clarification_response
            : currentTask.clarification_response
      },
      params.expected_version
    );

    if (nextStatus === "cancelled" && currentTask.status !== "cancelled") {
      this.emitEvent({
        mission_id: mission.id,
        task_id: updated.id,
        event_type: "task.cancelled",
        actor_id: params.principal.user_id,
        payload: { title: updated.title }
      });
    } else if (nextStatus === "queued" && currentTask.status !== "queued") {
      this.emitEvent({
        mission_id: mission.id,
        task_id: updated.id,
        event_type: "task.queued",
        actor_id: params.principal.user_id,
        payload: { title: updated.title }
      });
    }

    return updated;
  }

  public deleteTask(params: {
    principal: TenantPrincipal;
    mission_id: string;
    task_id: string;
  }): { deleted: boolean; task_id: string } {
    const missionRow = this.store.getMissionRowById(params.mission_id);
    if (!missionRow) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(missionRow);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    const taskRow = this.store.getMissionTaskRowById(params.task_id);
    if (!taskRow || taskRow.mission_id !== mission.id) {
      throw new MissionNotFoundError(
        `Task '${params.task_id}' not found in mission '${mission.id}'.`
      );
    }
    if (taskRow.status === "running") {
      throw new MissionValidationError(
        `Cannot delete currently running task '${params.task_id}'.`
      );
    }

    const otherTasks = this.store
      .listMissionTaskRows(mission.id)
      .map((r) => this.rowToTask(r))
      .filter((t) => t.id !== params.task_id);

    for (const dependent of otherTasks) {
      if (dependent.dependencies.includes(params.task_id)) {
        const cleanedDeps = dependent.dependencies.filter(
          (d) => d !== params.task_id
        );
        const allDone = cleanedDeps.every(
          (depId) =>
            otherTasks.find((t) => t.id === depId)?.status === "completed"
        );
        this.saveTaskWithTransition(dependent, {
          dependencies: cleanedDeps,
          status:
            dependent.status === "blocked" && allDone
              ? "queued"
              : dependent.status
        });
      }
    }

    const deleted = this.store.deleteMissionTaskRow(mission.id, params.task_id);
    return { deleted, task_id: params.task_id };
  }

  private unlockDependentTasks(
    missionId: string,
    actorId: string
  ): MissionTask[] {
    const tasks = this.store
      .listMissionTaskRows(missionId)
      .map((r) => this.rowToTask(r));
    const unlocked: MissionTask[] = [];

    for (const task of tasks) {
      if (task.status !== "blocked") continue;
      const depsCompleted = task.dependencies.every((depId) => {
        const dep = tasks.find((t) => t.id === depId);
        return dep?.status === "completed";
      });
      if (depsCompleted) {
        const updatedTask = this.saveTaskWithTransition(task, {
          status: "queued"
        });
        this.emitEvent({
          mission_id: missionId,
          task_id: updatedTask.id,
          event_type: "task.queued",
          actor_id: actorId,
          payload: {
            title: updatedTask.title,
            unlocked_by_dependencies: task.dependencies
          }
        });
        unlocked.push(updatedTask);
      }
    }
    return unlocked;
  }

  private sortReadyTasks(tasks: MissionTask[]): MissionTask[] {
    return [...tasks].sort((a, b) => {
      const weightDiff =
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (weightDiff !== 0) return weightDiff;
      return a.id.localeCompare(b.id);
    });
  }

  private recordBudgetCharge(params: {
    mission: Mission;
    task: MissionTask;
    run_id: string;
    amount: number | null;
    usage_status: BudgetUsageStatus;
    actor_id: string;
  }): { mission: Mission; task: MissionTask; exceeded: boolean } {
    const ledgerRow: StoredMissionBudgetLedgerRow = {
      id: this.nextId("mbl"),
      mission_id: params.mission.id,
      task_id: params.task.id,
      project_id: params.mission.project_id,
      tenant_id: params.mission.tenant_id,
      run_id: params.run_id,
      agent_role: params.task.assigned_agent_role,
      amount_spent: params.amount,
      usage_status: params.usage_status,
      provider_id: "kosmora_runtime_provider",
      description:
        params.amount !== null
          ? `Списание по задаче «${params.task.title}» (${params.task.assigned_agent_role})`
          : `Статус расхода провайдера: ${params.usage_status} для задачи «${params.task.title}»`,
      created_at: new Date().toISOString()
    };
    this.store.insertMissionBudgetLedgerRow(ledgerRow);

    if (params.amount === null || params.usage_status !== "tracked") {
      const updatedTask = this.saveTaskWithTransition(params.task, {
        budget_usage_status: params.usage_status
      });
      const updatedMission = this.saveMissionWithTransition(params.mission, {
        budget_usage_status: params.usage_status
      });
      return {
        mission: updatedMission,
        task: updatedTask,
        exceeded: false
      };
    }

    const prevMissionRatio =
      params.mission.budget_spent / params.mission.budget_limit;
    const prevTaskRatio = params.task.budget_spent / params.task.budget_limit;

    const newTaskSpent = Number(
      (params.task.budget_spent + params.amount).toFixed(4)
    );
    const newMissionSpent = Number(
      (params.mission.budget_spent + params.amount).toFixed(4)
    );

    const newMissionRatio = newMissionSpent / params.mission.budget_limit;
    const newTaskRatio = newTaskSpent / params.task.budget_limit;

    const updatedTask = this.saveTaskWithTransition(params.task, {
      budget_spent: newTaskSpent,
      budget_usage_status: "tracked"
    });
    const updatedMission = this.saveMissionWithTransition(params.mission, {
      budget_spent: newMissionSpent,
      budget_usage_status: "tracked"
    });

    if (
      (prevMissionRatio < 0.8 && newMissionRatio >= 0.8) ||
      (prevTaskRatio < 0.8 && newTaskRatio >= 0.8)
    ) {
      this.emitEvent({
        mission_id: updatedMission.id,
        task_id: updatedTask.id,
        event_type: "budget.warning",
        actor_id: params.actor_id,
        payload: {
          mission_budget_spent: updatedMission.budget_spent,
          mission_budget_limit: updatedMission.budget_limit,
          task_budget_spent: updatedTask.budget_spent,
          task_budget_limit: updatedTask.budget_limit,
          threshold_percent: 80
        }
      });
    }

    const exceeded =
      newMissionSpent >= updatedMission.budget_limit ||
      newTaskSpent >= updatedTask.budget_limit;
    if (exceeded) {
      this.emitEvent({
        mission_id: updatedMission.id,
        task_id: updatedTask.id,
        event_type: "budget.exceeded",
        actor_id: params.actor_id,
        payload: {
          mission_budget_spent: updatedMission.budget_spent,
          mission_budget_limit: updatedMission.budget_limit,
          task_budget_spent: updatedTask.budget_spent,
          task_budget_limit: updatedTask.budget_limit
        }
      });
    }

    return {
      mission: updatedMission,
      task: updatedTask,
      exceeded
    };
  }

  private createArtifactRecord(params: {
    mission_id: string;
    task_id: string | null;
    title: string;
    kind: MissionArtifactKind;
    content: string;
    preview?: string;
    final: boolean;
    created_by_role: MissionAgentRole | "owner";
    actor_id: string;
  }): MissionArtifact {
    const existing = this.store
      .listMissionArtifactRows(params.mission_id)
      .map((r) => this.rowToArtifact(r))
      .filter((a) => a.task_id === params.task_id && a.kind === params.kind);
    const nextVersion =
      existing.reduce((maxV, a) => Math.max(maxV, a.version), 0) + 1;

    const cleanContent = sanitizeSecretsFromText(params.content);
    const preview = sanitizeSecretsFromText(
      params.preview ?? cleanContent.slice(0, 180)
    );

    const mRow = this.store.getMissionRowById(params.mission_id);
    const row: StoredMissionArtifactRow = {
      id: this.nextId("art"),
      mission_id: params.mission_id,
      task_id: params.task_id,
      project_id: mRow?.project_id ?? "proj_default",
      tenant_id: mRow?.tenant_id ?? "tenant_default",
      title: params.title,
      kind: params.kind,
      version: nextVersion,
      preview,
      content: cleanContent,
      is_final: params.final ? 1 : 0,
      metadata_json: "{}",
      created_by_role: params.created_by_role,
      created_at: new Date().toISOString()
    };
    this.store.insertMissionArtifactRow(row);
    const artifact = this.rowToArtifact(row);

    this.emitEvent({
      mission_id: params.mission_id,
      task_id: params.task_id,
      event_type: "artifact.created",
      actor_id: params.actor_id,
      payload: {
        artifact_id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        version: artifact.version,
        final: artifact.final
      }
    });

    return artifact;
  }

  private executeSingleTask(
    missionId: string,
    taskId: string,
    actorId: string
  ): void {
    if (this.activeTaskLocks.has(taskId)) {
      return;
    }
    this.activeTaskLocks.add(taskId);

    try {
      const missionRow = this.store.getMissionRowById(missionId);
      const taskRow = this.store.getMissionTaskRowById(taskId);
      if (!missionRow || !taskRow) return;

      let mission = this.rowToMission(missionRow);
      let task = this.rowToTask(taskRow);

      if (mission.status !== "running") return;
      if (task.status !== "queued") return;

      const allTasks = this.store
        .listMissionTaskRows(mission.id)
        .map((r) => this.rowToTask(r));
      const depsCompleted = task.dependencies.every((depId) => {
        const dep = allTasks.find((t) => t.id === depId);
        return dep?.status === "completed";
      });
      if (!depsCompleted) {
        this.saveTaskWithTransition(task, { status: "blocked" });
        return;
      }

      if (
        mission.budget_spent >= mission.budget_limit ||
        task.budget_spent >= task.budget_limit
      ) {
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "budget.exceeded",
          actor_id: actorId,
          payload: {
            mission_budget_spent: mission.budget_spent,
            mission_budget_limit: mission.budget_limit,
            task_budget_spent: task.budget_spent,
            task_budget_limit: task.budget_limit
          }
        });
        this.saveTaskWithTransition(task, {
          status: "failed",
          failure_reason: "Превышен бюджетный лимит миссии или задачи."
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.failed",
          actor_id: actorId,
          payload: { reason: "Превышен бюджетный лимит миссии или задачи." }
        });
        this.saveMissionWithTransition(mission, { status: "failed" });
        return;
      }

      if (task.attempt_count >= task.max_attempts) {
        this.saveTaskWithTransition(task, {
          status: "failed",
          failure_reason: `Исчерпан лимит попыток (${task.attempt_count}/${task.max_attempts}).`
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.failed",
          actor_id: actorId,
          payload: {
            reason: `Исчерпан лимит попыток (${task.attempt_count}/${task.max_attempts}).`
          }
        });
        return;
      }

      const roleSpec = this.assertRoleToolsAllowed(
        task.assigned_agent_role,
        task.requested_tools
      );

      const attemptNumber = task.attempt_count + 1;
      const startedAt = new Date().toISOString();
      task = this.saveTaskWithTransition(task, {
        status: "running",
        attempt_count: attemptNumber,
        started_at: task.started_at ?? startedAt,
        failure_reason: null
      });

      this.emitEvent({
        mission_id: mission.id,
        task_id: task.id,
        event_type: "task.started",
        actor_id: actorId,
        payload: {
          title: task.title,
          assigned_agent_role: task.assigned_agent_role,
          attempt_number: attemptNumber
        }
      });

      const allMissionArtifacts = this.store
        .listMissionArtifactRows(mission.id)
        .map((r) => this.rowToArtifact(r));
      const depArtifactIds = new Set<string>(task.input_artifact_ids);
      for (const depId of task.dependencies) {
        const depTask = allTasks.find((t) => t.id === depId);
        if (depTask) {
          for (const outId of depTask.output_artifact_ids) {
            depArtifactIds.add(outId);
          }
        }
      }
      const inputArtifacts = allMissionArtifacts.filter(
        (a) => depArtifactIds.has(a.id) || task.dependencies.includes(a.task_id ?? "")
      );

      const runId = this.nextId("run");
      const runRecord: AgentRunRecord = {
        run_id: runId,
        mission_id: mission.id,
        task_id: task.id,
        attempt_number: attemptNumber,
        agent_role: task.assigned_agent_role,
        status: "running",
        input_snapshot: {
          instruction: task.instruction,
          context: mission.context,
          input_artifact_ids: inputArtifacts.map((a) => a.id),
          allowed_tools: roleSpec.allowed_tools,
          clarification_response: task.clarification_response,
          review_comment: task.review_comment
        },
        steps: [],
        output_summary: null,
        output_artifact_ids: [],
        usage_cost: null,
        usage_status: "tracked",
        error_message: null,
        started_at: startedAt,
        completed_at: null
      };
      const existingRuns = this.agentRunsByMission.get(mission.id) ?? [];
      existingRuns.push(runRecord);
      this.agentRunsByMission.set(mission.id, existingRuns);

      const adapter = this.getAdapter();
      const result = adapter.executeTaskRun({
        mission,
        task,
        roleSpec,
        attemptNumber,
        inputArtifacts
      });

      if (result instanceof Promise) {
        throw new MissionValidationError(
          "Asynchronous runtime adapter must be resolved via synchronous Kosmora execution bridge."
        );
      }

      runRecord.steps = result.steps;
      for (const step of result.steps) {
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.progress",
          actor_id: task.assigned_agent_role,
          payload: {
            run_id: runId,
            step_index: step.step_index,
            tool_used: step.tool_used,
            summary: step.summary
          }
        });
      }

      const budgetUpdate = this.recordBudgetCharge({
        mission,
        task,
        run_id: runId,
        amount: result.usage_cost,
        usage_status: result.usage_status,
        actor_id: task.assigned_agent_role
      });
      mission = budgetUpdate.mission;
      task = budgetUpdate.task;

      const createdArtifactIds: string[] = [];
      for (const artSpec of result.artifacts) {
        const artifact = this.createArtifactRecord({
          mission_id: mission.id,
          task_id: task.id,
          title: artSpec.title,
          kind: artSpec.kind,
          content: artSpec.content,
          preview: artSpec.preview,
          final: Boolean(artSpec.final),
          created_by_role: task.assigned_agent_role,
          actor_id: task.assigned_agent_role
        });
        createdArtifactIds.push(artifact.id);
      }

      const mergedOutputIds = Array.from(
        new Set([...task.output_artifact_ids, ...createdArtifactIds])
      );
      const completedAt = new Date().toISOString();

      runRecord.output_summary = result.output_summary;
      runRecord.output_artifact_ids = createdArtifactIds;
      runRecord.usage_cost = result.usage_cost;
      runRecord.usage_status = result.usage_status;
      runRecord.completed_at = completedAt;

      if (result.status === "failed") {
        const reason =
          result.failure_reason ?? "Ошибка выполнения задачи агентом.";
        runRecord.status = "failed";
        runRecord.error_message = reason;
        task = this.saveTaskWithTransition(task, {
          status: "failed",
          output_artifact_ids: mergedOutputIds,
          failure_reason: reason
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.failed",
          actor_id: task.assigned_agent_role,
          payload: {
            run_id: runId,
            reason,
            attempt_number: attemptNumber
          }
        });
        this.saveMissionWithTransition(mission, { status: "failed" });
        return;
      }

      if (result.status === "waiting_for_input") {
        runRecord.status = "waiting_for_input";
        task = this.saveTaskWithTransition(task, {
          status: "waiting_for_input",
          output_artifact_ids: mergedOutputIds,
          clarification_prompt:
            result.clarification_prompt ??
            "Требуется уточнение владельца миссии."
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.waiting_for_review",
          actor_id: task.assigned_agent_role,
          payload: {
            run_id: runId,
            checkpoint: "waiting_for_input",
            clarification_prompt: task.clarification_prompt
          }
        });
        this.saveMissionWithTransition(mission, {
          status: "waiting_for_review"
        });
        return;
      }

      if (result.status === "waiting_for_review") {
        runRecord.status = "waiting_for_review";
        task = this.saveTaskWithTransition(task, {
          status: "waiting_for_review",
          output_artifact_ids: mergedOutputIds
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.waiting_for_review",
          actor_id: task.assigned_agent_role,
          payload: {
            run_id: runId,
            checkpoint: "waiting_for_review",
            output_artifact_ids: createdArtifactIds
          }
        });
        this.saveMissionWithTransition(mission, {
          status: "waiting_for_review"
        });
        return;
      }

      runRecord.status = "completed";
      task = this.saveTaskWithTransition(task, {
        status: "completed",
        output_artifact_ids: mergedOutputIds,
        completed_at: completedAt,
        failure_reason: null
      });
      this.emitEvent({
        mission_id: mission.id,
        task_id: task.id,
        event_type: "task.completed",
        actor_id: task.assigned_agent_role,
        payload: {
          run_id: runId,
          output_artifact_ids: createdArtifactIds,
          attempt_number: attemptNumber
        }
      });

      this.unlockDependentTasks(mission.id, actorId);
    } finally {
      this.activeTaskLocks.delete(taskId);
    }
  }

  private runOrchestrationLoop(missionId: string, actorId: string): Mission {
    if (this.activeMissionLoops.has(missionId)) {
      const row = this.store.getMissionRowById(missionId);
      if (!row) {
        throw new MissionNotFoundError(`Mission '${missionId}' not found.`);
      }
      return this.rowToMission(row);
    }

    this.activeMissionLoops.add(missionId);
    try {
      let guardIterations = 0;
      while (guardIterations < 256) {
        guardIterations += 1;
        const missionRow = this.store.getMissionRowById(missionId);
        if (!missionRow) {
          throw new MissionNotFoundError(`Mission '${missionId}' not found.`);
        }
        const mission = this.rowToMission(missionRow);
        if (mission.status !== "running") {
          return mission;
        }

        this.unlockDependentTasks(mission.id, actorId);

        const tasks = this.store
          .listMissionTaskRows(mission.id)
          .map((r) => this.rowToTask(r));

        if (tasks.length === 0) {
          return mission;
        }

        const readyTasks = this.sortReadyTasks(
          tasks.filter((t) => t.status === "queued")
        );

        if (readyTasks.length === 0) {
          const anyWaitingReview = tasks.some(
            (t) =>
              t.status === "waiting_for_review" ||
              t.status === "waiting_for_input"
          );
          if (anyWaitingReview) {
            return this.saveMissionWithTransition(mission, {
              status: "waiting_for_review"
            });
          }

          const anyFailed = tasks.some((t) => t.status === "failed");
          if (anyFailed) {
            return this.saveMissionWithTransition(mission, {
              status: "failed"
            });
          }

          const allCompleted = tasks.every((t) => t.status === "completed");
          if (allCompleted) {
            return this.finalizeCompletedMission(mission, tasks, actorId);
          }

          return mission;
        }

        const nextTask = readyTasks[0]!;
        this.executeSingleTask(mission.id, nextTask.id, actorId);
      }

      const finalRow = this.store.getMissionRowById(missionId)!;
      return this.rowToMission(finalRow);
    } finally {
      this.activeMissionLoops.delete(missionId);
    }
  }

  private finalizeCompletedMission(
    mission: Mission,
    tasks: MissionTask[],
    actorId: string
  ): Mission {
    const artifacts = this.store
      .listMissionArtifactRows(mission.id)
      .map((r) => this.rowToArtifact(r));

    const summaryLines = [
      `# Итоговая сводка миссии: ${mission.title}`,
      `- **Цель**: ${mission.goal}`,
      `- **Проект**: ${mission.project_id}`,
      `- **Выполнено задач**: ${tasks.length} из ${tasks.length}`,
      `- **Бюджет**: ${mission.budget_spent.toFixed(2)} / ${mission.budget_limit.toFixed(2)} (${mission.budget_usage_status})`,
      "",
      "## Результаты по этапам",
      ...tasks.map(
        (t, idx) =>
          `${idx + 1}. **${t.title}** (${t.assigned_agent_role}) — статус: ${t.status}, попыток: ${t.attempt_count}/${t.max_attempts}`
      ),
      "",
      "## Сформированные артефакты",
      ...artifacts.map(
        (a) => `- [${a.kind}] **${a.title}** (v${a.version}): ${a.preview}`
      )
    ];
    const finalSummaryText = sanitizeSecretsFromText(summaryLines.join("\n"));

    const finalArtifact = this.createArtifactRecord({
      mission_id: mission.id,
      task_id: null,
      title: `Финальный отчёт миссии: ${mission.title}`,
      kind: "markdown_report",
      content: finalSummaryText,
      preview: finalSummaryText.slice(0, 180),
      final: true,
      created_by_role: "operator",
      actor_id: actorId
    });

    const completedAt = new Date().toISOString();
    const completedMission = this.saveMissionWithTransition(mission, {
      status: "completed",
      completed_at: completedAt,
      final_summary: finalSummaryText,
      final_artifact_id: finalArtifact.id
    });

    this.emitEvent({
      mission_id: completedMission.id,
      event_type: "mission.completed",
      actor_id: actorId,
      payload: {
        final_artifact_id: finalArtifact.id,
        tasks_completed: tasks.length,
        budget_spent: completedMission.budget_spent
      }
    });

    return completedMission;
  }

  public startMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
  }): Mission {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    let mission = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "dag:execute"
    );

    if (mission.status === "running") {
      return mission;
    }

    if (
      mission.status === "completed" ||
      mission.status === "cancelled"
    ) {
      throw new MissionValidationError(
        `Cannot start mission '${mission.id}' from terminal status '${mission.status}'.`
      );
    }

    const tasks = this.store
      .listMissionTaskRows(mission.id)
      .map((r) => this.rowToTask(r));
    if (tasks.length === 0) {
      throw new MissionValidationError(
        "Cannot start a mission with zero tasks."
      );
    }

    this.assertNoDependencyCycles(
      tasks.map((t) => ({ id: t.id, dependencies: t.dependencies }))
    );

    if (mission.budget_spent >= mission.budget_limit) {
      this.emitEvent({
        mission_id: mission.id,
        event_type: "budget.exceeded",
        actor_id: params.principal.user_id,
        payload: {
          mission_budget_spent: mission.budget_spent,
          mission_budget_limit: mission.budget_limit
        }
      });
      throw new MissionBudgetExceededError(
        `Mission '${mission.id}' has reached its budget limit (${mission.budget_spent}/${mission.budget_limit}).`
      );
    }

    const nowIso = new Date().toISOString();
    mission = this.saveMissionWithTransition(mission, {
      status: "running",
      started_at: mission.started_at ?? nowIso
    });

    this.emitEvent({
      mission_id: mission.id,
      event_type: "mission.started",
      actor_id: params.principal.user_id,
      payload: {
        started_at: mission.started_at,
        tasks_count: tasks.length
      }
    });

    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, "mission.start", mission.id, "allow", {
        project_id: mission.project_id,
        tasks_count: tasks.length
      });

    return this.runOrchestrationLoop(mission.id, params.principal.user_id);
  }

  public pauseMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
  }): Mission {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    const paused = this.saveMissionWithTransition(mission, {
      status: "paused"
    });
    this.emitEvent({
      mission_id: paused.id,
      event_type: "mission.paused",
      actor_id: params.principal.user_id,
      payload: { previous_status: mission.status }
    });
    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, "mission.pause", paused.id, "allow", { previous_status: mission.status });
    return paused;
  }

  public cancelMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
    reason?: string;
  }): Mission {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    const tasks = this.store
      .listMissionTaskRows(mission.id)
      .map((r) => this.rowToTask(r));
    for (const task of tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        this.saveTaskWithTransition(task, {
          status: "cancelled",
          failure_reason: params.reason ?? "Миссия отменена пользователем."
        });
        this.emitEvent({
          mission_id: mission.id,
          task_id: task.id,
          event_type: "task.cancelled",
          actor_id: params.principal.user_id,
          payload: { reason: params.reason ?? "Миссия отменена пользователем." }
        });
      }
    }

    const cancelled = this.saveMissionWithTransition(mission, {
      status: "cancelled",
      completed_at: new Date().toISOString()
    });
    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, "mission.cancel", cancelled.id, "allow", { reason: params.reason ?? "user_cancelled" });
    return cancelled;
  }

  public retryTask(params: {
    principal: TenantPrincipal;
    mission_id: string;
    task_id: string;
  }): { mission: Mission; task: MissionTask } {
    const missionRow = this.store.getMissionRowById(params.mission_id);
    if (!missionRow) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    let mission = this.rowToMission(missionRow);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "dag:execute"
    );

    const taskRow = this.store.getMissionTaskRowById(params.task_id);
    if (!taskRow || taskRow.mission_id !== mission.id) {
      throw new MissionNotFoundError(
        `Task '${params.task_id}' not found in mission '${mission.id}'.`
      );
    }
    const task = this.rowToTask(taskRow);

    if (task.status === "cancelled" || mission.status === "cancelled") {
      throw new MissionValidationError(
        "Cannot retry a cancelled task or a task in a cancelled mission."
      );
    }

    if (task.attempt_count >= task.max_attempts) {
      throw new MissionValidationError(
        `Task '${task.id}' has reached max_attempts (${task.attempt_count}/${task.max_attempts}) and cannot be retried.`
      );
    }

    if (
      mission.budget_spent >= mission.budget_limit ||
      task.budget_spent >= task.budget_limit
    ) {
      throw new MissionBudgetExceededError(
        "Cannot retry task: mission or task budget limit has been reached."
      );
    }

    const queuedTask = this.saveTaskWithTransition(task, {
      status: "queued",
      failure_reason: null
    });
    this.emitEvent({
      mission_id: mission.id,
      task_id: queuedTask.id,
      event_type: "task.queued",
      actor_id: params.principal.user_id,
      payload: {
        retry: true,
        attempt_count: queuedTask.attempt_count,
        max_attempts: queuedTask.max_attempts
      }
    });

    if (mission.status === "failed" || mission.status === "waiting_for_review") {
      mission = this.saveMissionWithTransition(mission, { status: "running" });
    }
    if (mission.status === "running") {
      mission = this.runOrchestrationLoop(mission.id, params.principal.user_id);
    }

    const refreshedTask = this.rowToTask(
      this.store.getMissionTaskRowById(task.id)!
    );
    return { mission, task: refreshedTask };
  }

  public reviewTask(params: {
    principal: TenantPrincipal;
    mission_id: string;
    task_id: string;
    decision: MissionReviewDecision;
    comment?: string;
  }): { mission: Mission; task: MissionTask } {
    const missionRow = this.store.getMissionRowById(params.mission_id);
    if (!missionRow) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    let mission = this.rowToMission(missionRow);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:write"
    );

    const taskRow = this.store.getMissionTaskRowById(params.task_id);
    if (!taskRow || taskRow.mission_id !== mission.id) {
      throw new MissionNotFoundError(
        `Task '${params.task_id}' not found in mission '${mission.id}'.`
      );
    }
    let task = this.rowToTask(taskRow);

    if (
      task.status !== "waiting_for_review" &&
      task.status !== "waiting_for_input"
    ) {
      throw new MissionValidationError(
        `Task '${task.id}' is in status '${task.status}', expected 'waiting_for_review' or 'waiting_for_input'.`
      );
    }

    const comment = (params.comment ?? "").trim();
    if (
      (params.decision === "reject" || params.decision === "send_back") &&
      !comment
    ) {
      throw new MissionValidationError(
        `Review decision '${params.decision}' requires a non-empty comment.`
      );
    }

    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, `mission.task.review.${params.decision}`, `${mission.id}:${task.id}`, "allow", {
        mission_id: mission.id,
        task_id: task.id,
        decision: params.decision,
        comment
      });

    if (params.decision === "approve") {
      const completedAt = new Date().toISOString();
      task = this.saveTaskWithTransition(task, {
        status: "completed",
        review_comment: comment || "Approved by owner",
        completed_at: completedAt
      });
      this.emitEvent({
        mission_id: mission.id,
        task_id: task.id,
        event_type: "task.completed",
        actor_id: params.principal.user_id,
        payload: {
          review_decision: "approve",
          comment: task.review_comment
        }
      });

      this.unlockDependentTasks(mission.id, params.principal.user_id);

      if (mission.status === "waiting_for_review") {
        mission = this.saveMissionWithTransition(mission, {
          status: "running"
        });
      }
      if (mission.status === "running") {
        mission = this.runOrchestrationLoop(
          mission.id,
          params.principal.user_id
        );
      }
      return {
        mission,
        task: this.rowToTask(this.store.getMissionTaskRowById(task.id)!)
      };
    }

    if (params.decision === "reject") {
      task = this.saveTaskWithTransition(task, {
        status: "failed",
        review_comment: comment,
        failure_reason: `Отклонено владельцем: ${comment}`
      });
      this.emitEvent({
        mission_id: mission.id,
        task_id: task.id,
        event_type: "task.failed",
        actor_id: params.principal.user_id,
        payload: {
          review_decision: "reject",
          comment
        }
      });
      mission = this.saveMissionWithTransition(mission, { status: "failed" });
      return { mission, task };
    }

    // decision === "send_back"
    if (task.attempt_count >= task.max_attempts) {
      throw new MissionValidationError(
        `Cannot send_back task '${task.id}': max_attempts (${task.attempt_count}/${task.max_attempts}) reached.`
      );
    }

    task = this.saveTaskWithTransition(task, {
      status: "queued",
      review_comment: comment,
      clarification_response:
        task.status === "waiting_for_input"
          ? comment
          : task.clarification_response
    });
    this.emitEvent({
      mission_id: mission.id,
      task_id: task.id,
      event_type: "task.queued",
      actor_id: params.principal.user_id,
      payload: {
        review_decision: "send_back",
        comment,
        next_attempt: task.attempt_count + 1
      }
    });

    if (mission.status === "waiting_for_review") {
      mission = this.saveMissionWithTransition(mission, { status: "running" });
    }
    if (mission.status === "running") {
      mission = this.runOrchestrationLoop(mission.id, params.principal.user_id);
    }

    return {
      mission,
      task: this.rowToTask(this.store.getMissionTaskRowById(task.id)!)
    };
  }

  public listEvents(params: {
    principal: TenantPrincipal;
    mission_id: string;
  }): MissionEvent[] {
    const row = this.store.getMissionRowById(params.mission_id);
    if (!row) {
      throw new MissionNotFoundError(
        `Mission '${params.mission_id}' not found.`
      );
    }
    const mission = this.rowToMission(row);
    this.assertPrincipalAccessToMission(
      params.principal,
      mission,
      "workspace:read"
    );

    return this.store
      .listMissionEventRows(mission.id)
      .map((e) => this.rowToEvent(e));
  }

  public exportMission(params: {
    principal: TenantPrincipal;
    mission_id: string;
    format: "json" | "markdown";
  }): {
    format: "json" | "markdown";
    content_type: string;
    filename: string;
    bundle?: MissionExportBundle;
    markdown?: string;
  } {
    const details = this.getMissionDetails({
      principal: params.principal,
      mission_id: params.mission_id
    });

    const sanitizedMission: Omit<Mission, "tenant_id" | "workspace_id"> = {
      id: details.mission.id,
      project_id: details.mission.project_id,
      owner_id: details.mission.owner_id,
      title: sanitizeSecretsFromText(details.mission.title),
      goal: sanitizeSecretsFromText(details.mission.goal),
      context: sanitizeSecretsFromText(details.mission.context),
      status: details.mission.status,
      priority: details.mission.priority,
      created_at: details.mission.created_at,
      updated_at: details.mission.updated_at,
      started_at: details.mission.started_at,
      completed_at: details.mission.completed_at,
      budget_limit: details.mission.budget_limit,
      budget_spent: details.mission.budget_spent,
      budget_usage_status: details.mission.budget_usage_status,
      final_summary: details.mission.final_summary
        ? sanitizeSecretsFromText(details.mission.final_summary)
        : null,
      final_artifact_id: details.mission.final_artifact_id,
      version: details.mission.version
    };

    const sanitizedArtifacts = details.artifacts
      .filter((a) => a.mission_id === details.mission.id)
      .map((a) => ({
        ...a,
        title: sanitizeSecretsFromText(a.title),
        preview: sanitizeSecretsFromText(a.preview),
        content: sanitizeSecretsFromText(a.content)
      }));

    const bundle: MissionExportBundle = {
      schema_version: "kosmora.mission.export.v1",
      exported_at: new Date().toISOString(),
      mission: sanitizedMission,
      tasks: details.tasks.filter((t) => t.mission_id === details.mission.id),
      artifacts: sanitizedArtifacts,
      events: details.events ?? this.listEvents(params),
      budget_ledger: details.budget_ledger.filter(
        (b) => b.mission_id === details.mission.id
      ),
      runs: details.runs.filter((r) => r.mission_id === details.mission.id)
    };

    this.security.appendAuditEntry(params.principal.tenant_id, params.principal.user_id, "mission.export", details.mission.id, "allow", {
        format: params.format,
        project_id: details.mission.project_id
      });

    if (params.format === "markdown") {
      const mdLines = [
        `# Экспорт миссии Kosmora: ${sanitizedMission.title}`,
        `- **ID миссии**: ${sanitizedMission.id}`,
        `- **Проект**: ${sanitizedMission.project_id}`,
        `- **Владелец**: ${sanitizedMission.owner_id}`,
        `- **Статус**: ${sanitizedMission.status}`,
        `- **Приоритет**: ${sanitizedMission.priority}`,
        `- **Цель**: ${sanitizedMission.goal}`,
        `- **Бюджет**: ${sanitizedMission.budget_spent.toFixed(2)} / ${sanitizedMission.budget_limit.toFixed(2)} (${sanitizedMission.budget_usage_status})`,
        "",
        "## Задачи миссии",
        ...bundle.tasks.map(
          (t, i) =>
            `${i + 1}. **${t.title}** [${t.assigned_agent_role}] — статус: \`${t.status}\`, попытки: ${t.attempt_count}/${t.max_attempts}, зависимости: ${
              t.dependencies.length > 0 ? t.dependencies.join(", ") : "нет"
            }`
        ),
        "",
        "## Артефакты",
        ...bundle.artifacts.map(
          (a) =>
            `### ${a.title} (${a.kind}, v${a.version}${a.final ? ", FINAL" : ""})\n\n${a.content}`
        ),
        "",
        "## Журнал бюджета",
        ...bundle.budget_ledger.map(
          (b) =>
            `- [${b.created_at}] ${b.agent_role}: ${
              b.amount !== null ? b.amount.toFixed(4) : b.usage_status
            } — ${b.description}`
        )
      ];
      return {
        format: "markdown",
        content_type: "text/markdown; charset=utf-8",
        filename: `mission-${sanitizedMission.id}.md`,
        markdown: mdLines.join("\n")
      };
    }

    return {
      format: "json",
      content_type: "application/json; charset=utf-8",
      filename: `mission-${sanitizedMission.id}.json`,
      bundle
    };
  }

  /**
   * Crash/Restart Recovery:
   * Inspects all unfinished missions (`running` or `waiting_for_review`),
   * resets any task stuck in `running` back to `queued` (or `failed` if attempts exhausted),
   * and resumes `running` missions cleanly.
   */
  public recoverUnfinishedMissions(): {
    recovered_mission_ids: string[];
    requeued_task_ids: string[];
  } {
    const unfinishedRows = this.store.listAllUnfinishedMissionRows();
    const recoveredMissionIds: string[] = [];
    const requeuedTaskIds: string[] = [];

    for (const mRow of unfinishedRows) {
      const mission = this.rowToMission(mRow);
      const tasks = this.store
        .listMissionTaskRows(mission.id)
        .map((t) => this.rowToTask(t));

      for (const task of tasks) {
        if (task.status === "running") {
          if (task.attempt_count < task.max_attempts) {
            this.saveTaskWithTransition(task, { status: "queued" });
            requeuedTaskIds.push(task.id);
            this.emitEvent({
              mission_id: mission.id,
              task_id: task.id,
              event_type: "task.queued",
              actor_id: "system_recovery",
              payload: {
                recovered_after_restart: true,
                attempt_count: task.attempt_count
              }
            });
          } else {
            this.saveTaskWithTransition(task, {
              status: "failed",
              failure_reason:
                "Задача прервана при перезапуске процесса и исчерпала лимит попыток."
            });
          }
        }
      }

      if (mission.status === "running") {
        recoveredMissionIds.push(mission.id);
        this.runOrchestrationLoop(mission.id, mission.owner_id);
      }
    }

    return {
      recovered_mission_ids: recoveredMissionIds,
      requeued_task_ids: requeuedTaskIds
    };
  }
}
