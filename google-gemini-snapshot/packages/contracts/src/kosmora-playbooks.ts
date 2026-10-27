/**
 * @cosmora/contracts — Kosmora Playbooks Domain Contracts
 * Covers Playbook, PlaybookVersion, PlaybookVariable, PlaybookTaskTemplate,
 * PlaybookInstantiation (PlaybookRun), PlaybookAuditEvent, Version Diff,
 * Live Mission Preview, and the 5 Built-in Kosmora Playbooks.
 */

import type {
  MissionAgentRole,
  MissionTaskExecutionMode
} from "./kosmora-mission-control.js";

export type PlaybookVisibility =
  | "private"
  | "project"
  | "organization"
  | "built_in";

export const PLAYBOOK_VISIBILITIES: readonly PlaybookVisibility[] = Object.freeze([
  "private",
  "project",
  "organization",
  "built_in"
]);

export type PlaybookStatus = "draft" | "active" | "archived";

export const PLAYBOOK_STATUSES: readonly PlaybookStatus[] = Object.freeze([
  "draft",
  "active",
  "archived"
]);

export type PlaybookVariableType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "url";

export const PLAYBOOK_VARIABLE_TYPES: readonly PlaybookVariableType[] =
  Object.freeze(["text", "textarea", "number", "select", "boolean", "url"]);

export type PlaybookTaskPriority = "low" | "medium" | "high" | "critical";

export type PlaybookTemplateExecutionMode =
  | "autonomous"
  | "require_review"
  | "require_clarification"
  | MissionTaskExecutionMode;

export interface PlaybookVariableValidationRules {
  readonly min?: number;
  readonly max?: number;
  readonly min_length?: number;
  readonly max_length?: number;
  readonly pattern?: string;
  readonly allowed_protocols?: readonly string[];
}

export interface PlaybookVariableOption {
  readonly value: string;
  readonly label: string;
}

export interface PlaybookVariable {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly type: PlaybookVariableType;
  readonly required: boolean;
  readonly default_value?: string | number | boolean | null;
  readonly validation_rules?: PlaybookVariableValidationRules;
  readonly secret: boolean;
  readonly options?: readonly PlaybookVariableOption[];
}

export interface PlaybookTaskTemplate {
  readonly key: string;
  readonly title_template: string;
  readonly instruction_template: string;
  readonly assigned_agent_role: MissionAgentRole;
  readonly execution_mode: "autonomous" | "require_review" | "require_clarification";
  readonly requested_tools: readonly string[];
  readonly priority: PlaybookTaskPriority;
  readonly dependencies: readonly string[];
  readonly budget_limit: number;
  readonly max_attempts: number;
  readonly condition_expression: string | null;
  readonly requires_owner_review: boolean;
}

export interface PlaybookDefinition {
  readonly mission_title_template: string;
  readonly goal_template: string;
  readonly context_template: string;
  readonly default_priority: PlaybookTaskPriority;
  readonly default_budget_limit: number;
  readonly variables: readonly PlaybookVariable[];
  readonly tasks: readonly PlaybookTaskTemplate[];
}

