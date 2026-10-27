import React from "react";
import { KOSMORA_MONOCHROME_THEME, type WorkspacePaletteTheme } from "./view-model.js";

export type UiMissionStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_for_review"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type UiMissionTaskStatus =
  | "blocked"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_review"
  | "completed"
  | "failed"
  | "cancelled";

export type UiAgentRole =
  | "researcher"
  | "analyst"
  | "writer"
  | "reviewer"
  | "developer"
  | "designer"
  | "operator";

export type UiArtifactKind =
  | "note"
  | "research"
  | "table"
  | "markdown_report"
  | "link"
  | "file"
  | "code_execution_result";

export type UiBudgetUsageStatus =
  | "tracked"
  | "usage_pending"
  | "usage_unavailable";

export interface UiMissionTaskItem {
  id: string;
  title: string;
  instruction: string;
  assigned_agent_role: UiAgentRole;
  status: UiMissionTaskStatus;
  priority: "low" | "medium" | "high" | "critical";
  dependencies: string[];
  attempt_count: number;
  max_attempts: number;
  budget_limit: number;
  budget_spent: number;
  budget_usage_status: UiBudgetUsageStatus;
  failure_reason: string | null;
  review_comment: string | null;
  clarification_prompt: string | null;
  output_artifact_ids: string[];
}

export interface UiMissionArtifactItem {
  id: string;
  task_id: string | null;
  title: string;
  kind: UiArtifactKind;
  version: number;
  preview: string;
  content: string;
  final: boolean;
  created_by_role: UiAgentRole | "owner";
  created_at: string;
}

export interface UiMissionEventItem {
  id: string;
  event_type: string;
  task_id: string | null;
  actor_id: string;
  summary: string;
  created_at: string;
}

export interface UiMissionBudgetLedgerItem {
  id: string;
  task_id: string | null;
  agent_role: string;
  amount: number | null;
  usage_status: UiBudgetUsageStatus;
  description: string;
  created_at: string;
}

export interface MissionControlViewModel {
  ui_mode:
    | "active"
    | "empty"
    | "waiting_for_review"
    | "error"
    | "cancelled"
    | "runtime_disconnected";
  runtime_connected: boolean;
  theme: WorkspacePaletteTheme;
  mission: {
    id: string;
    project_id: string;
    owner_id: string;
    title: string;
    goal: string;
    context: string;
    status: UiMissionStatus;
    priority: "low" | "medium" | "high" | "critical";
    budget_limit: number;
    budget_spent: number;
    budget_usage_status: UiBudgetUsageStatus;
    final_summary: string | null;
    final_artifact_id: string | null;
    version: number;
  } | null;
  active_stage_title: string;
  tasks: UiMissionTaskItem[];
  dependency_edges: Array<{ from: string; to: string; unlocked: boolean }>;
  events: UiMissionEventItem[];
  artifacts: UiMissionArtifactItem[];
  budget_ledger: UiMissionBudgetLedgerItem[];
  available_roles: Array<{
    role: UiAgentRole;
    title: string;
    allowed_tools: string[];
    default_budget_limit: number;
  }>;
  export_formats: Array<"JSON" | "MARKDOWN">;
}

const STATUS_LABELS_RU: Readonly<Record<UiMissionStatus, string>> = {
  draft: "Черновик (draft)",
  ready: "Готова к запуску (ready)",
  running: "Выполняется (running)",
  waiting_for_review: "Ожидает решения человека (waiting_for_review)",
  paused: "Приостановлена (paused)",
  completed: "Завершена (completed)",
  failed: "Ошибка выполнения (failed)",
  cancelled: "Отменена (cancelled)"
};

const TASK_STATUS_LABELS_RU: Readonly<Record<UiMissionTaskStatus, string>> = {
  blocked: "Заблокирована зависимостями (blocked)",
  queued: "В очереди (queued)",
  running: "Выполняется (running)",
  waiting_for_input: "Ожидает уточнения человека (waiting_for_input)",
  waiting_for_review: "На проверке у владельца (waiting_for_review)",
  completed: "Выполнена (completed)",
  failed: "Ошибка (failed)",
  cancelled: "Отменена (cancelled)"
};

