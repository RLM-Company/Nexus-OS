/**
 * Self-contained View-Model for the Kosmora Sovereign Workspace Page (`apps/web`).
 * Avoids cross-package relative traversal outside `apps/web/src` and enforces a strict
 * monochrome palette (`#0a0a0a`, `#141414`, `#262626`, `#e5e5e5`, `#a3a3a3`, `#ffffff`).
 */

export interface WorkspacePaletteTheme {
  background_primary: "#0a0a0a";
  background_elevated: "#141414";
  border_subtle: "#262626";
  text_primary: "#ffffff";
  text_secondary: "#e5e5e5";
  text_muted: "#a3a3a3";
  accent_monochrome: "#ffffff";
}

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

export interface KosmoraWorkspaceViewModel {
  title: string;
  subtitle: string;
  theme: WorkspacePaletteTheme;
  dag_summary: {
    plan_id: string;
    goal: string;
    total_nodes: number;
    completed_nodes: number;
    awaiting_hitl_nodes: number;
    budget_limit_usd: number;
    consumed_cost_usd: number;
    nodes: Array<{
      node_id: string;
      title: string;
      role: string;
      status: "succeeded" | "ready" | "awaiting_hitl" | "blocked";
      dependencies: string[];
    }>;
  };
  canvas_summary: {
    artifact_id: string;
    title: string;
    version: number;
    content_sha256: string;
    blocks_count: number;
    exports_available: Array<"XLSX" | "PDF" | "MD" | "ZIP">;
  };
  knowledge_summary: {
    project_id: string;
    retrieval_mode: "vector_embedding_adapter" | "keyword_bm25_fallback";
    active_nodes: number;
    stale_alerts: number;
    top_hit_title: string;
  };
  governance_summary: {
    tenant_id: string;
    rls_enforced: boolean;
    vault_cipher: "AES-256-GCM";
    audit_chain_verified: boolean;
    audit_entries_count: number;
  };
  sovereign_cluster_summary: {
    leader_peer_id: string;
    quorum_term: number;
    fencing_token: number;
    crdt_converged: boolean;
    ed25519_slsa_attested: boolean;
    distilled_skills_promoted: number;
  };
  formal_and_finops_summary: {
    fsm_invariants_verified: boolean;
    csp_anti_affinity_satisfied: boolean;
    w3c_trace_critical_path_ms: number;
    taint_analysis_clean: boolean;
    ucb1_selected_provider: string;
    dp_remaining_epsilon: number;
    merkle_selective_disclosure_verified: boolean;
    rtbf_zero_residue_confirmed: boolean;
  };
  quantum_and_gametheory_summary: {
    hkdf_sha512_active: boolean;
    shamir_threshold_scheme: string;
    fiat_shamir_nizkp_verified: boolean;
    lamport_pqc_signatures_verified: boolean;
    shapley_efficiency_verified: boolean;
    vcg_strategy_proof_verified: boolean;
    schulze_condorcet_winner: string;
    gale_shapley_blocking_pairs: number;
  };
  causal_and_homomorphic_summary: {
    pearl_do_calculus_ace: number;
    counterfactual_ite_verified: boolean;
    bayesian_map_hypothesis: string;
    thompson_selected_strategy: string;
    paillier_homomorphic_verified: boolean;
    wesolowski_vdf_verified: boolean;
    macaroon_caveats_enforced: boolean;
    byzantine_quorum_intersection_verified: boolean;
  };
  mission_control: MissionControlViewModel;
}

export const KOSMORA_MONOCHROME_THEME: WorkspacePaletteTheme = Object.freeze({
  background_primary: "#0a0a0a",
  background_elevated: "#141414",
  border_subtle: "#262626",
  text_primary: "#ffffff",
  text_secondary: "#e5e5e5",
  text_muted: "#a3a3a3",
  accent_monochrome: "#ffffff"
});

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
      allowed_tools: [
        "sandbox_code_runner",
        "ast_inspector",
        "schema_validator"
      ],
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

