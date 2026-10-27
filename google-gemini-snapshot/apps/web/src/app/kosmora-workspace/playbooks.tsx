import React from "react";
import {
  KOSMORA_MONOCHROME_THEME,
  type WorkspacePaletteTheme
} from "./view-model.js";
import type { UiAgentRole } from "./mission-control.js";

export type UiPlaybookVisibility =
  | "private"
  | "project"
  | "organization"
  | "built_in";

export type UiPlaybookStatus = "draft" | "active" | "archived";

export type UiPlaybookVariableType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "url";

export type PlaybooksUiMode =
  | "active"
  | "loading"
  | "empty"
  | "validation_error"
  | "access_denied"
  | "archived";

export interface UiPlaybookVariableItem {
  key: string;
  label: string;
  description: string;
  type: UiPlaybookVariableType;
  required: boolean;
  default_value: string | number | boolean;
  secret: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export interface UiPlaybookTaskTemplateItem {
  key: string;
  title_template: string;
  instruction_template: string;
  assigned_agent_role: UiAgentRole;
  execution_mode: "autonomous" | "require_review" | "require_clarification";
  requested_tools: string[];
  priority: "low" | "medium" | "high" | "critical";
  dependencies: string[];
  budget_limit: number;
  max_attempts: number;
  condition_expression: string | null;
  requires_owner_review: boolean;
}

export interface UiPlaybookVersionItem {
  id: string;
  version_number: number;
  changelog: string;
  created_by: string;
  created_at: string;
  checksum_sha256: string;
  is_published: boolean;
}

export interface UiPlaybookCardItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  visibility: UiPlaybookVisibility;
  status: UiPlaybookStatus;
  current_version: number;
  default_budget_limit: number;
  mission_title_template: string;
  goal_template: string;
  variables: UiPlaybookVariableItem[];
  tasks: UiPlaybookTaskTemplateItem[];
  versions: UiPlaybookVersionItem[];
}

export interface UiPlaybookPreviewIncludedTask {
  key: string;
  title: string;
  instruction: string;
  assigned_agent_role: UiAgentRole;
  priority: "low" | "medium" | "high" | "critical";
  dependencies: string[];
  budget_limit: number;
  requires_owner_review: boolean;
}

export interface UiPlaybookPreviewExcludedTask {
  key: string;
  title_template: string;
  assigned_agent_role: UiAgentRole;
  condition_expression: string;
  reason: string;
  budget_saved: number;
}

export interface UiPlaybookMissionPreview {
  playbook_id: string;
  version_number: number;
  resolved_mission_title: string;
  resolved_goal: string;
  included_tasks: UiPlaybookPreviewIncludedTask[];
  excluded_tasks: UiPlaybookPreviewExcludedTask[];
  dag_edges: Array<{ from: string; to: string }>;
  planned_budget: number;
  mission_budget_limit: number;
  within_budget: boolean;
  requires_hitl_checkpoints: number;
}

export interface UiPlaybookVersionDiff {
  playbook_id: string;
  from_version: number;
  to_version: number;
  from_checksum_sha256: string;
  to_checksum_sha256: string;
  summary: string;
  variable_changes: Array<{
    key: string;
    change: "added" | "removed" | "modified";
    changed_fields: string[];
  }>;
  task_changes: Array<{
    key: string;
    change: "added" | "removed" | "modified";
    changed_fields: string[];
  }>;
}

export interface PlaybooksViewModel {
  ui_mode: PlaybooksUiMode;
  theme: WorkspacePaletteTheme;
  categories: string[];
  all_tags: string[];
  selected_category: string | null;
  selected_tag: string | null;
  playbooks: UiPlaybookCardItem[];
  selected_playbook: UiPlaybookCardItem | null;
  variable_values: Record<string, string | number | boolean>;
  validation_errors: Record<string, string>;
  live_preview: UiPlaybookMissionPreview | null;
  version_diff: UiPlaybookVersionDiff | null;
  created_mission_link: {
    mission_id: string;
    mission_title: string;
    href: string;
    playbook_version: number;
  } | null;
}

const ROLE_LABELS_RU: Record<UiAgentRole, string> = {
  researcher: "Исследователь (Researcher)",
  analyst: "Аналитик (Analyst)",
  writer: "Редактор (Writer)",
  reviewer: "Ревьюер (Reviewer)",
  developer: "Инженер (Developer)",
  designer: "Дизайнер схем (Designer)",
  operator: "Оператор (Operator)"
};

const VISIBILITY_LABELS_RU: Record<UiPlaybookVisibility, string> = {
  built_in: "Встроенный шаблон",
  private: "Личный",
  project: "Проектный",
  organization: "Организация"
};

const STATUS_LABELS_RU: Record<UiPlaybookStatus, string> = {
  active: "Активен",
  draft: "Черновик",
  archived: "В архиве"
};