const USAGE_STATUS_LABELS_RU: Readonly<Record<UiBudgetUsageStatus, string>> = {
  tracked: "Точный учёт провайдера (tracked)",
  usage_pending: "Ожидание биллинга провайдера (usage_pending)",
  usage_unavailable: "Провайдер не передал расход (usage_unavailable)"
};

export function buildMissionControlViewModel(options?: {
  mode?: MissionControlViewModel["ui_mode"];
  runtime_connected?: boolean;
}): MissionControlViewModel {
  const runtimeConnected = options?.runtime_connected ?? true;
  const mode =
    options?.mode ??
    (runtimeConnected ? "waiting_for_review" : "runtime_disconnected");

  const availableRoles: MissionControlViewModel["available_roles"] = [
    {
      role: "researcher",
      title: "Исследователь (Researcher)",
      allowed_tools: [
        "web_search",
        "knowledge_graph_query",
        "citation_extractor",
        "document_reader"
      ],
      default_budget_limit: 5.0
    },
    {
      role: "analyst",
      title: "Аналитик (Analyst)",
      allowed_tools: [
        "data_table_builder",
        "risk_matrix_evaluator",
        "knowledge_graph_query",
        "metric_calculator"
      ],
      default_budget_limit: 6.0
    },
    {
      role: "writer",
      title: "Автор-редактор (Writer)",
      allowed_tools: [
        "markdown_composer",
        "outline_structurer",
        "document_reader"
      ],
      default_budget_limit: 4.5
    },
    {
      role: "reviewer",
      title: "Рецензент-верификатор (Reviewer)",
      allowed_tools: [
        "fact_consistency_checker",
        "citation_verifier",
        "policy_compliance_auditor"
      ],
      default_budget_limit: 3.5
    },
    {
      role: "developer",
      title: "Инженер-разработчик (Developer)",
      allowed_tools: ["sandbox_code_runner", "ast_inspector", "schema_validator"],
      default_budget_limit: 7.0
    },
    {
      role: "designer",
      title: "Системный дизайнер (Designer)",
      allowed_tools: [
        "wireframe_spec_builder",
        "accessibility_checker",
        "layout_grid_planner"
      ],
      default_budget_limit: 4.0
    },
    {
      role: "operator",
      title: "Оператор исполнения (Operator)",
      allowed_tools: ["export_packager", "budget_auditor", "runbook_executor"],
      default_budget_limit: 3.0
    }
  ];

  if (mode === "empty") {
    return {
      ui_mode: "empty",
      runtime_connected: runtimeConnected,
      theme: KOSMORA_MONOCHROME_THEME,
      mission: null,
      active_stage_title: "Нет активных миссий — создайте новую миссию",
      tasks: [],
      dependency_edges: [],
      events: [],
      artifacts: [],
      budget_ledger: [],
      available_roles: availableRoles,
      export_formats: ["JSON", "MARKDOWN"]
    };
  }

  const missionStatus: UiMissionStatus =
    mode === "cancelled"
      ? "cancelled"
      : mode === "error" || mode === "runtime_disconnected"
        ? "failed"
        : mode === "waiting_for_review"
          ? "waiting_for_review"
          : "completed";

  const tasks: UiMissionTaskItem[] = [
    {
      id: "task_1_research",
      title: "Найти и процитировать источники рынка EdTech",
      instruction:
        "Собрать отчёты рынка EdTech, выделить объём сегментов B2B/B2C и оформить точные ссылки.",
      assigned_agent_role: "researcher",
      status:
        mode === "runtime_disconnected"
          ? "failed"
          : mode === "cancelled"
            ? "cancelled"
            : "completed",
      priority: "high",
      dependencies: [],
      attempt_count: 1,
      max_attempts: 3,
      budget_limit: 5.0,
      budget_spent: mode === "runtime_disconnected" ? 0 : 1.25,
      budget_usage_status:
        mode === "runtime_disconnected" ? "usage_unavailable" : "tracked",
      failure_reason:
        mode === "runtime_disconnected"
          ? "Агентский runtime не подключён — выполнение задачи невозможно без активного рантайма."
          : null,
      review_comment: null,
      clarification_prompt: null,
      output_artifact_ids:
        mode === "runtime_disconnected" ? [] : ["art_edtech_sources"]
    },
    {
      id: "task_2_analysis",
      title: "Выделить объём рынка, конкурентов и матрицу рисков",
      instruction:
        "Построить сравнительную таблицу ключевых игроков EdTech и оценить регуляторные и технологические риски.",
      assigned_agent_role: "analyst",
      status:
        mode === "runtime_disconnected"
          ? "blocked"
          : mode === "cancelled"
            ? "cancelled"
            : mode === "error"
              ? "failed"
              : "completed",
      priority: "high",
      dependencies: ["task_1_research"],
      attempt_count: mode === "runtime_disconnected" ? 0 : 1,
      max_attempts: 3,
      budget_limit: 6.0,
      budget_spent:
        mode === "runtime_disconnected" || mode === "cancelled" ? 0 : 1.25,
      budget_usage_status:
        mode === "runtime_disconnected" ? "usage_unavailable" : "tracked",
      failure_reason:
        mode === "error"
          ? "Превышен лимит попыток верификации таблицы конкурентов."
          : null,
      review_comment: null,
      clarification_prompt: null,
      output_artifact_ids:
        mode === "runtime_disconnected" || mode === "error"
          ? []
          : ["art_edtech_competitors_table"]
    },
    {
      id: "task_3_writer",
      title: "Собрать структуру презентации и аналитической записки",
      instruction:
        "Сформировать тезисную структуру слайдов и резюме для инвестиционного комитета.",
      assigned_agent_role: "writer",
      status:
        mode === "runtime_disconnected" || mode === "error"
          ? "blocked"
          : mode === "cancelled"
            ? "cancelled"
            : "completed",
      priority: "medium",
      dependencies: ["task_2_analysis"],
      attempt_count:
        mode === "runtime_disconnected" || mode === "error" ? 0 : 1,
      max_attempts: 3,
      budget_limit: 4.5,
      budget_spent:
        mode === "runtime_disconnected" || mode === "error" ? 0 : 1.25,
      budget_usage_status: "tracked",
      failure_reason: null,
      review_comment: null,
      clarification_prompt: null,
      output_artifact_ids:
        mode === "runtime_disconnected" || mode === "error"
          ? []
          : ["art_edtech_deck_outline"]
    },
    {
      id: "task_4_reviewer",
      title: "Проверить факты, цитаты и отсутствие противоречий",
      instruction:
        "Сверить цифры в структуре презентации с первоисточниками и передать владельцу на утверждение.",
      assigned_agent_role: "reviewer",
      status:
        mode === "waiting_for_review"
          ? "waiting_for_review"
          : mode === "active"
            ? "completed"
            : mode === "cancelled"
              ? "cancelled"
              : "blocked",
      priority: "critical",
      dependencies: ["task_3_writer"],
      attempt_count:
        mode === "waiting_for_review" || mode === "active" ? 1 : 0,
      max_attempts: 3,
      budget_limit: 3.5,
      budget_spent:
        mode === "waiting_for_review" || mode === "active" ? 1.25 : 0,
      budget_usage_status: "tracked",
      failure_reason: null,
      review_comment:
        mode === "active"
          ? "Утверждено владельцем: цифры и источники проверены."
          : null,
      clarification_prompt: null,
      output_artifact_ids:
        mode === "waiting_for_review" || mode === "active"
          ? ["art_edtech_review_note"]
          : []
    }
  ];

  const dependencyEdges = [
    {
      from: "task_1_research",
      to: "task_2_analysis",
      unlocked: tasks[0]?.status === "completed"
    },
    {
      from: "task_2_analysis",
      to: "task_3_writer",
      unlocked: tasks[1]?.status === "completed"
    },
    {
      from: "task_3_writer",
      to: "task_4_reviewer",
      unlocked: tasks[2]?.status === "completed"
    }
  ];

  const artifacts: UiMissionArtifactItem[] =
    mode === "runtime_disconnected"
      ? []
      : [
          {
            id: "art_edtech_sources",
            task_id: "task_1_research",
            title: "Результат: Найти и процитировать источники рынка EdTech",
            kind: "research",
            version: 1,
            preview:
              "Сводка первоисточников EdTech (B2B корпоративное обучение, AI-тьюторы, STEM-платформы).",
            content:
              "# Источники рынка EdTech\n1. Сегмент корпоративного L&D и переквалификации.\n2. Сегмент адаптивных ИИ-тьюторов.",
            final: false,
            created_by_role: "researcher",
            created_at: "2026-10-26T08:00:00.000Z"
          },
          {
            id: "art_edtech_competitors_table",
            task_id: "task_2_analysis",
            title: "Результат: Матрица конкурентов и рисков EdTech",
            kind: "table",
            version: 1,
            preview:
              "Сравнительная таблица ключевых сегментов, CAC/LTV и реестр регуляторных рисков.",
            content:
              "| Сегмент | Темп роста | Ключевой риск |\n|---|---|---|\n| B2B L&D | Высокий | Долгий цикл сделок |\n| AI Tutors | Очень высокий | Стоимость инференса |",
            final: false,
            created_by_role: "analyst",
            created_at: "2026-10-26T08:01:00.000Z"
          },
          {
            id: "art_edtech_deck_outline",
            task_id: "task_3_writer",
            title: "Результат: Структура презентации исследования EdTech",
            kind: "markdown_report",
            version: 1,
            preview:
              "Структура из 8 разделов с выводами для инвестиционного комитета и картой рисков.",
            content:
              "# Структура презентации EdTech\n1. Обзор рынка\n2. Конкурентный ландшафт\n3. Риски и барьеры\n4. Рекомендации",
            final: mode === "active",
            created_by_role: "writer",
            created_at: "2026-10-26T08:02:00.000Z"
          },
          {
            id: "art_edtech_review_note",
            task_id: "task_4_reviewer",
            title: "Протокол верификации фактов и противоречий",
            kind: "note",
            version: 1,
            preview:
              "Все показатели сверены с первичными источниками; расхождений не обнаружено.",
            content:
              "Протокол Reviewer: цитаты и таблицы согласованы, готово к решению владельца.",
            final: false,
            created_by_role: "reviewer",
            created_at: "2026-10-26T08:03:00.000Z"
          }
        ];

  const events: UiMissionEventItem[] = [
    {
      id: "ev_1",
      event_type: "mission.created",
      task_id: null,
      actor_id: "user_owner_01",
      summary: "Создана миссия «Подготовить исследование рынка EdTech»",
      created_at: "2026-10-26T08:00:00.000Z"
    },
    {
      id: "ev_2",
      event_type: "mission.started",
      task_id: null,
      actor_id: "user_owner_01",
      summary: "Запущена оркестрация графа задач миссии",
      created_at: "2026-10-26T08:00:05.000Z"
    },
    {
      id: "ev_3",
      event_type:
        mode === "runtime_disconnected"
          ? "task.failed"
          : mode === "cancelled"
            ? "task.cancelled"
            : mode === "waiting_for_review"
              ? "task.waiting_for_review"
              : "mission.completed",
      task_id: "task_4_reviewer",
      actor_id: "reviewer",
      summary:
        mode === "runtime_disconnected"
          ? "Остановка: агентский runtime не подключён (фейковые результаты запрещены)"
          : mode === "cancelled"
            ? "Миссия и незавершённые задачи отменены владельцем"
            : mode === "waiting_for_review"
              ? "Задача «Проверить факты, цитаты и отсутствие противоречий» ожидает решения человека (approve / reject / send_back)"
              : "Миссия успешно завершена, итоговая сводка сформирована",
      created_at: "2026-10-26T08:03:30.000Z"
    }
  ];

  const budgetLedger: UiMissionBudgetLedgerItem[] =
    mode === "runtime_disconnected"
      ? [
          {
            id: "led_unavail",
            task_id: "task_1_research",
            agent_role: "researcher",
            amount: null,
            usage_status: "usage_unavailable",
            description:
              "Статус расхода провайдера: usage_unavailable (рантайм отключён)",
            created_at: "2026-10-26T08:00:10.000Z"
          }
        ]
      : [
          {
            id: "led_1",
            task_id: "task_1_research",
            agent_role: "researcher",
            amount: 1.25,
            usage_status: "tracked",
            description:
              "Списание по задаче «Найти и процитировать источники рынка EdTech»",
            created_at: "2026-10-26T08:00:45.000Z"
          },
          {
            id: "led_2",
            task_id: "task_2_analysis",
            agent_role: "analyst",
            amount: 1.25,
            usage_status: "tracked",
            description:
              "Списание по задаче «Выделить объём рынка, конкурентов и матрицу рисков»",
            created_at: "2026-10-26T08:01:45.000Z"
          }
        ];

  const totalSpent = tasks.reduce((acc, t) => acc + t.budget_spent, 0);

  return {
    ui_mode: mode,
    runtime_connected: runtimeConnected,
    theme: KOSMORA_MONOCHROME_THEME,
    mission: {
      id: "msn_edtech_01",
      project_id: "proj_sovereign_q4",
      owner_id: "user_owner_01",
      title: "Подготовить исследование рынка EdTech",
      goal: "Провести полное исследование сегментов EdTech, выделить конкурентов и риски, подготовить структуру презентации и верифицировать факты.",
      context:
        "Строгий фокус на проверяемых источниках и воспроизводимой аналитике для инвестиционного комитета.",
      status: missionStatus,
      priority: "high",
      budget_limit: 20.0,
      budget_spent: Number(totalSpent.toFixed(2)),
      budget_usage_status:
        mode === "runtime_disconnected" ? "usage_unavailable" : "tracked",
      final_summary:
        mode === "active"
          ? "Итоговая сводка миссии «Подготовить исследование рынка EdTech»: все 4 этапа выполнены и верифицированы владельцем."
          : null,
      final_artifact_id: mode === "active" ? "art_edtech_deck_outline" : null,
      version: 4
    },
    active_stage_title:
      mode === "runtime_disconnected"
        ? "Агентский runtime не подключён — выполнение остановлено"
        : mode === "waiting_for_review"
          ? "Этап 4 из 4: Проверка фактов и ожидание утверждения владельца (HITL)"
          : mode === "cancelled"
            ? "Выполнение миссии отменено пользователем"
            : mode === "error"
              ? "Остановка из-за ошибки выполнения задачи"
              : "Все этапы завершены — финальный пакет готов к экспорту",
    tasks,
    dependency_edges: dependencyEdges,
    events,
    artifacts,
    budget_ledger: budgetLedger,
    available_roles: availableRoles,
    export_formats: ["JSON", "MARKDOWN"]
  };
}