export function buildKosmoraWorkspaceViewModel(overrides?: {
  project_id?: string;
  tenant_id?: string;
  mission_mode?: MissionControlViewModel["ui_mode"];
}): KosmoraWorkspaceViewModel {
  const projectId = overrides?.project_id ?? "proj_sovereign_q4";
  const tenantId = overrides?.tenant_id ?? "tenant_enterprise_01";

  return {
    title: "Суверенная ИИ-ОС Kosmora — Центр управления (384 модуля, Stage 1–12)",
    subtitle:
      "Детерминированное исполнение DAG, версионируемый холст CRDT/CAS, граф знаний, Raft-кворум, формальная верификация (Stage 7) и FinOps/ZK-комплаенс (Stage 8)",
    theme: KOSMORA_MONOCHROME_THEME,
    dag_summary: {
      plan_id: `plan_${projectId}_01`,
      goal: "Синтез квартального финансового отчёта и аудит безопасности",
      total_nodes: 4,
      completed_nodes: 3,
      awaiting_hitl_nodes: 1,
      budget_limit_usd: 25.0,
      consumed_cost_usd: 0.42,
      nodes: [
        {
          node_id: "n1_ingest",
          title: "Сбор первичных документов и проверка источников",
          role: "researcher",
          status: "succeeded",
          dependencies: []
        },
        {
          node_id: "n2_model",
          title: "Расчёт финансовой модели и сверка баланса",
          role: "analyst",
          status: "succeeded",
          dependencies: ["n1_ingest"]
        },
        {
          node_id: "n3_critic",
          title: "Проверка ограничений политики и цитирований",
          role: "verifier",
          status: "succeeded",
          dependencies: ["n2_model"]
        },
        {
          node_id: "n4_publish",
          title: "Публикация пакета и отправка в коннектор GitHub",
          role: "synthesizer",
          status: "awaiting_hitl",
          dependencies: ["n3_critic"]
        }
      ]
    },
    canvas_summary: {
      artifact_id: "art_q4_board_brief",
      title: "Финансовый меморандум Совета директоров (Q4)",
      version: 2,
      content_sha256:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      blocks_count: 3,
      exports_available: ["XLSX", "PDF", "MD", "ZIP"]
    },
    knowledge_summary: {
      project_id: projectId,
      retrieval_mode: "keyword_bm25_fallback",
      active_nodes: 12,
      stale_alerts: 1,
      top_hit_title: "Утверждённый прогноз выручки и лимитов FinOps"
    },
    governance_summary: {
      tenant_id: tenantId,
      rls_enforced: true,
      vault_cipher: "AES-256-GCM",
      audit_chain_verified: true,
      audit_entries_count: 18
    },
    sovereign_cluster_summary: {
      leader_peer_id: "node-alpha",
      quorum_term: 1,
      fencing_token: 1001,
      crdt_converged: true,
      ed25519_slsa_attested: true,
      distilled_skills_promoted: 4
    },
    formal_and_finops_summary: {
      fsm_invariants_verified: true,
      csp_anti_affinity_satisfied: true,
      w3c_trace_critical_path_ms: 180,
      taint_analysis_clean: true,
      ucb1_selected_provider: "gemini_primary (gemini-2.5-pro)",
      dp_remaining_epsilon: 1.5,
      merkle_selective_disclosure_verified: true,
      rtbf_zero_residue_confirmed: true
    },
    quantum_and_gametheory_summary: {
      hkdf_sha512_active: true,
      shamir_threshold_scheme: "GF(65537) k=3 of n=5",
      fiat_shamir_nizkp_verified: true,
      lamport_pqc_signatures_verified: true,
      shapley_efficiency_verified: true,
      vcg_strategy_proof_verified: true,
      schulze_condorcet_winner: "arch_plan_a",
      gale_shapley_blocking_pairs: 0
    },
    causal_and_homomorphic_summary: {
      pearl_do_calculus_ace: 2.2,
      counterfactual_ite_verified: true,
      bayesian_map_hypothesis: "hyp_token_quota_throttled",
      thompson_selected_strategy: "strategy_flagship_cot",
      paillier_homomorphic_verified: true,
      wesolowski_vdf_verified: true,
      macaroon_caveats_enforced: true,
      byzantine_quorum_intersection_verified: true
    },
    mission_control: buildMissionControlViewModel({
      mode: overrides?.mission_mode ?? "waiting_for_review"
    })
  };
}