const DEFAULT_UI_PLAYBOOKS: UiPlaybookCardItem[] = [
  {
    id: "pbk_builtin_market_research",
    slug: "market-research",
    title: "Исследование рынка",
    description:
      "Комплексное исследование целевого рынка: сбор первоисточников, сегментация конкурентов и рисков, подготовка аналитического меморандума и независимая проверка фактов.",
    category: "Исследования и аналитика",
    tags: ["рынок", "конкуренты", "аналитика", "источники"],
    visibility: "built_in",
    status: "active",
    current_version: 1,
    default_budget_limit: 25.0,
    mission_title_template:
      "Исследование рынка {{market}} для проекта {{project_name}}",
    goal_template:
      "{{goal}} на рынке {{market}} (регион: {{country}}) к сроку {{deadline}}.",
    variables: [
      {
        key: "project_name",
        label: "Название проекта",
        description: "Внутреннее или продуктовое имя инициативы",
        type: "text",
        required: true,
        default_value: "EdTech Core",
        secret: false
      },
      {
        key: "goal",
        label: "Цель исследования",
        description: "Ключевой вопрос или гипотеза для проверки",
        type: "textarea",
        required: true,
        default_value: "Оценить ёмкость рынка, барьеры входа и топ-5 игроков",
        secret: false
      },
      {
        key: "market",
        label: "Сегмент рынка",
        description: "Отрасль или вертикаль исследования",
        type: "select",
        required: true,
        default_value: "EdTech",
        secret: false,
        options: [
          { value: "EdTech", label: "Образовательные технологии (EdTech)" },
          { value: "FinTech", label: "Финансовые технологии (FinTech)" },
          { value: "HealthTech", label: "Цифровая медицина (HealthTech)" },
          { value: "EnterpriseAI", label: "Корпоративный ИИ (Enterprise AI)" }
        ]
      },
      {
        key: "country",
        label: "Целевой регион / страна",
        description: "География анализа (если пусто — региональный срез пропускается)",
        type: "text",
        required: false,
        default_value: "Россия и СНГ",
        secret: false
      },
      {
        key: "deadline",
        label: "Контрольный срок",
        description: "Целевая дата готовности отчёта",
        type: "text",
        required: true,
        default_value: "2026-11-15",
        secret: false
      },
      {
        key: "budget",
        label: "Оценка бюджета исследования ($)",
        description: "Плановый лимит вычислительного бюджета сценария",
        type: "number",
        required: true,
        default_value: 22,
        min: 4,
        max: 100,
        secret: false
      },
      {
        key: "source_url",
        label: "Базовый отраслевой портал (URL)",
        description: "Ссылка на стартовый аналитический источник или датасет",
        type: "url",
        required: false,
        default_value: "https://example.com/market-reports",
        secret: false
      },
      {
        key: "api_access_token",
        label: "Секретный ключ внешнего дата-провайдера",
        description: "Токен доступа (маскируется и не попадает в публичные логи/экспорт)",
        type: "text",
        required: false,
        default_value: "",
        secret: true
      }
    ],
    tasks: [
      {
        key: "research_sources",
        title_template: "Сбор и верификация источников по рынку {{market}}",
        instruction_template:
          "Собрать проверяемые первоисточники по проекту {{project_name}} для цели: {{goal}}.",
        assigned_agent_role: "researcher",
        execution_mode: "autonomous",
        requested_tools: ["web_search", "citation_extractor"],
        priority: "high",
        dependencies: [],
        budget_limit: 4.5,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "regional_regulations",
        title_template: "Анализ региональной специфики ({{country}})",
        instruction_template:
          "Проанализировать регуляторные особенности рынка {{market}} в регионе {{country}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["knowledge_graph_query", "data_table_builder"],
        priority: "medium",
        dependencies: ["research_sources"],
        budget_limit: 3.5,
        max_attempts: 2,
        condition_expression: '{{country}} != ""',
        requires_owner_review: false
      },
      {
        key: "market_and_risk_analysis",
        title_template: "Структура рынка {{market}}, конкуренты и матрица рисков",
        instruction_template:
          "Выделить объём рынка {{market}}, ключевых конкурентов и риски для {{project_name}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["metric_calculator", "data_table_builder"],
        priority: "high",
        dependencies: ["research_sources", "regional_regulations"],
        budget_limit: 5.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "synthesis_report",
        title_template: "Сборка аналитического меморандума для {{project_name}}",
        instruction_template:
          "Сформировать итоговый структурированный отчёт по цели «{{goal}}» к {{deadline}}.",
        assigned_agent_role: "writer",
        execution_mode: "autonomous",
        requested_tools: ["markdown_composer", "document_reader"],
        priority: "high",
        dependencies: ["market_and_risk_analysis"],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "fact_review",
        title_template: "Финальная верификация фактов и противоречий",
        instruction_template:
          "Проверить отчёт по проекту {{project_name}} на точность цифр и отсутствие противоречий.",
        assigned_agent_role: "reviewer",
        execution_mode: "require_review",
        requested_tools: ["citation_verifier", "fact_consistency_checker"],
        priority: "critical",
        dependencies: ["synthesis_report"],
        budget_limit: 3.5,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ],
    versions: [
      {
        id: "pbk_builtin_market_research_v1",
        version_number: 1,
        changelog: "Базовая опубликованная версия шаблона исследования рынка (v1).",
        created_by: "system_kosmora",
        created_at: "2026-10-26T00:00:00.000Z",
        checksum_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        is_published: true
      }
    ]
  },
  {
    id: "pbk_builtin_presentation_prep",
    slug: "presentation-prep",
    title: "Подготовка презентации",
    description:
      "Конвейер создания инвестиционной или продуктовой презентации: сбор фактуры, расчёт метрик, структура слайдов, опциональное визуальное проектирование и финальное ревью.",
    category: "Коммуникации и питчи",
    tags: ["презентация", "слайды", "дизайн", "питч"],
    visibility: "built_in",
    status: "active",
    current_version: 1,
    default_budget_limit: 24.0,
    mission_title_template:
      "Подготовка презентации: {{project_name}} ({{market}})",
    goal_template:
      "Подготовить и верифицировать структуру презентации по цели: {{goal}} к {{deadline}}.",
    variables: [
      {
        key: "project_name",
        label: "Название проекта",
        description: "Название продукта для титульного слайда",
        type: "text",
        required: true,
        default_value: "Kosmora Sovereign Deck",
        secret: false
      },
      {
        key: "goal",
        label: "Ключевой тезис презентации",
        description: "Целевое решение аудитории",
        type: "textarea",
        required: true,
        default_value: "Защитить стратегию масштабирования на Q4",
        secret: false
      },
      {
        key: "market",
        label: "Целевой рынок",
        description: "Рыночный сегмент",
        type: "text",
        required: true,
        default_value: "Enterprise AI",
        secret: false
      },
      {
        key: "deadline",
        label: "Дата защиты",
        description: "Срок готовности презентации",
        type: "text",
        required: true,
        default_value: "2026-11-20",
        secret: false
      },
      {
        key: "include_design",
        label: "Включить проектирование визуальных схем (Designer)",
        description:
          "При отключении задача агента Designer исключается из графа миссии",
        type: "boolean",
        required: true,
        default_value: true,
        secret: false
      }
    ],
    tasks: [
      {
        key: "deck_research",
        title_template: "Сбор фактов и рыночных бенчмарков ({{market}})",
        instruction_template:
          "Собрать опорные факты для презентации проекта {{project_name}}.",
        assigned_agent_role: "researcher",
        execution_mode: "autonomous",
        requested_tools: ["web_search", "citation_extractor"],
        priority: "high",
        dependencies: [],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "deck_metrics",
        title_template: "Сводная таблица метрик и юнит-экономики",
        instruction_template:
          "Построить проверенные таблицы показателей для слайдов {{project_name}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["data_table_builder", "risk_matrix_evaluator"],
        priority: "high",
        dependencies: ["deck_research"],
        budget_limit: 4.5,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "deck_storyline",
        title_template: "Послайдовая структура и тезисы презентации",
        instruction_template:
          "Составить послайдовый план презентации {{project_name}} к {{deadline}}.",
        assigned_agent_role: "writer",
        execution_mode: "autonomous",
        requested_tools: ["outline_structurer", "markdown_composer"],
        priority: "high",
        dependencies: ["deck_metrics"],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "deck_visual_layout",
        title_template: "Визуальные диаграммы и монохромная сетка слайдов",
        instruction_template:
          "Спроектировать архитектурные схемы и макеты ключевых слайдов для {{project_name}}.",
        assigned_agent_role: "designer",
        execution_mode: "autonomous",
        requested_tools: ["wireframe_spec_builder", "layout_grid_planner"],
        priority: "medium",
        dependencies: ["deck_storyline"],
        budget_limit: 4.5,
        max_attempts: 2,
        condition_expression: "{{include_design}} == true",
        requires_owner_review: false
      },
      {
        key: "deck_final_review",
        title_template: "Ревью фактов и утверждение структуры презентации",
        instruction_template:
          "Проверить согласованность цифр и тезисов презентации {{project_name}}.",
        assigned_agent_role: "reviewer",
        execution_mode: "require_review",
        requested_tools: ["citation_verifier", "fact_consistency_checker"],
        priority: "critical",
        dependencies: ["deck_visual_layout"],
        budget_limit: 3.5,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ],
    versions: [
      {
        id: "pbk_builtin_presentation_prep_v1",
        version_number: 1,
        changelog: "Базовая опубликованная версия шаблона подготовки презентации (v1).",
        created_by: "system_kosmora",
        created_at: "2026-10-26T00:00:00.000Z",
        checksum_sha256:
          "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
        is_published: true
      }
    ]
  },
  {
    id: "pbk_builtin_repository_audit",
    slug: "repository-audit",
    title: "Аудит репозитория",
    description:
      "Инженерный аудит кодовой базы: разбор модулей агентом Developer, проверка безопасности и политики качества агентом Reviewer с контрольной точкой владельца.",
    category: "Инженерия и безопасность",
    tags: ["код", "аудит", "безопасность", "репозиторий"],
    visibility: "built_in",
    status: "active",
    current_version: 1,
    default_budget_limit: 20.0,
    mission_title_template: "Технический аудит репозитория {{project_name}}",
    goal_template:
      "Провести инженерный аудит кодовой базы {{project_name}} ({{repo_url}}) с фокусом: {{goal}}.",
    variables: [
      {
        key: "project_name",
        label: "Название сервиса / репозитория",
        description: "Имя проверяемого программного модуля",
        type: "text",
        required: true,
        default_value: "nexus-os-core",
        secret: false
      },
      {
        key: "repo_url",
        label: "URL репозитория",
        description: "HTTP/HTTPS ссылка на git-репозиторий",
        type: "url",
        required: true,
        default_value: "https://github.com/kosmora/nexus-os",
        secret: false
      },
      {
        key: "target_branch",
        label: "Целевая ветка",
        description: "Ветка или тег для проверки",
        type: "text",
        required: true,
        default_value: "main",
        secret: false
      },
      {
        key: "goal",
        label: "Приоритеты аудита",
        description: "На что обратить особое внимание",
        type: "textarea",
        required: true,
        default_value:
          "Проверить отсутствие циклов зависимостей, строгость типов и безопасность SQL-запросов",
        secret: false
      },
      {
        key: "budget",
        label: "Лимит бюджета аудита ($)",
        description: "При бюджете >= 15$ включается углублённый прогон тестов",
        type: "number",
        required: true,
        default_value: 16,
        min: 8,
        max: 60,
        secret: false
      }
    ],
    tasks: [
      {
        key: "code_static_analysis",
        title_template: "AST-навигация и проверка архитектуры {{project_name}}",
        instruction_template:
          "Выполнить разбор ветки {{target_branch}} репозитория {{repo_url}}.",
        assigned_agent_role: "developer",
        execution_mode: "autonomous",
        requested_tools: ["ast_inspector", "sandbox_code_runner"],
        priority: "high",
        dependencies: [],
        budget_limit: 6.5,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "deep_sandbox_verification",
        title_template: "Углублённый прогон тестов в песочнице ({{project_name}})",
        instruction_template:
          "Запустить расширенный набор интеграционных проверок для {{project_name}}.",
        assigned_agent_role: "developer",
        execution_mode: "autonomous",
        requested_tools: ["sandbox_code_runner", "schema_validator"],
        priority: "medium",
        dependencies: ["code_static_analysis"],
        budget_limit: 4.5,
        max_attempts: 2,
        condition_expression: "{{budget}} >= 15",
        requires_owner_review: false
      },
      {
        key: "security_and_policy_review",
        title_template: "Ревью безопасности и приёмка владельцем (Owner Review)",
        instruction_template:
          "Проверить отчёт разработчика по {{project_name}} и передать владельцу.",
        assigned_agent_role: "reviewer",
        execution_mode: "require_review",
        requested_tools: ["policy_compliance_auditor", "fact_consistency_checker"],
        priority: "critical",
        dependencies: ["deep_sandbox_verification"],
        budget_limit: 4.0,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ],
    versions: [
      {
        id: "pbk_builtin_repository_audit_v1",
        version_number: 1,
        changelog: "Базовая опубликованная версия шаблона аудита репозитория (v1).",
        created_by: "system_kosmora",
        created_at: "2026-10-26T00:00:00.000Z",
        checksum_sha256:
          "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
        is_published: true
      }
    ]
  },
  {
    id: "pbk_builtin_document_package",
    slug: "document-package-analysis",
    title: "Разбор пакета документов",
    description:
      "Последовательный разбор договорного, тендерного или нормативного пакета документов: извлечение фактов, матрица обязательств и рисков, сводный меморандум и ревью.",
    category: "Документооборот и комплаенс",
    tags: ["документы", "договоры", "риски", "комплаенс"],
    visibility: "built_in",
    status: "active",
    current_version: 1,
    default_budget_limit: 22.0,
    mission_title_template: "Разбор пакета документов: {{project_name}}",
    goal_template:
      "Извлечь ключевые условия, риски и расхождения из пакета документов по проекту {{project_name}}: {{goal}}.",
    variables: [
      {
        key: "project_name",
        label: "Наименование сделки или проекта",
        description: "Идентификатор пакета документов",
        type: "text",
        required: true,
        default_value: "Enterprise SLA 2026",
        secret: false
      },
      {
        key: "package_type",
        label: "Тип пакета документов",
        description: "Категория проверяемой документации",
        type: "select",
        required: true,
        default_value: "contract_pack",
        secret: false,
        options: [
          { value: "contract_pack", label: "Договорной пакет и SLA" },
          { value: "tender_docs", label: "Тендерная документация" },
          { value: "regulatory_filing", label: "Нормативные и регуляторные акты" }
        ]
      },
      {
        key: "goal",
        label: "Фокус проверки",
        description: "Какие риски требуют особого контроля",
        type: "textarea",
        required: true,
        default_value:
          "Выявить штрафные санкции, односторонние отказы и несоответствия SLA",
        secret: false
      },
      {
        key: "deadline",
        label: "Срок заключения",
        description: "Крайняя дата подготовки заключения",
        type: "text",
        required: true,
        default_value: "2026-11-10",
        secret: false
      }
    ],
    tasks: [
      {
        key: "parse_documents",
        title_template: "Парсинг и индексация пакета ({{package_type}})",
        instruction_template:
          "Извлечь структуру и ключевые пункты из пакета документов {{project_name}}.",
        assigned_agent_role: "researcher",
        execution_mode: "autonomous",
        requested_tools: ["document_reader", "citation_extractor"],
        priority: "high",
        dependencies: [],
        budget_limit: 4.5,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "obligation_risk_matrix",
        title_template: "Матрица обязательств, сроков и рисков",
        instruction_template:
          "Сопоставить финансовые и операционные риски в пакете {{project_name}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["data_table_builder", "knowledge_graph_query"],
        priority: "high",
        dependencies: ["parse_documents"],
        budget_limit: 5.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "executive_summary_memo",
        title_template: "Сводное заключение и таблица разногласий",
        instruction_template:
          "Подготовить итоговый меморандум по пакету {{project_name}} к сроку {{deadline}}.",
        assigned_agent_role: "writer",
        execution_mode: "autonomous",
        requested_tools: ["markdown_composer", "document_reader"],
        priority: "high",
        dependencies: ["obligation_risk_matrix"],
        budget_limit: 4.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "compliance_verification",
        title_template: "Проверка точности ссылок на пункты и утверждение",
        instruction_template:
          "Сверить каждую ссылку на пункт документа в заключении по {{project_name}}.",
        assigned_agent_role: "reviewer",
        execution_mode: "require_review",
        requested_tools: ["citation_verifier", "policy_compliance_auditor"],
        priority: "critical",
        dependencies: ["executive_summary_memo"],
        budget_limit: 3.5,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ],
    versions: [
      {
        id: "pbk_builtin_document_package_v1",
        version_number: 1,
        changelog: "Базовая опубликованная версия шаблона разбора пакета документов (v1).",
        created_by: "system_kosmora",
        created_at: "2026-10-26T00:00:00.000Z",
        checksum_sha256:
          "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
        is_published: true
      }
    ]
  },
  {
    id: "pbk_builtin_client_project_launch",
    slug: "client-project-launch",
    title: "Запуск клиентского проекта",
    description:
      "Операционный плейбук старта клиентского проекта: декомпозиция требований и рисков (Analyst), подготовка устава проекта (Writer), контроль регламентов и бюджетов (Operator) с финальным подтверждением владельца.",
    category: "Операции и управление проектами",
    tags: ["запуск", "клиент", "операции", "регламент"],
    visibility: "built_in",
    status: "active",
    current_version: 1,
    default_budget_limit: 20.0,
    mission_title_template: "Запуск клиентского проекта: {{project_name}}",
    goal_template:
      "Подготовить полный операционный пакет запуска проекта {{project_name}} (цель: {{goal}}) к {{deadline}}.",
    variables: [
      {
        key: "project_name",
        label: "Название клиентского проекта",
        description: "Код или наименование запускаемого проекта",
        type: "text",
        required: true,
        default_value: "Vega Enterprise Rollout",
        secret: false
      },
      {
        key: "goal",
        label: "Целевой результат запуска",
        description: "Критерии успешного старта первой фазы",
        type: "textarea",
        required: true,
        default_value:
          "Утвердить устав проекта, матрицу ответственности RACI и бюджетный контур",
        secret: false
      },
      {
        key: "market",
        label: "Индустрия клиента",
        description: "Отраслевой профиль заказчика",
        type: "text",
        required: true,
        default_value: "FinTech",
        secret: false
      },
      {
        key: "country",
        label: "Юрисдикция запуска",
        description: "Страна или регион развёртывания",
        type: "text",
        required: true,
        default_value: "Казахстан",
        secret: false
      },
      {
        key: "deadline",
        label: "Дата kick-off встречи",
        description: "Целевая дата готовности пакета запуска",
        type: "text",
        required: true,
        default_value: "2026-11-05",
        secret: false
      }
    ],
    tasks: [
      {
        key: "scope_and_budget_baseline",
        title_template: "Расчёт ресурсного плана и рисков ({{project_name}})",
        instruction_template:
          "Сформировать ресурсную модель и реестр стартовых рисков для проекта {{project_name}}.",
        assigned_agent_role: "analyst",
        execution_mode: "autonomous",
        requested_tools: ["data_table_builder", "risk_matrix_evaluator"],
        priority: "high",
        dependencies: [],
        budget_limit: 5.0,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "project_charter_doc",
        title_template: "Подготовка устава проекта и плана фаз",
        instruction_template:
          "Написать устав проекта {{project_name}} по цели «{{goal}}» к дате {{deadline}}.",
        assigned_agent_role: "writer",
        execution_mode: "autonomous",
        requested_tools: ["markdown_composer", "outline_structurer"],
        priority: "high",
        dependencies: ["scope_and_budget_baseline"],
        budget_limit: 4.5,
        max_attempts: 3,
        condition_expression: null,
        requires_owner_review: false
      },
      {
        key: "operational_readiness_gate",
        title_template: "Операционный чеклист, контроль бюджета и приёмка владельцем",
        instruction_template:
          "Проверить комплектность пакета запуска {{project_name}} и передать владельцу.",
        assigned_agent_role: "operator",
        execution_mode: "require_review",
        requested_tools: ["budget_auditor", "export_packager"],
        priority: "critical",
        dependencies: ["project_charter_doc"],
        budget_limit: 3.5,
        max_attempts: 2,
        condition_expression: null,
        requires_owner_review: true
      }
    ],
    versions: [
      {
        id: "pbk_builtin_client_project_launch_v1",
        version_number: 1,
        changelog: "Базовая опубликованная версия шаблона запуска клиентского проекта (v1).",
        created_by: "system_kosmora",
        created_at: "2026-10-26T00:00:00.000Z",
        checksum_sha256:
          "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
        is_published: true
      }
    ]
  }
];

function interpolateUiPreviewText(
  template: string,
  values: Record<string, string | number | boolean>,
  variables: UiPlaybookVariableItem[]
): string {
  const secretSet = new Set(variables.filter((v) => v.secret).map((v) => v.key));
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (secretSet.has(key)) return "[REDACTED_SECRET]";
    const val = values[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

function evaluateUiCondition(
  expr: string | null,
  values: Record<string, string | number | boolean>
): { included: boolean; reason: string } {
  if (!expr || expr.trim().length === 0) {
    return { included: true, reason: "Безусловная задача" };
  }
  const match = expr.match(
    /^\s*(?:\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|([a-zA-Z0-9_]+))\s*(==|!=|>=|<=|>|<)\s*(true|false|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\s*$/
  );
  if (!match) {
    return { included: false, reason: `Некорректное условие: ${expr}` };
  }
  const key = (match[1] || match[2] || "").trim();
  const op = match[3]!;
  const rawLit = match[4]!;
  const target =
    rawLit === "true"
      ? true
      : rawLit === "false"
        ? false
        : (rawLit.startsWith('"') && rawLit.endsWith('"')) ||
            (rawLit.startsWith("'") && rawLit.endsWith("'"))
          ? rawLit.slice(1, -1)
          : Number(rawLit);
  const actual = values[key];

  let passed = false;
  switch (op) {
    case "==":
      passed = actual === target || String(actual) === String(target);
      break;
    case "!=":
      passed = actual !== target && String(actual) !== String(target);
      break;
    case ">=":
      passed = Number(actual) >= Number(target);
      break;
    case "<=":
      passed = Number(actual) <= Number(target);
      break;
    case ">":
      passed = Number(actual) > Number(target);
      break;
    case "<":
      passed = Number(actual) < Number(target);
      break;
  }
  return {
    included: passed,
    reason: passed
      ? `Условие выполнено (${expr})`
      : `Исключена по условию ${expr} (значение ${key} = ${JSON.stringify(actual)})`
  };
}

export function computeUiPlaybookPreview(
  playbook: UiPlaybookCardItem,
  values: Record<string, string | number | boolean>
): UiPlaybookMissionPreview {
  const includedKeys = new Set<string>();
  const excludedTasks: UiPlaybookPreviewExcludedTask[] = [];
  const taskMap = new Map(playbook.tasks.map((t) => [t.key, t]));

  for (const t of playbook.tasks) {
    const cond = evaluateUiCondition(t.condition_expression, values);
    if (!cond.included && t.condition_expression) {
      excludedTasks.push({
        key: t.key,
        title_template: t.title_template,
        assigned_agent_role: t.assigned_agent_role,
        condition_expression: t.condition_expression,
        reason: cond.reason,
        budget_saved: t.budget_limit
      });
    } else {
      includedKeys.add(t.key);
    }
  }

  const resolveDeps = (taskKey: string): string[] => {
    const t = taskMap.get(taskKey);
    if (!t) return [];
    const result = new Set<string>();
    const visit = (depKey: string): void => {
      if (includedKeys.has(depKey)) {
        result.add(depKey);
      } else {
        const excludedDep = taskMap.get(depKey);
        for (const up of excludedDep?.dependencies ?? []) {
          visit(up);
        }
      }
    };
    for (const d of t.dependencies) visit(d);
    return Array.from(result);
  };

  const includedTasks: UiPlaybookPreviewIncludedTask[] = [];
  const dagEdges: Array<{ from: string; to: string }> = [];

  for (const t of playbook.tasks) {
    if (!includedKeys.has(t.key)) continue;
    const deps = resolveDeps(t.key);
    for (const d of deps) {
      dagEdges.push({ from: d, to: t.key });
    }
    includedTasks.push({
      key: t.key,
      title: interpolateUiPreviewText(
        t.title_template,
        values,
        playbook.variables
      ),
      instruction: interpolateUiPreviewText(
        t.instruction_template,
        values,
        playbook.variables
      ),
      assigned_agent_role: t.assigned_agent_role,
      priority: t.priority,
      dependencies: deps,
      budget_limit: t.budget_limit,
      requires_owner_review: t.requires_owner_review
    });
  }

  const plannedBudget = Number(
    includedTasks.reduce((acc, t) => acc + t.budget_limit, 0).toFixed(2)
  );
  const budgetLimit =
    typeof values.budget === "number"
      ? Number(values.budget)
      : playbook.default_budget_limit;

  return {
    playbook_id: playbook.id,
    version_number: playbook.current_version,
    resolved_mission_title: interpolateUiPreviewText(
      playbook.mission_title_template,
      values,
      playbook.variables
    ),
    resolved_goal: interpolateUiPreviewText(
      playbook.goal_template,
      values,
      playbook.variables
    ),
    included_tasks: includedTasks,
    excluded_tasks: excludedTasks,
    dag_edges: dagEdges,
    planned_budget: plannedBudget,
    mission_budget_limit: budgetLimit,
    within_budget: plannedBudget <= budgetLimit,
    requires_hitl_checkpoints: includedTasks.filter(
      (t) => t.requires_owner_review || t.assigned_agent_role === "reviewer"
    ).length
  };
}

export function buildPlaybooksViewModel(options?: {
  mode?: PlaybooksUiMode;
  selected_playbook_slug?: string;
  selected_category?: string | null;
  selected_tag?: string | null;
  variable_overrides?: Record<string, string | number | boolean>;
  created_mission_id?: string | null;
}): PlaybooksViewModel {
  const mode = options?.mode ?? "active";
  const allPlaybooks: UiPlaybookCardItem[] = DEFAULT_UI_PLAYBOOKS.map((pb) =>
    mode === "archived" && pb.slug === "market-research"
      ? { ...pb, status: "archived" as const }
      : pb
  );

  const categories = Array.from(new Set(allPlaybooks.map((p) => p.category)));
  const allTags = Array.from(
    new Set(allPlaybooks.flatMap((p) => p.tags))
  );

  const selectedCategory = options?.selected_category ?? null;
  const selectedTag = options?.selected_tag ?? null;

  const filteredPlaybooks =
    mode === "empty"
      ? []
      : allPlaybooks.filter((p) => {
          if (selectedCategory && p.category !== selectedCategory) return false;
          if (selectedTag && !p.tags.includes(selectedTag)) return false;
          return true;
        });

  const targetSlug = options?.selected_playbook_slug ?? "presentation-prep";
  const selectedPlaybook =
    filteredPlaybooks.find((p) => p.slug === targetSlug || p.id === targetSlug) ??
    filteredPlaybooks[0] ??
    null;

  const variableValues: Record<string, string | number | boolean> = {};
  if (selectedPlaybook) {
    for (const v of selectedPlaybook.variables) {
      variableValues[v.key] =
        options?.variable_overrides?.[v.key] !== undefined
          ? options.variable_overrides[v.key]!
          : v.default_value;
    }
  }

  const validationErrors: Record<string, string> = {};
  if (mode === "validation_error" && selectedPlaybook) {
    validationErrors.project_name =
      "Поле «Название проекта» обязательно для заполнения и не может быть пустым.";
    validationErrors.repo_url =
      "Некорректный формат URL: требуется валидный адрес с протоколом https:// или http://.";
  }

  const livePreview = selectedPlaybook
    ? computeUiPlaybookPreview(selectedPlaybook, variableValues)
    : null;

  const versionDiff: UiPlaybookVersionDiff | null = selectedPlaybook
    ? {
        playbook_id: selectedPlaybook.id,
        from_version: 1,
        to_version: 2,
        from_checksum_sha256:
          selectedPlaybook.versions[0]?.checksum_sha256 ?? "sha256_v1",
        to_checksum_sha256:
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        summary:
          "Сравнение v1 → v2: изменений метаданных — 1, переменных — 1, задач — 1.",
        variable_changes: [
          {
            key: "deadline",
            change: "modified",
            changed_fields: ["default_value", "description"]
          }
        ],
        task_changes: [
          {
            key: selectedPlaybook.tasks[0]?.key ?? "task_1",
            change: "modified",
            changed_fields: ["budget_limit", "instruction_template"]
          }
        ]
      }
    : null;

  const createdMissionId = options?.created_mission_id ?? "msn_from_playbook_01";
  const createdMissionLink =
    selectedPlaybook && livePreview
      ? {
          mission_id: createdMissionId,
          mission_title: livePreview.resolved_mission_title,
          href: `/kosmora-workspace/missions?mission_id=${encodeURIComponent(createdMissionId)}`,
          playbook_version: selectedPlaybook.current_version
        }
      : null;

  return {
    ui_mode: mode,
    theme: KOSMORA_MONOCHROME_THEME,
    categories,
    all_tags: allTags,
    selected_category: selectedCategory,
    selected_tag: selectedTag,
    playbooks: filteredPlaybooks,
    selected_playbook: selectedPlaybook,
    variable_values: variableValues,
    validation_errors: validationErrors,
    live_preview: livePreview,
    version_diff: versionDiff,
    created_mission_link: createdMissionLink
  };
}

export function KosmoraPlaybooksPanel(props?: {
  viewModel?: PlaybooksViewModel;
  onSelectPlaybook?: (slug: string) => void;
  onFilterCategory?: (category: string | null) => void;
  onFilterTag?: (tag: string | null) => void;
  onUpdateVariable?: (key: string, value: string | number | boolean) => void;
  onCreateMission?: (playbookId: string) => void;
}): React.ReactElement {
  const vm = props?.viewModel ?? buildPlaybooksViewModel();
  const { theme } = vm;
  const categoryFilter = vm.selected_category;
  const tagFilter = vm.selected_tag;
  const setCategoryFilter = (cat: string | null): void => {
    props?.onFilterCategory?.(cat);
  };
  const setTagFilter = (tag: string | null): void => {
    props?.onFilterTag?.(tag);
  };
  const setSelectedSlug = (slug: string): void => {
    props?.onSelectPlaybook?.(slug);
  };
  const setVarOverrides = (
    next: Record<string, string | number | boolean>
  ): void => {
    for (const [k, v] of Object.entries(next)) {
      props?.onUpdateVariable?.(k, v);
    }
  };
  const setCreatedMissionId = (id: string): void => {
    props?.onCreateMission?.(id);
  };

  if (vm.ui_mode === "loading") {
    return (
      <section
        aria-label="Kosmora Playbooks Loading"
        style={{
          backgroundColor: theme.background_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px",
          padding: "24px",
          color: theme.text_secondary
        }}
      >
        <h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px 0" }}>
          Библиотека плейбуков Kosmora (Playbooks)
        </h2>
        <p style={{ fontSize: "13px", color: theme.text_muted, margin: 0 }}>
          Загрузка версионируемых шаблонов мультиагентных миссий...
        </p>
      </section>
    );
  }

  if (vm.ui_mode === "access_denied") {
    return (
      <section
        aria-label="Kosmora Playbooks Access Denied"
        style={{
          backgroundColor: theme.background_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px",
          padding: "24px",
          color: theme.text_primary
        }}
      >
        <h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px 0" }}>
          Доступ запрещён (Access Denied)
        </h2>
        <p style={{ fontSize: "13px", color: theme.text_secondary, margin: 0 }}>
          У текущего пользователя нет прав на чтение или запуск этого приватного / проектного плейбука.
        </p>
      </section>
    );
  }

  const activePb = vm.selected_playbook;
  const preview = vm.live_preview;

  return (
    <section
      aria-label="Kosmora Playbooks Center"
      style={{
        backgroundColor: theme.background_primary,
        color: theme.text_primary,
        border: `1px solid ${theme.border_subtle}`,
        borderRadius: "10px",
        padding: "24px"
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${theme.border_subtle}`,
          paddingBottom: "16px",
          marginBottom: "20px",
          gap: "12px"
        }}
      >
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
            Kosmora Playbooks — Версионируемые шаблоны миссий
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: theme.text_muted,
              margin: "6px 0 0 0"
            }}
          >
            Выберите готовый сценарий или создайте свой, настройте переменные, проверьте граф задач (DAG) и бюджет перед запуском в Mission Control
          </p>
        </div>
        <nav
          aria-label="Навигация разделов Kosmora"
          style={{ display: "flex", gap: "10px", alignItems: "center" }}
        >
          <a
            href="/kosmora-workspace"
            style={{
              color: theme.text_secondary,
              border: `1px solid ${theme.border_subtle}`,
              backgroundColor: theme.background_elevated,
              padding: "8px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Рабочее пространство
          </a>
          <a
            href="/kosmora-workspace/missions"
            style={{
              color: theme.text_primary,
              border: `1px solid ${theme.text_primary}`,
              backgroundColor: theme.background_elevated,
              padding: "8px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none"
            }}
          >
            Открыть Mission Control →
          </a>
        </nav>
      </header>

      {/* Фильтры по категориям и тегам */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "20px",
          padding: "12px",
          backgroundColor: theme.background_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px"
        }}
      >
        <span
          style={{
            fontSize: "12px",
            color: theme.text_muted,
            alignSelf: "center",
            marginRight: "4px"
          }}
        >
          Категории:
        </span>
        <button
          type="button"
          onClick={() => setCategoryFilter(null)}
          style={{
            backgroundColor:
              categoryFilter === null
                ? theme.text_primary
                : theme.background_primary,
            color:
              categoryFilter === null
                ? theme.background_primary
                : theme.text_secondary,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "4px",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer"
          }}
        >
          Все категории ({DEFAULT_UI_PLAYBOOKS.length})
        </button>
        {vm.categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            style={{
              backgroundColor:
                categoryFilter === cat
                  ? theme.text_primary
                  : theme.background_primary,
              color:
                categoryFilter === cat
                  ? theme.background_primary
                  : theme.text_secondary,
              border: `1px solid ${theme.border_subtle}`,
              borderRadius: "4px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            {cat}
          </button>
        ))}

        <span
          style={{
            fontSize: "12px",
            color: theme.text_muted,
            alignSelf: "center",
            marginLeft: "12px",
            marginRight: "4px"
          }}
        >
          Теги:
        </span>
        {vm.all_tags.slice(0, 8).map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            style={{
              backgroundColor:
                tagFilter === tag
                  ? theme.text_primary
                  : theme.background_primary,
              color:
                tagFilter === tag
                  ? theme.background_primary
                  : theme.text_muted,
              border: `1px solid ${theme.border_subtle}`,
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer"
            }}
          >
            #{tag}
          </button>
        ))}
      </div>

      {vm.playbooks.length === 0 ? (
        <div
          style={{
            backgroundColor: theme.background_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "24px",
            textAlign: "center",
            color: theme.text_muted
          }}
        >
          Плейбуки по выбранным фильтрам не найдены (Empty State). Сбросьте фильтр категории или тега.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 1fr) minmax(380px, 2fr)",
            gap: "20px"
          }}
        >
          {/* Каталог карточек плейбуков */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 600, margin: 0 }}>
              Каталог шаблонов ({vm.playbooks.length})
            </h3>
            {vm.playbooks.map((pb) => {
              const isSelected = activePb?.id === pb.id;
              return (
                <article
                  key={pb.id}
                  onClick={() => {
                    setSelectedSlug(pb.slug);
                    const nextVars: Record<string, string | number | boolean> = {};
                    for (const v of pb.variables) {
                      nextVars[v.key] = v.default_value;
                    }
                    setVarOverrides(nextVars);
                  }}
                  style={{
                    backgroundColor: theme.background_elevated,
                    border: `1px solid ${
                      isSelected ? theme.text_primary : theme.border_subtle
                    }`,
                    borderRadius: "8px",
                    padding: "14px",
                    cursor: "pointer"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px"
                    }}
                  >
                    <strong style={{ fontSize: "14px", color: theme.text_primary }}>
                      {pb.title}
                    </strong>
                    <span
                      style={{
                        fontSize: "11px",
                        color: theme.text_muted,
                        border: `1px solid ${theme.border_subtle}`,
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}
                    >
                      v{pb.current_version} · {VISIBILITY_LABELS_RU[pb.visibility]}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "12px",
                      color: theme.text_secondary,
                      margin: "0 0 8px 0"
                    }}
                  >
                    {pb.description}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      color: theme.text_muted
                    }}
                  >
                    <span>Категория: {pb.category}</span>
                    <span>
                      Задач: {pb.tasks.length} | Лимит: ${pb.default_budget_limit.toFixed(2)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Детальная карточка плейбука, форма переменных, предпросмотр и версионирование */}
          {activePb && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Заголовок выбранного плейбука */}
              <article
                style={{
                  backgroundColor: theme.background_elevated,
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "18px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "12px"
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
                      {activePb.title} (slug: {activePb.slug})
                    </h3>
                    <p
                      style={{
                        fontSize: "13px",
                        color: theme.text_secondary,
                        margin: "6px 0"
                      }}
                    >
                      {activePb.description}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "12px" }}>
                    <div>
                      Статус: <strong>{STATUS_LABELS_RU[activePb.status]}</strong>
                    </div>
                    <div style={{ color: theme.text_muted }}>
                      Текущая версия: v{activePb.current_version}
                    </div>
                  </div>
                </div>

                {activePb.status === "archived" && (
                  <div
                    role="alert"
                    style={{
                      marginTop: "12px",
                      padding: "10px 12px",
                      border: `1px solid ${theme.text_primary}`,
                      backgroundColor: theme.background_primary,
                      fontSize: "12px",
                      color: theme.text_primary
                    }}
                  >
                    Плейбук находится в архиве (Archived State) — создание новых миссий и редактирование черновика заблокированы.
                  </div>
                )}

                {Object.keys(vm.validation_errors).length > 0 && (
                  <div
                    role="alert"
                    style={{
                      marginTop: "12px",
                      padding: "10px 12px",
                      border: `1px solid ${theme.text_primary}`,
                      backgroundColor: theme.background_primary,
                      fontSize: "12px",
                      color: theme.text_primary
                    }}
                  >
                    <strong>Ошибка валидации переменных шаблона:</strong>
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                      {Object.entries(vm.validation_errors).map(([k, msg]) => (
                        <li key={k}>
                          <code>{k}</code>: {msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>

              {/* Форма ввода переменных плейбука */}
              <article
                style={{
                  backgroundColor: theme.background_elevated,
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "18px"
                }}
              >
                <h4 style={{ fontSize: "15px", fontWeight: 600, marginTop: 0 }}>
                  1. Параметры и переменные сценария ({activePb.variables.length})
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "12px"
                  }}
                >
                  {activePb.variables.map((v) => {
                    const currentVal = vm.variable_values[v.key];
                    return (
                      <div
                        key={v.key}
                        style={{
                          padding: "10px",
                          backgroundColor: theme.background_primary,
                          border: `1px solid ${theme.border_subtle}`,
                          borderRadius: "6px"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "12px",
                            marginBottom: "4px"
                          }}
                        >
                          <label htmlFor={`var_${v.key}`}>
                            <strong>{v.label}</strong>{" "}
                            <span style={{ color: theme.text_muted }}>
                              ({`{{${v.key}}}`} · {v.type}
                              {v.required ? " · обяз." : ""})
                            </span>
                          </label>
                          {v.secret && (
                            <span
                              style={{
                                fontSize: "10px",
                                padding: "1px 5px",
                                border: `1px solid ${theme.border_subtle}`,
                                color: theme.text_muted
                              }}
                            >
                              SECRET (скрыто в логах/экспорте)
                            </span>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: "11px",
                            color: theme.text_muted,
                            margin: "0 0 6px 0"
                          }}
                        >
                          {v.description}
                        </p>
                        {v.type === "boolean" ? (
                          <input
                            id={`var_${v.key}`}
                            type="checkbox"
                            checked={Boolean(currentVal)}
                            onChange={(e) =>
                              setVarOverrides({
                                ...vm.variable_values,
                                [v.key]: e.target.checked
                              })
                            }
                          />
                        ) : v.type === "select" ? (
                          <select
                            id={`var_${v.key}`}
                            value={String(currentVal ?? "")}
                            onChange={(e) =>
                              setVarOverrides({
                                ...vm.variable_values,
                                [v.key]: e.target.value
                              })
                            }
                            style={{
                              width: "100%",
                              backgroundColor: theme.background_elevated,
                              color: theme.text_primary,
                              border: `1px solid ${theme.border_subtle}`,
                              padding: "6px",
                              borderRadius: "4px",
                              fontSize: "12px"
                            }}
                          >
                            {(v.options ?? []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label} ({opt.value})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`var_${v.key}`}
                            type={
                              v.secret
                                ? "password"
                                : v.type === "number"
                                  ? "number"
                                  : "text"
                            }
                            value={String(currentVal ?? "")}
                            onChange={(e) =>
                              setVarOverrides({
                                ...vm.variable_values,
                                [v.key]:
                                  v.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value
                              })
                            }
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              backgroundColor: theme.background_elevated,
                              color: theme.text_primary,
                              border: `1px solid ${theme.border_subtle}`,
                              padding: "6px",
                              borderRadius: "4px",
                              fontSize: "12px"
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>

              {/* Предпросмотр будущей миссии (Live Preview: Included + Excluded + Budget) */}
              {preview && (
                <article
                  style={{
                    backgroundColor: theme.background_elevated,
                    border: `1px solid ${theme.border_subtle}`,
                    borderRadius: "8px",
                    padding: "18px"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px"
                    }}
                  >
                    <h4 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>
                      2. Предпросмотр будущей миссии (DAG задач и бюджет)
                    </h4>
                    <span
                      style={{
                        fontSize: "12px",
                        padding: "4px 8px",
                        border: `1px solid ${theme.border_subtle}`,
                        borderRadius: "4px",
                        color: preview.within_budget
                          ? theme.text_primary
                          : theme.text_muted
                      }}
                    >
                      Плановый бюджет: ${preview.planned_budget.toFixed(2)} / Лимит: $
                      {preview.mission_budget_limit.toFixed(2)} | Контрольных точек HITL:{" "}
                      {preview.requires_hitl_checkpoints}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: "10px",
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      marginBottom: "12px",
                      fontSize: "12px"
                    }}
                  >
                    <div>
                      <strong>Будущее название миссии:</strong>{" "}
                      {preview.resolved_mission_title}
                    </div>
                    <div style={{ color: theme.text_secondary, marginTop: "4px" }}>
                      <strong>Цель миссии:</strong> {preview.resolved_goal}
                    </div>
                  </div>

                  <h5
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      margin: "0 0 8px 0"
                    }}
                  >
                    Включённые задачи миссии ({preview.included_tasks.length}):
                  </h5>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "0 0 14px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px"
                    }}
                  >
                    {preview.included_tasks.map((task, idx) => (
                      <li
                        key={task.key}
                        style={{
                          padding: "10px",
                          backgroundColor: theme.background_primary,
                          border: `1px solid ${theme.border_subtle}`,
                          borderRadius: "6px",
                          fontSize: "12px"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontWeight: 600
                          }}
                        >
                          <span>
                            Этап {idx + 1}: {task.title} (<code>{task.key}</code>)
                          </span>
                          <span>
                            {ROLE_LABELS_RU[task.assigned_agent_role]} · $
                            {task.budget_limit.toFixed(2)}
                            {task.requires_owner_review
                              ? " · Ревью владельца (HITL)"
                              : ""}
                          </span>
                        </div>
                        <div
                          style={{
                            color: theme.text_secondary,
                            marginTop: "4px"
                          }}
                        >
                          {task.instruction}
                        </div>
                        <div
                          style={{
                            color: theme.text_muted,
                            fontSize: "11px",
                            marginTop: "4px"
                          }}
                        >
                          Зависимости:{" "}
                          {task.dependencies.length > 0
                            ? task.dependencies.join(", ")
                            : "нет (стартовая задача)"}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <h5
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      margin: "0 0 8px 0",
                      color: theme.text_secondary
                    }}
                  >
                    Исключённые по условиям задачи ({preview.excluded_tasks.length}):
                  </h5>
                  {preview.excluded_tasks.length === 0 ? (
                    <p
                      style={{
                        fontSize: "12px",
                        color: theme.text_muted,
                        margin: "0 0 14px 0"
                      }}
                    >
                      Все условные задачи активны при текущих значениях переменных.
                    </p>
                  ) : (
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "0 0 14px 0",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      {preview.excluded_tasks.map((ex) => (
                        <li
                          key={ex.key}
                          style={{
                            padding: "8px 10px",
                            backgroundColor: theme.background_primary,
                            border: `1px dashed ${theme.border_subtle}`,
                            borderRadius: "6px",
                            fontSize: "12px",
                            color: theme.text_muted
                          }}
                        >
                          <strong>{ex.key}</strong> ({ROLE_LABELS_RU[ex.assigned_agent_role]}):{" "}
                          {ex.reason} — экономия бюджета ${ex.budget_saved.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Кнопка создания миссии и переход в созданную миссию */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      paddingTop: "12px",
                      borderTop: `1px solid ${theme.border_subtle}`
                    }}
                  >
                    <button
                      type="button"
                      disabled={
                        activePb.status === "archived" || !preview.within_budget
                      }
                      onClick={() =>
                        setCreatedMissionId(
                          `msn_${activePb.slug.replace(/-/g, "_")}_v${activePb.current_version}`
                        )
                      }
                      style={{
                        backgroundColor: theme.text_primary,
                        color: theme.background_primary,
                        border: `1px solid ${theme.text_primary}`,
                        padding: "10px 18px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor:
                          activePb.status === "archived" || !preview.within_budget
                            ? "not-allowed"
                            : "pointer"
                      }}
                    >
                      Создать миссию
                    </button>

                    {vm.created_mission_link && (
                      <div style={{ fontSize: "12px" }}>
                        <span style={{ color: theme.text_muted, marginRight: "8px" }}>
                          Создана миссия <code>{vm.created_mission_link.mission_id}</code> (v
                          {vm.created_mission_link.playbook_version}):
                        </span>
                        <a
                          href={vm.created_mission_link.href}
                          style={{
                            color: theme.text_primary,
                            fontWeight: 600,
                            textDecoration: "underline"
                          }}
                        >
                          Перейти в созданную миссию в Mission Control →
                        </a>
                      </div>
                    )}
                  </div>
                </article>
              )}

              {/* История версий, SHA-256 и просмотр diff между версиями */}
              <article
                style={{
                  backgroundColor: theme.background_elevated,
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "18px"
                }}
              >
                <h4 style={{ fontSize: "15px", fontWeight: 600, marginTop: 0 }}>
                  3. История неизменяемых версий (SHA-256) и сравнение (Diff)
                </h4>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "0 0 12px 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px"
                  }}
                >
                  {activePb.versions.map((ver) => (
                    <li
                      key={ver.id}
                      style={{
                        padding: "10px",
                        backgroundColor: theme.background_primary,
                        border: `1px solid ${theme.border_subtle}`,
                        borderRadius: "6px",
                        fontSize: "12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px"
                      }}
                    >
                      <div>
                        <strong>Версия v{ver.version_number}</strong> —{" "}
                        {ver.changelog}
                        <div
                          style={{
                            color: theme.text_muted,
                            fontSize: "11px",
                            marginTop: "2px"
                          }}
                        >
                          SHA-256: <code>{ver.checksum_sha256.slice(0, 32)}...</code> | Статус:{" "}
                          {ver.is_published ? "Опубликована (Immutable)" : "Черновик"}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          border: `1px solid ${theme.border_subtle}`,
                          borderRadius: "4px",
                          color: theme.text_secondary
                        }}
                      >
                        Создать новую версию на основе v{ver.version_number}
                      </span>
                    </li>
                  ))}
                </ul>

                {vm.version_diff && (
                  <div
                    style={{
                      padding: "10px",
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      fontSize: "12px"
                    }}
                  >
                    <strong>Diff версий:</strong> {vm.version_diff.summary}
                    <div
                      style={{
                        color: theme.text_muted,
                        fontSize: "11px",
                        marginTop: "4px"
                      }}
                    >
                      Изменённые переменные:{" "}
                      {vm.version_diff.variable_changes
                        .map((c) => `${c.key} (${c.change})`)
                        .join(", ")}{" "}
                      | Изменённые задачи:{" "}
                      {vm.version_diff.task_changes
                        .map((c) => `${c.key} (${c.change})`)
                        .join(", ")}
                    </div>
                  </div>
                )}
              </article>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