export function KosmoraMissionControlPanel(props: {
  viewModel?: MissionControlViewModel;
}): React.ReactElement {
  const vm = props.viewModel ?? buildMissionControlViewModel();
  const { theme } = vm;

  if (vm.ui_mode === "empty" || !vm.mission) {
    return (
      <section
        aria-label="Kosmora Mission Control — Пустое состояние"
        style={{
          backgroundColor: theme.background_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px",
          padding: "24px",
          marginTop: "28px",
          color: theme.text_primary
        }}
      >
        <h2 style={{ fontSize: "20px", fontWeight: 600, marginTop: 0 }}>
          Центр управления миссиями (Kosmora Mission Control)
        </h2>
        <p style={{ color: theme.text_muted, fontSize: "14px" }}>
          Активных миссий в проекте пока нет. Создайте новую миссию, сформулируйте цель, добавьте задачи и назначьте роли агентов ({vm.available_roles.map((r) => r.role).join(", ")}).
        </p>
      </section>
    );
  }

  const mission = vm.mission;
  const budgetPercent = Math.min(
    100,
    Math.round((mission.budget_spent / mission.budget_limit) * 100)
  );
  const reviewPendingTasks = vm.tasks.filter(
    (t) =>
      t.status === "waiting_for_review" || t.status === "waiting_for_input"
  );

  return (
    <section
      aria-label="Kosmora Mission Control"
      style={{
        backgroundColor: theme.background_primary,
        border: `1px solid ${theme.border_subtle}`,
        borderRadius: "8px",
        padding: "24px",
        marginTop: "28px",
        color: theme.text_primary
      }}
    >
      {/* Верхняя панель миссии: название, цель, статус, бюджет */}
      <div
        style={{
          borderBottom: `1px solid ${theme.border_subtle}`,
          paddingBottom: "18px",
          marginBottom: "20px"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px"
          }}
        >
          <div>
            <span
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: theme.text_muted
              }}
            >
              РАБОЧАЯ ЗОНА «МИССИИ» • ПРОЕКТ {mission.project_id} • ВЕРСИЯ v{mission.version}
            </span>
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 600,
                margin: "6px 0 8px 0",
                color: theme.text_primary
              }}
            >
              Миссия: {mission.title}
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: theme.text_secondary,
                margin: 0
              }}
            >
              <strong>Цель:</strong> {mission.goal}
            </p>
          </div>

          <div
            style={{
              backgroundColor: theme.background_elevated,
              border: `1px solid ${theme.border_subtle}`,
              borderRadius: "6px",
              padding: "12px 16px",
              minWidth: "260px"
            }}
          >
            <div style={{ fontSize: "13px", color: theme.text_primary }}>
              <strong>Статус:</strong> {STATUS_LABELS_RU[mission.status]}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: theme.text_secondary,
                marginTop: "4px"
              }}
            >
              <strong>Бюджет миссии:</strong> ${mission.budget_spent.toFixed(2)}{" "}
              / ${mission.budget_limit.toFixed(2)} ({budgetPercent}%)
            </div>
            <div
              style={{
                fontSize: "12px",
                color: theme.text_muted,
                marginTop: "2px"
              }}
            >
              Учёт расхода: {USAGE_STATUS_LABELS_RU[mission.budget_usage_status]}
            </div>
            <div
              style={{
                height: "6px",
                backgroundColor: "#262626",
                borderRadius: "3px",
                marginTop: "8px",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${budgetPercent}%`,
                  height: "100%",
                  backgroundColor: "#ffffff"
                }}
              />
            </div>
          </div>
        </div>

        {/* Текущий активный этап и предупреждения о состоянии */}
        <div
          style={{
            marginTop: "14px",
            padding: "10px 14px",
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "6px",
            fontSize: "13px",
            color: theme.text_secondary
          }}
        >
          <strong>Текущий активный этап:</strong> {vm.active_stage_title}
        </div>

        {!vm.runtime_connected && (
          <div
            role="alert"
            style={{
              marginTop: "12px",
              padding: "12px 14px",
              backgroundColor: "#141414",
              border: "1px solid #ffffff",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#ffffff"
            }}
          >
            <strong>Внимание (Runtime Offline):</strong> Агентский runtime не
            подключён. Система не генерирует фиктивные результаты; запуск задач
            заблокирован до восстановления соединения с провайдером.
          </div>
        )}

        {mission.status === "cancelled" && (
          <div
            role="status"
            style={{
              marginTop: "12px",
              padding: "12px 14px",
              backgroundColor: "#141414",
              border: `1px solid ${theme.border_subtle}`,
              borderRadius: "6px",
              fontSize: "13px",
              color: theme.text_secondary
            }}
          >
            <strong>Миссия отменена:</strong> Все активные и ожидающие задачи
            переведены в статус <code>cancelled</code>.
          </div>
        )}
      </div>

      {/* Сетка: Задачи миссии + Граф зависимостей */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "20px",
          marginBottom: "20px"
        }}
      >
        {/* Список задач миссии */}
        <article
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "18px"
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Задачи миссии ({vm.tasks.length})
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {vm.tasks.map((task, idx) => (
              <li
                key={task.id}
                style={{
                  borderTop:
                    idx === 0 ? "none" : `1px solid ${theme.border_subtle}`,
                  padding: "12px 0",
                  fontSize: "13px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px"
                  }}
                >
                  <strong style={{ color: theme.text_primary }}>
                    {idx + 1}. {task.title}
                  </strong>
                  <span style={{ color: theme.text_muted, fontSize: "12px" }}>
                    [{task.assigned_agent_role}]
                  </span>
                </div>
                <div
                  style={{
                    color: theme.text_secondary,
                    fontSize: "12px",
                    marginTop: "4px"
                  }}
                >
                  {task.instruction}
                </div>
                <div
                  style={{
                    color: theme.text_muted,
                    fontSize: "12px",
                    marginTop: "6px"
                  }}
                >
                  Статус: {TASK_STATUS_LABELS_RU[task.status]} | Попытки:{" "}
                  {task.attempt_count}/{task.max_attempts} | Бюджет: $
                  {task.budget_spent.toFixed(2)}/${task.budget_limit.toFixed(2)}
                </div>
                {task.dependencies.length > 0 && (
                  <div style={{ color: theme.text_muted, fontSize: "11px" }}>
                    Зависимости: {task.dependencies.join(", ")}
                  </div>
                )}
                {task.failure_reason && (
                  <div
                    style={{
                      color: "#ffffff",
                      fontSize: "12px",
                      marginTop: "4px"
                    }}
                  >
                    Причина ошибки: {task.failure_reason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </article>

        {/* Граф зависимостей и Роли агентов */}
        <article
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "18px"
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Граф зависимостей задач (DAG-схема)
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px 0" }}>
            {vm.dependency_edges.map((edge) => (
              <li
                key={`${edge.from}->${edge.to}`}
                style={{
                  padding: "8px 10px",
                  marginBottom: "8px",
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "6px",
                  fontSize: "13px",
                  color: theme.text_secondary
                }}
              >
                <code>{edge.from}</code> → <code>{edge.to}</code>{" "}
                <span style={{ color: theme.text_muted, fontSize: "12px" }}>
                  ({edge.unlocked ? "Разблокировано" : "Ожидает завершения родителя"})
                </span>
              </li>
            ))}
          </ul>

          <h4 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 8px 0" }}>
            Назначенные роли и разрешённые инструменты
          </h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {vm.available_roles.map((r) => (
              <li
                key={r.role}
                style={{
                  fontSize: "12px",
                  color: theme.text_muted,
                  padding: "4px 0"
                }}
              >
                <strong style={{ color: theme.text_secondary }}>
                  {r.title}
                </strong>
                : {r.allowed_tools.join(", ")}
              </li>
            ))}
          </ul>
        </article>
      </div>

      {/* Панель утверждения / возврата на доработку (Human-in-the-Loop) */}
      <article
        aria-label="Панель контроля человека (Human-in-the-loop)"
        style={{
          backgroundColor: theme.background_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px",
          padding: "18px",
          marginBottom: "20px"
        }}
      >
        <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
          Контрольная точка владельца (Approve / Send Back / Reject)
        </h3>
        {reviewPendingTasks.length === 0 ? (
          <p style={{ color: theme.text_muted, fontSize: "13px", margin: 0 }}>
            Сейчас нет задач, ожидающих ручного утверждения или уточнения.
          </p>
        ) : (
          reviewPendingTasks.map((t) => (
            <div
              key={t.id}
              style={{
                borderTop: `1px solid ${theme.border_subtle}`,
                paddingTop: "12px",
                marginTop: "8px",
                fontSize: "13px"
              }}
            >
              <p style={{ margin: "0 0 8px 0", color: theme.text_primary }}>
                Задача <strong>«{t.title}»</strong> ({t.assigned_agent_role})
                передана на проверку владельцу.
              </p>
              <p style={{ margin: "0 0 10px 0", color: theme.text_muted }}>
                Доступные действия владельца:{" "}
                <strong>Принять результат (approve)</strong> — разблокирует
                зависимые задачи;{" "}
                <strong>Вернуть на доработку (send_back)</strong> — требует
                комментарий и запускает новую попытку;{" "}
                <strong>Отклонить (reject)</strong> — требует комментарий и
                останавливает задачу.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#ffffff",
                    color: "#0a0a0a",
                    borderRadius: "4px",
                    fontWeight: 600,
                    fontSize: "12px"
                  }}
                >
                  Утвердить (approve)
                </span>
                <span
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#141414",
                    color: "#e5e5e5",
                    border: `1px solid ${theme.border_subtle}`,
                    borderRadius: "4px",
                    fontSize: "12px"
                  }}
                >
                  Вернуть на доработку (send_back + комментарий)
                </span>
                <span
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#141414",
                    color: "#a3a3a3",
                    border: `1px solid ${theme.border_subtle}`,
                    borderRadius: "4px",
                    fontSize: "12px"
                  }}
                >
                  Отклонить (reject + комментарий)
                </span>
              </div>
            </div>
          ))
        )}
      </article>

      {/* Сетка: Артефакты + События в реальном времени (SSE) + Экспорт и Бюджет */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px"
        }}
      >
        {/* Артефакты и результаты */}
        <article
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "18px"
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Артефакты миссии ({vm.artifacts.length})
          </h3>
          {vm.artifacts.length === 0 ? (
            <p style={{ color: theme.text_muted, fontSize: "13px" }}>
              Артефакты ещё не созданы.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {vm.artifacts.map((art, i) => (
                <li
                  key={art.id}
                  style={{
                    borderTop:
                      i === 0 ? "none" : `1px solid ${theme.border_subtle}`,
                    padding: "10px 0",
                    fontSize: "13px"
                  }}
                >
                  <div>
                    <strong style={{ color: theme.text_primary }}>
                      {art.title}
                    </strong>{" "}
                    <span style={{ color: theme.text_muted, fontSize: "12px" }}>
                      ({art.kind}, v{art.version}
                      {art.final ? ", FINAL" : ""})
                    </span>
                  </div>
                  <div
                    style={{
                      color: theme.text_secondary,
                      fontSize: "12px",
                      marginTop: "4px"
                    }}
                  >
                    {art.preview}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* События в реальном времени (SSE) */}
        <article
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "18px"
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Поток событий в реальном времени (SSE)
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {vm.events.map((ev, i) => (
              <li
                key={ev.id}
                style={{
                  borderTop:
                    i === 0 ? "none" : `1px solid ${theme.border_subtle}`,
                  padding: "8px 0",
                  fontSize: "12px",
                  color: theme.text_secondary
                }}
              >
                <code>{ev.event_type}</code> ({ev.actor_id}): {ev.summary}
              </li>
            ))}
          </ul>
        </article>

        {/* Журнал списаний бюджета и Экспорт */}
        <article
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "18px"
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Журнал бюджета и экспорт результата
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px 0" }}>
            {vm.budget_ledger.map((entry) => (
              <li
                key={entry.id}
                style={{
                  fontSize: "12px",
                  color: theme.text_secondary,
                  padding: "6px 0",
                  borderBottom: `1px solid ${theme.border_subtle}`
                }}
              >
                <strong>{entry.agent_role}</strong>:{" "}
                {entry.amount !== null
                  ? `$${entry.amount.toFixed(2)}`
                  : entry.usage_status}{" "}
                — {entry.description}
              </li>
            ))}
          </ul>
          <div style={{ fontSize: "13px", color: theme.text_primary }}>
            <strong>Экспорт изолированного пакета миссии:</strong>{" "}
            {vm.export_formats.join(" / ")} (без секретов и чужих проектов)
          </div>
          {mission.final_summary && (
            <p
              style={{
                fontSize: "12px",
                color: theme.text_secondary,
                marginTop: "10px",
                marginBottom: 0
              }}
            >
              {mission.final_summary}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

export default KosmoraMissionControlPanel;