export interface Playbook {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string | null;
  readonly owner_id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly visibility: PlaybookVisibility;
  readonly status: PlaybookStatus;
  readonly current_version: number;
  readonly draft_definition: PlaybookDefinition;
  readonly draft_version_lock: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export interface PlaybookVersion {
  readonly id: string;
  readonly playbook_id: string;
  readonly version_number: number;
  readonly changelog: string;
  readonly definition_json: string;
  readonly definition: PlaybookDefinition;
  readonly created_by: string;
  readonly created_at: string;
  readonly checksum_sha256: string;
  readonly is_published: boolean;
}

export interface PlaybookInstantiation {
  readonly id: string;
  readonly playbook_id: string;
  readonly playbook_version_id: string;
  readonly resulting_mission_id: string;
  readonly owner_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly resolved_variables_json: string;
  readonly resolved_variables: Readonly<Record<string, string | number | boolean>>;
  readonly initiated_at: string;
  readonly created_at: string;
}

export type PlaybookRun = PlaybookInstantiation;

export type PlaybookAuditEventType =
  | "playbook.created"
  | "playbook.updated"
  | "playbook.version_published"
  | "playbook.version_cloned"
  | "playbook.instantiated"
  | "playbook.archived";

export interface PlaybookAuditEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string | null;
  readonly playbook_id: string;
  readonly playbook_version_id: string | null;
  readonly resulting_mission_id: string | null;
  readonly actor_id: string;
  readonly event_type: PlaybookAuditEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface PlaybookPreviewTaskNode {
  readonly key: string;
  readonly title: string;
  readonly instruction: string;
  readonly assigned_agent_role: MissionAgentRole;
  readonly execution_mode: "autonomous" | "require_review" | "require_clarification";
  readonly requested_tools: readonly string[];
  readonly priority: PlaybookTaskPriority;
  readonly dependencies: readonly string[];
  readonly budget_limit: number;
  readonly max_attempts: number;
  readonly requires_owner_review: boolean;
  readonly condition_expression: string | null;
}

export interface PlaybookPreviewExcludedTask {
  readonly key: string;
  readonly title_template: string;
  readonly assigned_agent_role: MissionAgentRole;
  readonly condition_expression: string;
  readonly reason: string;
  readonly budget_saved: number;
}

export interface PlaybookPreviewResult {
  readonly playbook_id: string;
  readonly playbook_slug: string;
  readonly playbook_title: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly checksum_sha256: string;
  readonly resolved_mission_title: string;
  readonly resolved_goal: string;
  readonly resolved_context: string;
  readonly sanitized_variables: Readonly<Record<string, string | number | boolean>>;
  readonly secret_keys: readonly string[];
  readonly included_tasks: readonly PlaybookPreviewTaskNode[];
  readonly excluded_tasks: readonly PlaybookPreviewExcludedTask[];
  readonly dag_edges: ReadonlyArray<{ from: string; to: string }>;
  readonly planned_budget: number;
  readonly mission_budget_limit: number;
  readonly within_budget: boolean;
  readonly requires_hitl_checkpoints: number;
}

export interface PlaybookVariableDiffEntry {
  readonly key: string;
  readonly change: "added" | "removed" | "modified";
  readonly before?: PlaybookVariable;
  readonly after?: PlaybookVariable;
  readonly changed_fields: readonly string[];
}

export interface PlaybookTaskDiffEntry {
  readonly key: string;
  readonly change: "added" | "removed" | "modified";
  readonly before?: PlaybookTaskTemplate;
  readonly after?: PlaybookTaskTemplate;
  readonly changed_fields: readonly string[];
}

export interface PlaybookDiffResult {
  readonly playbook_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly from_checksum_sha256: string;
  readonly to_checksum_sha256: string;
  readonly metadata_changes: ReadonlyArray<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
  readonly variable_changes: readonly PlaybookVariableDiffEntry[];
  readonly task_changes: readonly PlaybookTaskDiffEntry[];
  readonly total_changes: number;
  readonly summary: string;
}

export interface BuiltInPlaybookSeed {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly changelog: string;
  readonly definition: PlaybookDefinition;
}

/**
 * 5 Built-in Kosmora Playbooks available read-only across all tenants and projects.
 */
export const BUILT_IN_KOSMORA_PLAYBOOKS: readonly BuiltInPlaybookSeed[] =
  Object.freeze([
    {
      id: "pbk_builtin_market_research",
      slug: "market-research",
      title: "Исследование рынка",
      description:
        "Комплексное исследование целевого рынка: сбор первоисточников, сегментация конкурентов и рисков, подготовка аналитического меморандума и независимая проверка фактов.",
      category: "Исследования и аналитика",
      tags: ["рынок", "конкуренты", "аналитика", "источники"],
      changelog: "Базовая опубликованная версия шаблона исследования рынка (v1).",
      definition: {
        mission_title_template:
          "Исследование рынка {{market}} для проекта {{project_name}}",
        goal_template:
          "{{goal}} на рынке {{market}} (регион: {{country}}) к сроку {{deadline}}.",
        context_template:
          "Проект: {{project_name}}. Целевой рынок: {{market}}. Страна/регион: {{country}}. Дедлайн: {{deadline}}. Первичный источник: {{source_url}}.",
        default_priority: "high",
        default_budget_limit: 25.0,
        variables: [
          {
            key: "project_name",
            label: "Название проекта",
            description: "Внутреннее или продуктовое имя инициативы",
            type: "text",
            required: true,
            default_value: "EdTech Core",
            validation_rules: { min_length: 2, max_length: 120 },
            secret: false
          },
          {
            key: "goal",
            label: "Цель исследования",
            description: "Ключевой вопрос или гипотеза для проверки",
            type: "textarea",
            required: true,
            default_value: "Оценить ёмкость рынка, барьеры входа и топ-5 игроков",
            validation_rules: { min_length: 5, max_length: 1000 },
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
            validation_rules: { max_length: 100 },
            secret: false
          },
          {
            key: "deadline",
            label: "Контрольный срок",
            description: "Целевая дата готовности отчёта",
            type: "text",
            required: true,
            default_value: "2026-11-15",
            validation_rules: { min_length: 4, max_length: 40 },
            secret: false
          },
          {
            key: "budget",
            label: "Оценка бюджета исследования ($)",
            description: "Плановый лимит вычислительного бюджета сценария",
            type: "number",
            required: true,
            default_value: 22,
            validation_rules: { min: 4, max: 100 },
            secret: false
          },
          {
            key: "source_url",
            label: "Базовый отраслевой портал (URL)",
            description: "Ссылка на стартовый аналитический источник или датасет",
            type: "url",
            required: false,
            default_value: "https://example.com/market-reports",
            validation_rules: { allowed_protocols: ["https:", "http:"] },
            secret: false
          },
          {
            key: "api_access_token",
            label: "Секретный ключ внешнего дата-провайдера",
            description: "Опциональный токен доступа к закрытым витринам (скрыт в логах и экспорте)",
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
              "Собрать проверяемые первоисточники по проекту {{project_name}} для цели: {{goal}}. Базовый URL: {{source_url}}.",
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
              "Проанализировать регуляторные и локальные особенности рынка {{market}} в регионе {{country}} к сроку {{deadline}}.",
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
              "На основе собранных источников выделить объём рынка {{market}}, ключевых конкурентов и риски для {{project_name}}.",
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
              "Проверить отчёт по проекту {{project_name}} на точность цифр, цитирований и отсутствие логических противоречий.",
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
        ]
      }
    },
    {
      id: "pbk_builtin_presentation_prep",
      slug: "presentation-prep",
      title: "Подготовка презентации",
      description:
        "Конвейер создания инвестиционной или продуктовой презентации: сбор фактуры, расчёт метрик, структура слайдов, опциональное визуальное проектирование и финальное ревью.",
      category: "Коммуникации и питчи",
      tags: ["презентация", "слайды", "дизайн", "питч"],
      changelog: "Базовая опубликованная версия шаблона подготовки презентации (v1).",
      definition: {
        mission_title_template:
          "Подготовка презентации: {{project_name}} ({{market}})",
        goal_template:
          "Подготовить и верифицировать структуру презентации по цели: {{goal}} к {{deadline}}.",
        context_template:
          "Проект: {{project_name}}. Сегмент: {{market}}. Включить дизайн-схемы: {{include_design}}.",
        default_priority: "high",
        default_budget_limit: 24.0,
        variables: [
          {
            key: "project_name",
            label: "Название проекта",
            description: "Название продукта или компании для титульного слайда",
            type: "text",
            required: true,
            default_value: "Kosmora Sovereign Deck",
            validation_rules: { min_length: 2, max_length: 120 },
            secret: false
          },
          {
            key: "goal",
            label: "Ключевой тезис презентации",
            description: "Какое решение должна принять аудитория после просмотра",
            type: "textarea",
            required: true,
            default_value: "Защитить стратегию масштабирования на Q4",
            validation_rules: { min_length: 5, max_length: 800 },
            secret: false
          },
          {
            key: "market",
            label: "Целевой рынок",
            description: "Рыночный сегмент",
            type: "text",
            required: true,
            default_value: "Enterprise AI",
            validation_rules: { min_length: 2, max_length: 100 },
            secret: false
          },
          {
            key: "deadline",
            label: "Дата защиты",
            description: "Срок готовности колоды слайдов",
            type: "text",
            required: true,
            default_value: "2026-11-20",
            validation_rules: { min_length: 4, max_length: 40 },
            secret: false
          },
          {
            key: "include_design",
            label: "Включить проектирование визуальных схем (Designer)",
            description: "Если включено, добавляется задача агента Designer по подготовке диаграмм и сетки слайдов",
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
              "Собрать опорные факты и цитаты для презентации проекта {{project_name}} по цели: {{goal}}.",
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
              "Построить проверенные таблицы показателей для слайдов {{project_name}} на рынке {{market}}.",
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
              "Составить послайдовый план презентации {{project_name}} к {{deadline}} на базе метрик и исследования.",
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
            requested_tools: ["wireframe_spec_builder", "layout_grid_planner", "accessibility_checker"],
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
              "Проверить согласованность цифр и тезисов презентации {{project_name}} перед защитой {{deadline}}.",
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
        ]
      }
    },
    {
      id: "pbk_builtin_repository_audit",
      slug: "repository-audit",
      title: "Аудит репозитория",
      description:
        "Инженерный аудит кодовой базы: статический и архитектурный разбор модулей агентом Developer, проверка безопасности и политики качества агентом Reviewer с контрольной точкой владельца.",
      category: "Инженерия и безопасность",
      tags: ["код", "аудит", "безопасность", "репозиторий"],
      changelog: "Базовая опубликованная версия шаблона аудита репозитория (v1).",
      definition: {
        mission_title_template: "Технический аудит репозитория {{project_name}}",
        goal_template:
          "Провести инженерный аудит кодовой базы {{project_name}} ({{repo_url}}) с фокусом: {{goal}}.",
        context_template:
          "Репозиторий: {{repo_url}}. Ветка/ревизия: {{target_branch}}. Глубина анализа бюджета: {{budget}}$.",
        default_priority: "critical",
        default_budget_limit: 20.0,
        variables: [
          {
            key: "project_name",
            label: "Название сервиса / репозитория",
            description: "Имя проверяемого программного модуля",
            type: "text",
            required: true,
            default_value: "nexus-os-core",
            validation_rules: { min_length: 2, max_length: 100 },
            secret: false
          },
          {
            key: "repo_url",
            label: "URL репозитория",
            description: "HTTP/HTTPS ссылка на git-репозиторий или зеркало",
            type: "url",
            required: true,
            default_value: "https://github.com/kosmora/nexus-os",
            validation_rules: { allowed_protocols: ["https:", "http:"] },
            secret: false
          },
          {
            key: "target_branch",
            label: "Целевая ветка",
            description: "Ветка или тег для проверки",
            type: "text",
            required: true,
            default_value: "main",
            validation_rules: { min_length: 1, max_length: 80 },
            secret: false
          },
          {
            key: "goal",
            label: "Приоритеты аудита",
            description: "На что обратить особое внимание (изоляция, миграции, типизация)",
            type: "textarea",
            required: true,
            default_value: "Проверить отсутствие циклов зависимостей, строгость типов и безопасность SQL-запросов",
            validation_rules: { min_length: 5, max_length: 1000 },
            secret: false
          },
          {
            key: "budget",
            label: "Лимит бюджета аудита ($)",
            description: "При бюджете >= 15$ включается дополнительный прогон нагрузочных тестов",
            type: "number",
            required: true,
            default_value: 16,
            validation_rules: { min: 8, max: 60 },
            secret: false
          }
        ],
        tasks: [
          {
            key: "code_static_analysis",
            title_template: "AST-навигация и проверка архитектуры {{project_name}}",
            instruction_template:
              "Выполнить разбор ветки {{target_branch}} репозитория {{repo_url}} по цели: {{goal}}.",
            assigned_agent_role: "developer",
            execution_mode: "autonomous",
            requested_tools: ["ast_inspector", "sandbox_code_runner", "schema_validator"],
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
              "Запустить расширенный набор интеграционных проверок для {{project_name}} на ветке {{target_branch}}.",
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
              "Проверить отчёт разработчика по {{project_name}} на соответствие политикам безопасности и передать на утверждение владельцу.",
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
        ]
      }
    },
    {
      id: "pbk_builtin_document_package",
      slug: "document-package-analysis",
      title: "Разбор пакета документов",
      description:
        "Последовательный разбор юридического, тендерного или нормативного пакета документов: извлечение фактов, сверка обязательств и рисков, сводный меморандум и ревью.",
      category: "Документооборот и комплаенс",
      tags: ["документы", "договоры", "риски", "комплаенс"],
      changelog: "Базовая опубликованная версия шаблона разбора пакета документов (v1).",
      definition: {
        mission_title_template: "Разбор пакета документов: {{project_name}}",
        goal_template:
          "Извлечь ключевые условия, риски и расхождения из пакета документов по проекту {{project_name}}: {{goal}}.",
        context_template:
          "Проект: {{project_name}}. Тип пакета: {{package_type}}. Срок проверки: {{deadline}}.",
        default_priority: "high",
        default_budget_limit: 22.0,
        variables: [
          {
            key: "project_name",
            label: "Наименование сделки или проекта",
            description: "Идентификатор пакета документов",
            type: "text",
            required: true,
            default_value: "Enterprise SLA 2026",
            validation_rules: { min_length: 2, max_length: 120 },
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
            description: "Какие риски или условия требуют особого контроля",
            type: "textarea",
            required: true,
            default_value: "Выявить штрафные санкции, односторонние отказы и несоответствия SLA",
            validation_rules: { min_length: 5, max_length: 1000 },
            secret: false
          },
          {
            key: "deadline",
            label: "Срок заключения",
            description: "Крайняя дата подготовки заключения",
            type: "text",
            required: true,
            default_value: "2026-11-10",
            validation_rules: { min_length: 4, max_length: 40 },
            secret: false
          }
        ],
        tasks: [
          {
            key: "parse_documents",
            title_template: "Парсинг и индексация пакета ({{package_type}})",
            instruction_template:
              "Извлечь структуру, ключевые пункты и цитаты из пакета документов {{project_name}}.",
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
              "Сопоставить финансовые и операционные риски в пакете {{project_name}} по цели: {{goal}}.",
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
              "Сверить каждую ссылку на пункт документа в заключении по {{project_name}} и передать владельцу на ревью.",
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
        ]
      }
    },
    {
      id: "pbk_builtin_client_project_launch",
      slug: "client-project-launch",
      title: "Запуск клиентского проекта",
      description:
        "Операционный плейбук старта клиентского проекта: декомпозиция требований и рисков (Analyst), подготовка устава и плана коммуникаций (Writer), настройка регламентов и бюджетов (Operator) с финальным подтверждением владельца.",
      category: "Операции и управление проектами",
      tags: ["запуск", "клиент", "операции", "регламент"],
      changelog: "Базовая опубликованная версия шаблона запуска клиентского проекта (v1).",
      definition: {
        mission_title_template: "Запуск клиентского проекта: {{project_name}}",
        goal_template:
          "Подготовить полный операционный пакет запуска проекта {{project_name}} (цель: {{goal}}) к {{deadline}}.",
        context_template:
          "Проект: {{project_name}}. Рынок/индустрия клиента: {{market}}. Регион: {{country}}. Целевой срок запуска: {{deadline}}.",
        default_priority: "high",
        default_budget_limit: 20.0,
        variables: [
          {
            key: "project_name",
            label: "Название клиентского проекта",
            description: "Код или наименование запускаемого проекта",
            type: "text",
            required: true,
            default_value: "Vega Enterprise Rollout",
            validation_rules: { min_length: 2, max_length: 120 },
            secret: false
          },
          {
            key: "goal",
            label: "Целевой результат запуска",
            description: "Критерии успешного старта первой фазы",
            type: "textarea",
            required: true,
            default_value: "Утвердить устав проекта, матрицу ответственности RACI и бюджетный контур",
            validation_rules: { min_length: 5, max_length: 1000 },
            secret: false
          },
          {
            key: "market",
            label: "Индустрия клиента",
            description: "Отраслевой профиль заказчика",
            type: "text",
            required: true,
            default_value: "FinTech",
            validation_rules: { min_length: 2, max_length: 100 },
            secret: false
          },
          {
            key: "country",
            label: "Юрисдикция запуска",
            description: "Страна или регион развёртывания",
            type: "text",
            required: true,
            default_value: "Казахстан",
            validation_rules: { min_length: 2, max_length: 100 },
            secret: false
          },
          {
            key: "deadline",
            label: "Дата kick-off встречи",
            description: "Целевая дата готовности пакета запуска",
            type: "text",
            required: true,
            default_value: "2026-11-05",
            validation_rules: { min_length: 4, max_length: 40 },
            secret: false
          }
        ],
        tasks: [
          {
            key: "scope_and_budget_baseline",
            title_template: "Расчёт ресурсного плана и рисков ({{project_name}})",
            instruction_template:
              "Сформировать ресурсную модель и реестр стартовых рисков для проекта {{project_name}} в сегменте {{market}} ({{country}}).",
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
              "Проверить комплектность пакета запуска {{project_name}}, лимиты бюджета и передать на финальное утверждение владельцу.",
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
        ]
      }
    }
  ]);
