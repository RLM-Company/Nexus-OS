/**
 * Kosmora 160-Feature Master Architecture Registry & Runtime Dispatcher
 * Self-contained within packages/core/src/ to satisfy TypeScript rootDir constraints.
 */

import { verifyStage_stage1_autonomy } from "./stage1-autonomy/index.js";
import { verifyStage_stage2_canvas } from "./stage2-canvas/index.js";
import { verifyStage_stage4_intelligence_graph } from "./stage4-intelligence-graph/index.js";

export type {
  StageKernelExecutionInput,
  StageKernelExecutionResult
} from "./stage1-autonomy/index.js";
export * from "./stage1-autonomy/index.js";
export * from "./stage2-canvas/index.js";
export * from "./stage4-intelligence-graph/index.js";

export interface KosmoraFeatureDescriptor {
  readonly featureId: string;
  readonly stage:
    | "stage1-autonomy"
    | "stage2-canvas"
    | "stage3-skills-bus"
    | "stage4-intelligence-graph"
    | "stage5-enterprise";
  readonly title: string;
  readonly description: string;
  readonly operationCode: string;
  readonly packageDir: string;
  readonly domainFields: readonly string[];
}

export const KOSMORA_160_CATALOG: readonly KosmoraFeatureDescriptor[] = [
  {
    featureId: "F001",
    stage: "stage1-autonomy",
    title: "Инициализация протокола Kosmora",
    description: "Единый стандарт обмена сообщениями и состояниями между оркестратором и воркерами",
    operationCode: "protocol_handshake",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["protocol_version", "sender_role", "recipient_role", "correlation_id"]
  },
  {
    featureId: "F002",
    stage: "stage1-autonomy",
    title: "DAG-планировщик (Task Graph Engine)",
    description: "Декомпозиция сложных промптов в направленный ациклический граф подзадач",
    operationCode: "dag_scheduler",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["graph_id", "root_task_id", "topological_order", "acyclic_verified"]
  },
  {
    featureId: "F003",
    stage: "stage1-autonomy",
    title: "Связывание рантайм-артефактов с графом задач",
    description:
      "Жёсткая привязка каждого сгенерированного файла или блока кода к конкретному узлу задачи",
    operationCode: "artifact_binding",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["artifact_id", "task_id", "graph_id", "producer_role"]
  },
  {
    featureId: "F004",
    stage: "stage1-autonomy",
    title: "Граф происхождения артефактов (Artifact Provenance Graph)",
    description: "Отслеживание полной цепочки: кто создал, на основе каких данных и каким промптом",
    operationCode: "provenance_lineage",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["artifact_id", "prompt_hash", "source_artifact_ids", "model_route_id"]
  },
  {
    featureId: "F005",
    stage: "stage1-autonomy",
    title: "Валидатор графа происхождения в рантайме",
    description:
      "Автоматическая проверка целостности ссылок provenance перед закрытием задачи менеджером",
    operationCode: "provenance_validator",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["graph_id", "checked_nodes", "integrity_passed", "missing_links"]
  },
  {
    featureId: "F006",
    stage: "stage1-autonomy",
    title: "Институт Агента-Критика (Critic Agent)",
    description:
      "Выделенный проверяющий контур для ревью кода, текста и таблиц до показа пользователю",
    operationCode: "critic_review",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["review_id", "target_artifact_id", "rubric_scores", "blocking_issues"]
  },
  {
    featureId: "F007",
    stage: "stage1-autonomy",
    title: "Привязка вердиктов Критика к артефактам (Critic Verdict Binding)",
    description:
      "Сохранение статуса (Approved / Needs Revision + комментарии) прямо в метаданных артефакта",
    operationCode: "verdict_binding",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["verdict_id", "artifact_id", "verdict_status", "reviewer_comments"]
  },
  {
    featureId: "F008",
    stage: "stage1-autonomy",
    title: "Настраиваемые уровни автономии (L1–L5)",
    description:
      "Ползунок контроля от «спрашивать каждый шаг» до «полный автопилот с отчётом по итогу»",
    operationCode: "autonomy_slider",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["tier_level", "cosmora_policy_code", "require_step_confirmation", "allow_fanout"]
  },
  {
    featureId: "F009",
    stage: "stage1-autonomy",
    title: "Роутер моделей (Dynamic LLM Routing)",
    description:
      "Распределение простых задач на быстрые модели и сложных архитектурных узлов на флагманские модели",
    operationCode: "llm_router",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["route_id", "selected_model", "complexity_tier", "estimated_cost_usd"]
  },
  {
    featureId: "F010",
    stage: "stage1-autonomy",
    title: "Детектор зацикливания агентов",
    description:
      "Принудительное прерывание бесконечных споров между Исполнителем и Критиком после N итераций",
    operationCode: "loop_breaker",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["task_id", "iteration_count", "max_iterations", "loop_terminated"]
  },
  {
    featureId: "F011",
    stage: "stage1-autonomy",
    title: "Снимки состояния выполнения (Checkpointing)",
    description: "Сохранение стейта графа на каждом узле для возобновления с места сбоя",
    operationCode: "state_checkpoint",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["checkpoint_id", "graph_id", "step_index", "serialized_state_hash"]
  },
  {
    featureId: "F012",
    stage: "stage1-autonomy",
    title: "Откат ветки рассуждений (State Rollback)",
    description:
      "Возможность вернуться на 2–3 шага назад в графе задач и пойти по альтернативной ветке",
    operationCode: "branch_rollback",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["graph_id", "target_checkpoint_id", "steps_reverted", "alternate_branch_id"]
  },
  {
    featureId: "F013",
    stage: "stage1-autonomy",
    title: "Параллельное исполнение суб-агентов (Fan-out / Fan-in)",
    description:
      "Одновременный запуск независимых веток графа с последующей агрегацией результатов",
    operationCode: "fanout_aggregator",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["parallel_group_id", "worker_count", "completed_branches", "merged_output"]
  },
  {
    featureId: "F014",
    stage: "stage1-autonomy",
    title: "Приоритизация очереди задач",
    description:
      "Динамическое перестроение весов в очереди при поступлении срочного сообщения от пользователя",
    operationCode: "priority_scheduler",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["queue_id", "urgent_task_id", "previous_weight", "new_priority_weight"]
  },
  {
    featureId: "F015",
    stage: "stage1-autonomy",
    title: "Контракты ввода-вывода (Strict JSON Schema IO)",
    description: "Валидация типизированных ответов между агентами через схемы данных",
    operationCode: "schema_validator",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["schema_id", "payload_valid", "validated_fields_count", "violation_errors"]
  },
  {
    featureId: "F016",
    stage: "stage1-autonomy",
    title: "Самоисправление синтаксиса (Self-Healing Retry)",
    description:
      "Автоматический перезапрос при битом JSON или ошибке компиляции без участия человека",
    operationCode: "self_healing_retry",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["attempt_number", "syntax_repaired", "extracted_json", "diagnostic_delta"]
  },
  {
    featureId: "F017",
    stage: "stage1-autonomy",
    title: "Таймауты и Watchdog-таймеры воркеров",
    description: "Перезапуск зависших агентных процессов при превышении порога ожидания",
    operationCode: "watchdog_monitor",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["worker_id", "elapsed_ms", "timeout_limit_ms", "restart_triggered"]
  },
  {
    featureId: "F018",
    stage: "stage1-autonomy",
    title: "Оценка уверенности ответа (Confidence Scoring)",
    description: "Расчёт метрики достоверности результата перед передачей Менеджеру",
    operationCode: "confidence_estimator",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["task_id", "confidence_score", "evidence_density", "meets_threshold"]
  },
  {
    featureId: "F019",
    stage: "stage1-autonomy",
    title: "Точки перехвата человеком (Human-in-the-Loop Breakpoints)",
    description:
      "Пауза выполнения графа перед критическими действиями (удаление, пуш в прод, внешняя отправка)",
    operationCode: "hitl_gate",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["breakpoint_id", "critical_action", "paused_state", "owner_signature"]
  },
  {
    featureId: "F020",
    stage: "stage1-autonomy",
    title: "Горячая замена промптов ролей",
    description: "Обновление системных инструкций агентов без перезапуска рантайма",
    operationCode: "prompt_hotswap",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["role_name", "previous_version", "active_version", "zero_downtime_applied"]
  },
  {
    featureId: "F021",
    stage: "stage1-autonomy",
    title: "Локальная шина событий агентов (Event Bus)",
    description: "Реактивный обмен сигналами между модулями через Pub/Sub",
    operationCode: "pubsub_bus",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["topic_name", "subscriber_count", "published_event_id", "delivery_latency_ms"]
  },
  {
    featureId: "F022",
    stage: "stage1-autonomy",
    title: "Разрешение конфликтов слияния результатов",
    description:
      "Арбитраж Менеджером противоречивых выводов от двух параллельных исследовательских агентов",
    operationCode: "conflict_arbiter",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["conflict_id", "winning_agent_id", "arbitration_score", "resolution_rationale"]
  },
  {
    featureId: "F023",
    stage: "stage1-autonomy",
    title: "Бюджетирование токенов на задачу",
    description: "Жёсткий лимит стоимости одного запуска графа с защитой от перерасхода",
    operationCode: "token_budget_guard",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["graph_id", "allocated_tokens", "consumed_tokens", "budget_remaining"]
  },
  {
    featureId: "F024",
    stage: "stage1-autonomy",
    title: "Дедупликация вызовов инструментов",
    description: "Кэширование идентичных запросов агентов в рамках одной сессии",
    operationCode: "tool_dedup_cache",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["session_id", "call_fingerprint", "cache_hit", "saved_execution_ms"]
  },
  {
    featureId: "F025",
    stage: "stage1-autonomy",
    title: "Стриминг промежуточных мыслей (Thought Streaming)",
    description: "Трансляция лога рассуждений и шагов графа в UI в реальном времени",
    operationCode: "thought_streamer",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["stream_id", "task_id", "chunk_sequence", "formatted_thought"]
  },
  {
    featureId: "F026",
    stage: "stage1-autonomy",
    title: "Шаблоны мультиагентных команд (Squad Presets)",
    description:
      "Преднастроенные связки агентов (Аналитик + Кодер + QA, Ресерчер + Копирайтер + Дизайнер)",
    operationCode: "squad_template",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["preset_id", "squad_name", "roster_roles", "default_strictness"]
  },
  {
    featureId: "F027",
    stage: "stage1-autonomy",
    title: "Генерация пост-мортем отчётов при сбое",
    description: "Автоматический разбор причины падения цепочки задач",
    operationCode: "postmortem_analyzer",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["report_id", "failed_node_id", "root_cause", "recovery_recommendation"]
  },
  {
    featureId: "F028",
    stage: "stage1-autonomy",
    title: "Передача контекста между агентами без потерь (Context Handoff)",
    description: "Сжатие истории с сохранением ключевых фактов при передаче эстафеты",
    operationCode: "context_handoff",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["handoff_id", "from_role", "to_role", "preserved_facts_digest"]
  },
  {
    featureId: "F029",
    stage: "stage1-autonomy",
    title: "Режим «Адвокат дьявола»",
    description:
      "Принудительный запуск агента-оппонента для поиска слабых мест в бизнес-плане или архитектуре",
    operationCode: "redteam_challenger",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: [
      "challenge_id",
      "target_artifact_id",
      "vulnerabilities_found",
      "counter_arguments"
    ]
  },
  {
    featureId: "F030",
    stage: "stage1-autonomy",
    title: "Калибровка строгости Критика",
    description: "Настройка порога пропуска артефактов (черновик / продакшен-грейд)",
    operationCode: "strictness_calibrator",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["calibration_mode", "min_pass_score", "allow_warnings", "gate_decision"]
  },
  {
    featureId: "F031",
    stage: "stage1-autonomy",
    title: "Реестр активных воркеров (Agent Registry)",
    description: "Мониторинг живых процессов, их загрузки и текущих задач в реальном времени",
    operationCode: "worker_registry",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["instance_id", "assigned_role", "cpu_load_pct", "heartbeat_healthy"]
  },
  {
    featureId: "F032",
    stage: "stage1-autonomy",
    title: "Трассировка латентности узлов (Node Latency Profiler)",
    description: "Замер времени выполнения каждого шага графа для поиска узких мест",
    operationCode: "latency_profiler",
    packageDir: "packages/core/src/stage1-autonomy",
    domainFields: ["graph_id", "bottleneck_node_id", "p95_latency_ms", "total_graph_ms"]
  },
  {
    featureId: "F033",
    stage: "stage2-canvas",
    title: "Двухпанельный интерфейс Kosmora Canvas",
    description: "Синхронная работа чата управления слева и интерактивного рабочего полотна справа",
    operationCode: "dual_pane_sync",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: [
      "workspace_id",
      "chat_pane_width_pct",
      "canvas_pane_width_pct",
      "sync_cursor_active"
    ]
  },
  {
    featureId: "F034",
    stage: "stage2-canvas",
    title: "Версионируемые отчёты (Versioned Canvas Reports)",
    description: "Система контроля версий (v1, v2, v3) для каждого документа на холсте",
    operationCode: "report_versioning",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "version_tag", "parent_version", "immutable_content_hash"]
  },
  {
    featureId: "F035",
    stage: "stage2-canvas",
    title: "Прямая связь анализа файлов с отчётами (File Analysis-to-Report Binding)",
    description:
      "Живые ссылки из выводов в отчёте на конкретные строки/ячейки исходного загруженного файла",
    operationCode: "cell_citation_binding",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["binding_id", "source_file_id", "sheet_cell_coord", "bound_report_paragraph"]
  },
  {
    featureId: "F036",
    stage: "stage2-canvas",
    title: "Визуальный Diff версий артефакта",
    description:
      "Построчное сравнение изменений между редакциями отчёта или кода (зелёный/красный подсвет)",
    operationCode: "visual_diff_engine",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["from_version", "to_version", "added_lines_count", "removed_lines_count"]
  },
  {
    featureId: "F037",
    stage: "stage2-canvas",
    title: "Интерактивный редактор презентаций (Presentation Editor)",
    description:
      "По-слайдовое создание, редактирование сетки, тезисов и заметок спикера прямо на Canvas",
    operationCode: "slide_deck_editor",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["deck_id", "slide_count", "grid_layout", "speaker_notes_attached"]
  },
  {
    featureId: "F038",
    stage: "stage2-canvas",
    title: "Генератор XLSX-таблиц с формулами",
    description:
      "Сборка полноценных многостраничных таблиц с рабочими формулами, стилями и выгрузкой в .xlsx",
    operationCode: "xlsx_formula_builder",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["workbook_id", "sheet_names", "active_formulas_count", "recalculated_totals"]
  },
  {
    featureId: "F039",
    stage: "stage2-canvas",
    title: "Пакетная выгрузка для десктопа (Desktop / Archive Download)",
    description:
      "Скачивание всего проекта, кода или пачки отчётов единым структурированным архивом",
    operationCode: "archive_bundler",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["archive_id", "bundled_files_count", "compression_ratio", "checksum_sha256"]
  },
  {
    featureId: "F040",
    stage: "stage2-canvas",
    title: "Уточняющие контролы холста (Refined Canvas Controls)",
    description:
      "Быстрые кнопки над выделенным фрагментом: Сжать, Академический стиль, Проверить факты, В таблицу",
    operationCode: "floating_toolbar_action",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["selection_id", "control_action", "original_length", "transformed_output"]
  },
  {
    featureId: "F041",
    stage: "stage2-canvas",
    title: "Частичная регенерация блока (In-place Selection Edit)",
    description:
      "Переписывание агентом только выделенного абзаца или функции без пересборки всего файла",
    operationCode: "partial_block_edit",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "start_line", "end_line", "patched_document"]
  },
  {
    featureId: "F042",
    stage: "stage2-canvas",
    title: "Рендеринг архитектурных диаграмм (Mermaid / D2 / Flow)",
    description: "Интерактивная отрисовка блок-схем и графов с зумом и экспортом в SVG/PNG",
    operationCode: "diagram_renderer",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["diagram_id", "dsl_engine", "nodes_rendered", "svg_payload"]
  },
  {
    featureId: "F043",
    stage: "stage2-canvas",
    title: "Песочница предпросмотра UI-компонентов",
    description: "Живой рендер HTML/Tailwind/React-артефактов прямо внутри вкладки Canvas",
    operationCode: "ui_sandbox_preview",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["component_id", "framework_mode", "isolated_iframe_csp", "hydrated_ok"]
  },
  {
    featureId: "F044",
    stage: "stage2-canvas",
    title: "Встраивание интерактивных графиков (Chart Widgets)",
    description:
      "Генерация динамических дашбордов (линейные, бар-чарты, воронки) по данным из отчёта",
    operationCode: "chart_widget_engine",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["widget_id", "chart_type", "series_count", "interactive_tooltips"]
  },
  {
    featureId: "F045",
    stage: "stage2-canvas",
    title: "Множественные вкладки артефактов (Multi-Tab Canvas)",
    description:
      "Одновременное удержание открытыми кода, презентации и аналитической записки в одной сессии",
    operationCode: "multitab_controller",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["workspace_id", "open_tab_ids", "active_tab_id", "pinned_tab_ids"]
  },
  {
    featureId: "F046",
    stage: "stage2-canvas",
    title: "Разделение экрана внутри Canvas (Split-View)",
    description: "Сопоставление исходного документа и сгенерированного отчёта бок о бок",
    operationCode: "split_view_comparer",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["left_tab_id", "right_tab_id", "synchronized_scroll", "viewport_ratio"]
  },
  {
    featureId: "F047",
    stage: "stage2-canvas",
    title: "Инлайн-комментарии и ревью-треды",
    description:
      "Закрепление замечаний пользователя или Агента-Критика за конкретной строкой артефакта",
    operationCode: "inline_comment_thread",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["thread_id", "line_number", "author_role", "resolved_state"]
  },
  {
    featureId: "F048",
    stage: "stage2-canvas",
    title: "Бейдж статуса проверки на артефакте",
    description:
      "Визуальный индикатор в шапке Canvas: проверено Критиком, есть замечания или редактируется вручную",
    operationCode: "verification_badge_ui",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "badge_state", "critic_score", "badge_color_token"]
  },
  {
    featureId: "F049",
    stage: "stage2-canvas",
    title: "Инспектор цепочки происхождения (Provenance Inspector UI)",
    description:
      "Боковая панель, показывающая, из каких чанков документов и задач родился текущий артефакт",
    operationCode: "provenance_drawer",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "upstream_tasks", "source_chunks", "lineage_depth"]
  },
  {
    featureId: "F050",
    stage: "stage2-canvas",
    title: "Двусторонняя синхронизация правок",
    description:
      "Учёт ручных исправлений пользователя на Canvas в памяти агента при следующих сообщениях в чате",
    operationCode: "bidirectional_edit_sync",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "user_diff_patch", "agent_memory_updated", "sync_version"]
  },
  {
    featureId: "F051",
    stage: "stage2-canvas",
    title: "Экспорт отчётов в PDF с корпоративной вёрсткой",
    description: "Компиляция документов с титульным листом, оглавлением и кастомным брендингом",
    operationCode: "corporate_pdf_compiler",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["document_id", "cover_page_included", "toc_generated", "page_count"]
  },
  {
    featureId: "F052",
    stage: "stage2-canvas",
    title: "Экспорт и синхронизация с Markdown / Notion",
    description:
      "Копирование или пуш готовых структурированных материалов с сохранением форматирования",
    operationCode: "markdown_notion_bridge",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "notion_blocks_count", "gfm_markdown", "formatting_preserved"]
  },
  {
    featureId: "F053",
    stage: "stage2-canvas",
    title: "Оглавление и быстрая навигация по длинным отчётам",
    description: "Плавающее дерево заголовков (H1–H4) для документов свыше 10 страниц",
    operationCode: "floating_toc_tree",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["document_id", "headings_extracted", "max_depth", "active_anchor_slug"]
  },
  {
    featureId: "F054",
    stage: "stage2-canvas",
    title: "Блокировка секций от перезаписи (Section Locking)",
    description:
      "Заморозка утверждённых абзацев, чтобы агент не менял их при глобальном рефакторинге",
    operationCode: "section_lock_guard",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "locked_section_ids", "write_attempt_blocked", "owner_lock_token"]
  },
  {
    featureId: "F055",
    stage: "stage2-canvas",
    title: "Сквозные переменные в документах",
    description:
      "Динамические плейсхолдеры, которые обновляются во всём тексте при смене цифры в таблице",
    operationCode: "reactive_variable_binder",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["variable_key", "updated_value", "bound_locations_updated", "interpolated_text"]
  },
  {
    featureId: "F056",
    stage: "stage2-canvas",
    title: "Библиотека шаблонов артефактов",
    description: "Готовые каркасы для питч-деков, ТЗ, финансовых моделей и дизайн-доков",
    operationCode: "template_catalog",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["template_id", "category", "sections_scaffold", "default_variables"]
  },
  {
    featureId: "F057",
    stage: "stage2-canvas",
    title: "Темная/высококонтрастная тема презентаций",
    description:
      "Пресеты оформления слайдов в фирменной тёмной минималистичной эстетике с холодными акцентами",
    operationCode: "slide_theme_engine",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["theme_id", "background_hex", "accent_ice_hex", "wcag_contrast_ratio"]
  },
  {
    featureId: "F058",
    stage: "stage2-canvas",
    title: "Автоматическая проверка битых ссылок и сносок",
    description: "Валидация всех цитат и источников внутри сгенерированного отчёта",
    operationCode: "citation_link_checker",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "total_links_checked", "broken_urls", "all_citations_valid"]
  },
  {
    featureId: "F059",
    stage: "stage2-canvas",
    title: "Режим чтения и презентации (Full-screen Present Mode)",
    description: "Разворачивание слайдов на весь экран с поддержкой горячих клавиш",
    operationCode: "present_mode_controller",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["deck_id", "current_slide_index", "hotkeys_enabled", "fullscreen_active"]
  },
  {
    featureId: "F060",
    stage: "stage2-canvas",
    title: "Конвертер таблиц в слайды в один клик",
    description:
      "Автоматическая выжимка ключевых трендов из большого XLSX-файла в 3–5 наглядных слайдов",
    operationCode: "table_to_slides_converter",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: [
      "source_sheet_id",
      "generated_slides_count",
      "key_trends_extracted",
      "slides_payload"
    ]
  },
  {
    featureId: "F061",
    stage: "stage2-canvas",
    title: "Аудио-озвучка отчёта (TTS Summary)",
    description: "Генерация краткого голосового брифинга по длинному аналитическому документу",
    operationCode: "tts_briefing_generator",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "estimated_seconds", "ssml_script", "voice_profile"]
  },
  {
    featureId: "F062",
    stage: "stage2-canvas",
    title: "Журнал аудита изменений холста",
    description: "Таймлайн того, какой агент или пользователь внёс правку и в какую секунду",
    operationCode: "canvas_audit_timeline",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["artifact_id", "audit_entries_count", "last_actor_id", "chronological_events"]
  },
  {
    featureId: "F063",
    stage: "stage2-canvas",
    title: "Восстановление удалённых вкладок (Canvas Trash Bin)",
    description: "Корзина артефактов сессии с возможностью мгновенного возврата",
    operationCode: "trash_bin_recovery",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["workspace_id", "restored_tab_id", "preserved_versions_count", "restore_status"]
  },
  {
    featureId: "F064",
    stage: "stage2-canvas",
    title: "Сшивка нескольких артефактов в мастер-документ",
    description: "Объединение разрозненных заметок, таблиц и графиков в единый финальный релиз",
    operationCode: "master_doc_stitcher",
    packageDir: "packages/core/src/stage2-canvas",
    domainFields: ["master_artifact_id", "source_tab_ids", "unified_toc", "compiled_markdown"]
  },
  {
    featureId: "F065",
    stage: "stage3-skills-bus",
    title: "Вызов модульных Skills прямо в чате (/skill или @skill)",
    description: "Быстрое подключение специализированных навыков в активный диалог",
    operationCode: "chat_skill_parser",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["invoked_handle", "parsed_arguments", "clean_user_prompt", "skill_bound"]
  },
  {
    featureId: "F066",
    stage: "stage3-skills-bus",
    title: "Магазин и реестр внутренних скиллов (Skills Registry)",
    description:
      "Каталог доступных навыков с описанием входных параметров, версий и требуемых прав",
    operationCode: "skills_catalog_registry",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["skill_id", "version", "required_scopes", "registered_count"]
  },
  {
    featureId: "F067",
    stage: "stage3-skills-bus",
    title: "Конструктор кастомных Skills",
    description: "Упаковка успешного промпт-пайплайна и набора скриптов в переиспользуемый скилл",
    operationCode: "skill_packager",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["custom_skill_id", "pipeline_steps", "manifest_valid", "packaged_bundle"]
  },
  {
    featureId: "F068",
    stage: "stage3-skills-bus",
    title: "Горячая подгрузка контекста скилла (Lazy Skill Expansion)",
    description: "Подтягивание тяжёлых инструкций скилла только в момент его реального вызова",
    operationCode: "lazy_skill_loader",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: [
      "skill_handle",
      "loaded_on_demand",
      "tokens_saved_while_idle",
      "expanded_instructions"
    ]
  },
  {
    featureId: "F069",
    stage: "stage3-skills-bus",
    title: "Двусторонняя интеграция с GitHub Issues",
    description:
      "Чтение бэклога, создание новых ишью из планов на Canvas и авто-закрытие по коммиту",
    operationCode: "github_issues_bridge",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["repo_name", "issue_number", "sync_state", "linked_artifact_id"]
  },
  {
    featureId: "F070",
    stage: "stage3-skills-bus",
    title: "Агентное создание веток и Pull Request в GitHub",
    description:
      "Формирование PR с описанием изменений, привязанными артефактами и тегами ревьюеров",
    operationCode: "github_pr_automator",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["repo_name", "head_branch", "base_branch", "pr_body_markdown"]
  },
  {
    featureId: "F071",
    stage: "stage3-skills-bus",
    title: "Автоматический парсинг логов упавших CI/CD пайплайнов",
    description: "Чтение ошибок GitHub Actions и генерация патча для починки сборки",
    operationCode: "ci_log_diagnostics",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["workflow_run_id", "error_code", "failing_file", "auto_patch_diff"]
  },
  {
    featureId: "F072",
    stage: "stage3-skills-bus",
    title: "Глубокий парсер документов (PDF, DOCX, CSV, XLSX)",
    description:
      "Извлечение текста, сложных многоуровневых таблиц и структуры заголовков без потери разметки",
    operationCode: "deep_document_extractor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["file_name", "detected_format", "tables_extracted", "structured_markdown"]
  },
  {
    featureId: "F073",
    stage: "stage3-skills-bus",
    title: "Интеграция с библиотекой документов проекта",
    description: "Прямое монтирование папок хранилища в зону видимости агентов",
    operationCode: "storage_folder_mounter",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["mount_id", "folder_path", "indexed_files_count", "read_only_guard"]
  },
  {
    featureId: "F074",
    stage: "stage3-skills-bus",
    title: "Исполнение Python-скриптов в контролируемой среде",
    description: "Запуск расчётов, pandas-аналитики и построения графиков в изолированном рантайме",
    operationCode: "python_sandbox_executor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["execution_id", "script_hash", "exit_code", "captured_stdout"]
  },
  {
    featureId: "F075",
    stage: "stage3-skills-bus",
    title: "Исполнение Node.js / TypeScript-инструментов",
    description:
      "Выполнение серверных скриптов, парсеров и проверка сборки прямо из рабочей сессии",
    operationCode: "node_ts_executor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["execution_id", "ts_module_name", "typecheck_passed", "execution_output"]
  },
  {
    featureId: "F076",
    stage: "stage3-skills-bus",
    title: "Шлюз Telegram-ассистента",
    description:
      "Управление задачами Nexus-OS, получение уведомлений и аппрув чекпоинтов через Telegram",
    operationCode: "telegram_bot_bridge",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["chat_id", "notification_kind", "inline_approval_callback", "delivered_ok"]
  },
  {
    featureId: "F077",
    stage: "stage3-skills-bus",
    title: "Веб-поиск и скрапинг с очисткой до Markdown",
    description: "Сбор актуальной информации из сети с удалением рекламного шума и навигации",
    operationCode: "clean_web_extractor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["source_url", "noise_stripped_pct", "clean_markdown", "extracted_links"]
  },
  {
    featureId: "F078",
    stage: "stage3-skills-bus",
    title: "Генератор и исполнитель SQL-запросов (Text-to-SQL)",
    description: "Безопасное чтение подключённых баз данных с проверкой схемы перед запросом",
    operationCode: "text_to_sql_guard",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["natural_query", "generated_sql", "schema_validated", "read_only_enforced"]
  },
  {
    featureId: "F079",
    stage: "stage3-skills-bus",
    title: "Песочница исходящих Webhook и REST API вызовов",
    description: "Подключение внешних сервисов по OpenAPI/Swagger-спецификации",
    operationCode: "openapi_rest_caller",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["operation_id", "endpoint_url", "http_method", "response_status"]
  },
  {
    featureId: "F080",
    stage: "stage3-skills-bus",
    title: "OCR-модуль для сканов и скриншотов",
    description: "Распознавание текста и таблиц с изображений и фотографий документов",
    operationCode: "ocr_vision_extractor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["image_id", "recognized_text", "confidence_pct", "detected_table_cells"]
  },
  {
    featureId: "F081",
    stage: "stage3-skills-bus",
    title: "Анализатор кодовой базы (AST Codebase Navigation)",
    description:
      "Поиск определений функций, классов и зависимостей по дереву синтаксиса репозитория",
    operationCode: "ast_symbol_indexer",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["file_path", "exported_symbols", "import_dependencies", "ast_depth"]
  },
  {
    featureId: "F082",
    stage: "stage3-skills-bus",
    title: "Автоматический генератор юнит-тестов",
    description: "Написание и прогон тестов под новый функционал до отправки в ветку",
    operationCode: "unit_test_synthesizer",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["target_module", "generated_assertions_count", "suite_code", "all_green"]
  },
  {
    featureId: "F083",
    stage: "stage3-skills-bus",
    title: "Инспектор зависимостей и уязвимостей пакетов",
    description: "Проверка package.json / requirements.txt на конфликты версий и CVE",
    operationCode: "dep_security_scanner",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["manifest_type", "scanned_packages_count", "unpinned_warnings", "audit_clean"]
  },
  {
    featureId: "F084",
    stage: "stage3-skills-bus",
    title: "Пакетная обработка файлов (Batch File Processor)",
    description:
      "Применение одного скилла сразу к 10–50 загруженным документам с агрегацией в таблицу",
    operationCode: "batch_doc_processor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["batch_id", "processed_files_count", "skill_handle", "aggregated_rows"]
  },
  {
    featureId: "F085",
    stage: "stage3-skills-bus",
    title: "Транскрибация аудио и записей созвонов",
    description:
      "Перевод голосовых заметок и митингов в текст с выделением списка задач (Action Items)",
    operationCode: "meeting_action_extractor",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["recording_id", "transcript_length", "action_items", "assigned_owners"]
  },
  {
    featureId: "F086",
    stage: "stage3-skills-bus",
    title: "Синхронизация с календарём и дедлайнами",
    description: "Привязка этапов выполнения агентных задач к реальному расписанию проекта",
    operationCode: "calendar_milestone_sync",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["project_id", "milestone_id", "deadline_iso", "schedule_aligned"]
  },
  {
    featureId: "F087",
    stage: "stage3-skills-bus",
    title: "Умный буфер обмена и сниппеты",
    description: "Быстрое сохранение удачных фрагментов кода и таблиц в боковую панель",
    operationCode: "snippet_vault_clipboard",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["snippet_id", "title", "language_tag", "reusable_content"]
  },
  {
    featureId: "F088",
    stage: "stage3-skills-bus",
    title: "Валидатор исходящих ссылок и API-ключей",
    description: "Проверка доступности эндпоинтов перед запуском длинной цепочки",
    operationCode: "preflight_endpoint_checker",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["endpoint_id", "key_format_valid", "reachable", "preflight_latency_ms"]
  },
  {
    featureId: "F089",
    stage: "stage3-skills-bus",
    title: "Локальный файловый наблюдатель (File Watcher)",
    description:
      "Автоматический подхват изменённых файлов в рабочей директории без ручной перезагрузки",
    operationCode: "fs_change_watcher",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["watched_dir", "changed_file_path", "change_event_kind", "reindexed_ok"]
  },
  {
    featureId: "F090",
    stage: "stage3-skills-bus",
    title: "Конвертер форматов данных на лету",
    description: "Мгновенный перевод JSON <-> CSV <-> XLSX <-> Markdown Table <-> SQL Insert",
    operationCode: "data_format_transformer",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["source_format", "target_format", "records_converted", "serialized_output"]
  },
  {
    featureId: "F091",
    stage: "stage3-skills-bus",
    title: "Симулятор сухого прогона (Dry-Run Mode)",
    description:
      "Показ того, какие файлы будут изменены или какие API вызваны, без фактической записи",
    operationCode: "dry_run_simulator",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["simulation_id", "planned_file_writes", "planned_api_calls", "zero_side_effects"]
  },
  {
    featureId: "F092",
    stage: "stage3-skills-bus",
    title: "Привязка учётных записей с разделением скоупов (Account Connectors)",
    description: "Безопасное хранение токенов GitHub, облачных дисков и мессенджеров",
    operationCode: "scoped_connector_vault",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["connector_id", "provider_name", "granted_scopes", "least_privilege_ok"]
  },
  {
    featureId: "F093",
    stage: "stage3-skills-bus",
    title: "Авто-документирование API и модулей",
    description: "Генерация актуальных README и JSDoc/Docstring по изменённым файлам",
    operationCode: "autodoc_generator",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["module_path", "documented_exports", "generated_jsdoc", "readme_section"]
  },
  {
    featureId: "F094",
    stage: "stage3-skills-bus",
    title: "Сравнение нескольких документов (Multi-Doc Diff & Matrix)",
    description: "Составление сравнительной матрицы по 5–10 договорам или спецификациям",
    operationCode: "multidoc_matrix_builder",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["matrix_id", "compared_docs_count", "criteria_columns", "discrepancies_found"]
  },
  {
    featureId: "F095",
    stage: "stage3-skills-bus",
    title: "Цепочки скиллов (Skill Chaining)",
    description: "Автоматическая передача выхода одного скилла на вход другому",
    operationCode: "skill_pipeline_chainer",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["chain_id", "ordered_skill_handles", "intermediate_artifacts", "final_payload"]
  },
  {
    featureId: "F096",
    stage: "stage3-skills-bus",
    title: "Телеметрия успешности вызовов инструментов",
    description: "Статистика отказов и времени отклика по каждому внешнему коннектору",
    operationCode: "tool_metrics_collector",
    packageDir: "packages/tool-runtime/src/stage3-skills-bus",
    domainFields: ["connector_id", "success_rate_pct", "avg_latency_ms", "total_invocations"]
  },
  {
    featureId: "F097",
    stage: "stage4-intelligence-graph",
    title: "Графовые воркспейсы Kosmora (Kosmora Graph Workspaces)",
    description:
      "Визуальное пространство проекта, где чаты, файлы, задачи и артефакты представлены как связанные узлы",
    operationCode: "graph_workspace_topology",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "nodes_count", "edges_count", "connected_components"]
  },
  {
    featureId: "F098",
    stage: "stage4-intelligence-graph",
    title: "Слои графа знаний (Intelligence Graph Layers)",
    description: "Разделение графа на слои: документов, задач, кодовых модулей и бизнес-сущностей",
    operationCode: "multilayer_graph_partition",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "document_nodes", "task_nodes", "code_and_entity_nodes"]
  },
  {
    featureId: "F099",
    stage: "stage4-intelligence-graph",
    title: "Автоматическое извлечение сущностей и связей (Entity & Relation Extraction)",
    description: "Пополнение графа при загрузке любого нового файла или завершении диалога",
    operationCode: "ner_relation_miner",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["source_id", "extracted_entities", "extracted_relations", "graph_updated"]
  },
  {
    featureId: "F100",
    stage: "stage4-intelligence-graph",
    title: "Гибридный поиск (Vector + Graph + Keyword RAG)",
    description:
      "Комбинирование семантического поиска по эмбеддингам с обходом графа связей и точным совпадением слов",
    operationCode: "hybrid_rag_retriever",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["query_text", "vector_matches", "graph_hop_matches", "fused_ranking"]
  },
  {
    featureId: "F101",
    stage: "stage4-intelligence-graph",
    title: "Инжектор графового контекста в промпт (Graph Context Injector)",
    description:
      "Автоматическое подтягивание релевантных узлов графа в системный промпт при старте новой ветки чата",
    operationCode: "prompt_graph_injector",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "workspace_id",
      "injected_nodes_count",
      "augmented_system_prompt",
      "token_overhead"
    ]
  },
  {
    featureId: "F102",
    stage: "stage4-intelligence-graph",
    title: "Интерактивный 2D/3D-навигатор по графу знаний",
    description: "Визуальный осмотр связей проекта с фильтрацией по типам узлов, датам и тегам",
    operationCode: "graph_viewport_serializer",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["view_mode", "visible_nodes", "visible_edges", "camera_coordinates"]
  },
  {
    featureId: "F103",
    stage: "stage4-intelligence-graph",
    title: "Краткосрочная память рабочей сессии (Working Memory Buffer)",
    description:
      "Удержание фокуса на текущих переменных и открытых артефактах без размытия внимания",
    operationCode: "working_memory_ring",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["session_id", "active_slots_used", "focused_artifact_ids", "attention_score"]
  },
  {
    featureId: "F104",
    stage: "stage4-intelligence-graph",
    title: "Долгосрочная эпизодическая память воркспейса",
    description: "Сохранение ключевых архитектурных решений и выводов прошлых недель",
    operationCode: "episodic_decision_store",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "episode_id", "architectural_decision", "retention_priority"]
  },
  {
    featureId: "F105",
    stage: "stage4-intelligence-graph",
    title: "Разрешение дубликатов сущностей (Entity Resolution)",
    description:
      "Склейка разных упоминаний одного и того же проекта, человека или модуля в единый узел графа",
    operationCode: "entity_canonical_merger",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "canonical_node_id",
      "merged_aliases",
      "duplicate_nodes_collapsed",
      "similarity_score"
    ]
  },
  {
    featureId: "F106",
    stage: "stage4-intelligence-graph",
    title: "Временная шкала графа знаний (Temporal Graph Tracking)",
    description:
      "Просмотр того, как менялись знания и факты по проекту во времени с поддержкой дат актуальности",
    operationCode: "bitemporal_fact_ledger",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["node_id", "valid_from_iso", "valid_to_iso", "point_in_time_snapshot"]
  },
  {
    featureId: "F107",
    stage: "stage4-intelligence-graph",
    title: "Закрепление ядерных фактов (Pinned Context Nodes)",
    description:
      "Фиксация неизменяемых правил проекта (стек, брендбук, ограничения), всегда присутствующих в контексте",
    operationCode: "pinned_fact_registry",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "pinned_node_ids", "immutable_rules", "always_injected"]
  },
  {
    featureId: "F108",
    stage: "stage4-intelligence-graph",
    title: "Автоматическая суммаризация старых веток диалога",
    description: "Фоновое сжатие длинных чатов в структурированные конспекты узлов памяти",
    operationCode: "dialogue_compactor",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["thread_id", "original_messages_count", "compressed_digest", "compression_ratio"]
  },
  {
    featureId: "F109",
    stage: "stage4-intelligence-graph",
    title: "Семантическое чанкование документов с сохранением иерархии",
    description: "Нарезка файлов по смысловым блокам и главам, а не по слепому лимиту символов",
    operationCode: "semantic_tree_chunker",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["document_id", "chunks_created", "heading_breadcrumb_paths", "avg_chunk_tokens"]
  },
  {
    featureId: "F110",
    stage: "stage4-intelligence-graph",
    title: "Кросс-документное связывание цитат",
    description:
      "Обнаружение общих тем и противоречий между десятками разных PDF и таблиц в воркспейсе",
    operationCode: "cross_doc_correlator",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["cluster_id", "corroborating_docs", "contradicting_pairs", "consensus_summary"]
  },
  {
    featureId: "F111",
    stage: "stage4-intelligence-graph",
    title: "Переранжирование результатов поиска (Cross-Encoder Reranking)",
    description: "Отсев нерелевантных чанков перед подачей в контекстное окно модели",
    operationCode: "cross_encoder_reranker",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["query_id", "initial_candidates", "reranked_top_k", "precision_gain"]
  },
  {
    featureId: "F112",
    stage: "stage4-intelligence-graph",
    title: "Оценка устаревания данных (Knowledge Decay Alert)",
    description:
      "Маркировка узлов и отчётов, чьи исходные файлы были обновлены, как требующих пересборки",
    operationCode: "staleness_detector",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["updated_source_id", "stale_artifact_ids", "decay_severity", "rebuild_queued"]
  },
  {
    featureId: "F113",
    stage: "stage4-intelligence-graph",
    title: "Изоляция памяти между воркспейсами",
    description: "Строгий запрет на протекание данных одного клиентского проекта в граф другого",
    operationCode: "workspace_isolation_fence",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "source_workspace_id",
      "target_workspace_id",
      "cross_leak_blocked",
      "isolation_verified"
    ]
  },
  {
    featureId: "F114",
    stage: "stage4-intelligence-graph",
    title: "Глобальный мост знаний (Cross-Workspace Shared Library)",
    description:
      "Опциональное подключение общих корпоративных справочников и стандартов ко всем проектам",
    operationCode: "shared_library_bridge",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["library_id", "subscribed_workspaces", "shared_nodes_count", "read_only_mount"]
  },
  {
    featureId: "F115",
    stage: "stage4-intelligence-graph",
    title: "Инспектор контекстного окна (Context Window X-Ray)",
    description:
      "Наглядная шкала того, сколько токенов занимают системный промпт, граф, файлы и история чата",
    operationCode: "context_xray_telemetry",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["max_tokens", "used_tokens", "utilization_pct", "segment_breakdown"]
  },
  {
    featureId: "F116",
    stage: "stage4-intelligence-graph",
    title: "Умная обрезка контекста (Smart Context Pruning)",
    description: "Вытеснение наименее релевантных кусков истории при приближении к лимиту токенов",
    operationCode: "relevance_context_pruner",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "budget_limit_tokens",
      "evicted_chunks_count",
      "retained_high_value_ids",
      "freed_tokens"
    ]
  },
  {
    featureId: "F117",
    stage: "stage4-intelligence-graph",
    title: "Импорт и экспорт подграфов знаний (JSON-LD / GraphML)",
    description: "Перенос накопленной базы знаний проекта между инстансами",
    operationCode: "subgraph_serializer",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "export_format", "serialized_nodes", "portable_payload"]
  },
  {
    featureId: "F118",
    stage: "stage4-intelligence-graph",
    title: "Тегирование и пользовательские метаданные узлов",
    description: "Ручная и автоматическая разметка документов и артефактов статусами",
    operationCode: "node_metadata_tagger",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["node_id", "applied_tags", "custom_attributes", "indexed_for_filter"]
  },
  {
    featureId: "F119",
    stage: "stage4-intelligence-graph",
    title: "Поиск «белых пятен» в графе (Gap Analysis)",
    description:
      "Выявление задач или разделов отчёта, не подкреплённых ни одним исходным документом",
    operationCode: "evidence_gap_finder",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["workspace_id", "unbacked_task_ids", "orphan_claims_count", "remediation_plan"]
  },
  {
    featureId: "F120",
    stage: "stage4-intelligence-graph",
    title: "Генерация онтологии под домен",
    description:
      "Настройка типов узлов и связей под конкретную нишу (разработка ПО, автосервис, маркетинг, аналитика)",
    operationCode: "ontology_schema_builder",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["domain_niche", "entity_types", "relation_types", "validation_rules"]
  },
  {
    featureId: "F121",
    stage: "stage4-intelligence-graph",
    title: "Запросы к графу на естественном языке",
    description: "Перевод вопроса пользователя в обход узлов графа для точных ответов по связям",
    operationCode: "nl_graph_traversal",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["natural_question", "cypher_like_plan", "traversed_path", "synthesized_answer"]
  },
  {
    featureId: "F122",
    stage: "stage4-intelligence-graph",
    title: "Кэширование эмбеддингов с инкрементальным обновлением",
    description: "Пересчёт векторов только для изменённых абзацев при редактировании файла",
    operationCode: "delta_embedding_cache",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "document_id",
      "unchanged_paragraphs_cached",
      "recomputed_paragraphs",
      "compute_saved_pct"
    ]
  },
  {
    featureId: "F123",
    stage: "stage4-intelligence-graph",
    title: "Персональный профиль предпочтений внутри воркспейса",
    description: "Запоминание любимого формата таблиц, стиля кода и лаконичности ответов",
    operationCode: "preference_memory_profile",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "workspace_id",
      "preferred_table_style",
      "preferred_code_idiom",
      "verbosity_level"
    ]
  },
  {
    featureId: "F124",
    stage: "stage4-intelligence-graph",
    title: "Ветвление чатов от любого сообщения (Conversation Forking)",
    description: "Создание параллельной ветки обсуждения без потери исходного дерева диалога",
    operationCode: "chat_branch_forker",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["parent_thread_id", "fork_message_id", "new_branch_id", "inherited_context_hash"]
  },
  {
    featureId: "F125",
    stage: "stage4-intelligence-graph",
    title: "Слияние выводов из параллельных веток чата",
    description: "Перенос финального артефакта из экспериментальной ветки обратно в основную",
    operationCode: "chat_branch_merger",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: [
      "source_branch_id",
      "target_branch_id",
      "promoted_artifact_id",
      "merge_commit_id"
    ]
  },
  {
    featureId: "F126",
    stage: "stage4-intelligence-graph",
    title: "Индексация коммитов и PR в граф знаний",
    description: "Автоматическое добавление истории разработки из GitHub в общий граф проекта",
    operationCode: "git_history_graph_indexer",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["repo_name", "indexed_commits", "linked_task_nodes", "graph_edges_added"]
  },
  {
    featureId: "F127",
    stage: "stage4-intelligence-graph",
    title: "Быстрый глобальный поиск (Cmd/Ctrl + K)",
    description:
      "Мгновенный переход к любому чату, узлу графа, скиллу или версии артефакта на Canvas",
    operationCode: "cmdk_omnibox_router",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["query_string", "matched_categories", "top_hit_id", "search_latency_ms"]
  },
  {
    featureId: "F128",
    stage: "stage4-intelligence-graph",
    title: "Анализ влияния изменений (Impact Analysis on Graph)",
    description:
      "Подсветка всех отчётов и задач, которые затронет изменение конкретного входного документа",
    operationCode: "blast_radius_analyzer",
    packageDir: "packages/core/src/stage4-intelligence-graph",
    domainFields: ["modified_node_id", "affected_downstream_ids", "max_hop_distance", "risk_level"]
  },
  {
    featureId: "F129",
    stage: "stage5-enterprise",
    title: "Мультитенантная архитектура («Цифровая холдинговая компания»)",
    description:
      "Управление независимыми организациями, департаментами и проектами из единого мастер-аккаунта",
    operationCode: "holding_hierarchy_manager",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "holding_id",
      "subsidiary_tenant_ids",
      "consolidated_governance",
      "isolation_mode"
    ]
  },
  {
    featureId: "F130",
    stage: "stage5-enterprise",
    title: "Строгая изоляция данных на уровне БД (Row-Level Security)",
    description: "Аппаратно-логическое разделение данных разных арендаторов (Tenants)",
    operationCode: "rls_tenant_guard",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["requesting_tenant_id", "row_tenant_id", "access_granted", "policy_enforcement"]
  },
  {
    featureId: "F131",
    stage: "stage5-enterprise",
    title: "Ролевая модель доступа (RBAC)",
    description:
      "Гранулярные права: Owner, Admin, Architect, Operator, Viewer на уровне воркспейсов и артефактов",
    operationCode: "rbac_permission_evaluator",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["actor_role", "requested_capability", "resource_scope", "verdict_allowed"]
  },
  {
    featureId: "F132",
    stage: "stage5-enterprise",
    title: "Изолированные песочницы выполнения кода (Sandboxed Node/Python Containers)",
    description: "Запуск агентских скриптов без доступа к хост-системе и чужим сетям",
    operationCode: "container_sandbox_policy",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["container_id", "runtime_image", "network_egress_blocked", "seccomp_profile"]
  },
  {
    featureId: "F133",
    stage: "stage5-enterprise",
    title: "Детектор и маскировщик персональных данных (PII Redaction)",
    description:
      "Автоматическое скрытие телефонов, паспортов и ключей перед отправкой во внешние LLM API",
    operationCode: "pii_data_masker",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "input_length",
      "redacted_entities_count",
      "sanitized_payload",
      "compliance_passed"
    ]
  },
  {
    featureId: "F134",
    stage: "stage5-enterprise",
    title: "Защита от Prompt Injection и Jailbreak",
    description:
      "Входной фильтр, блокирующий попытки переопределить системные инструкции через файлы или веб",
    operationCode: "injection_shield_filter",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "source_channel",
      "threat_signature_detected",
      "blocked_execution",
      "sanitized_input"
    ]
  },
  {
    featureId: "F135",
    stage: "stage5-enterprise",
    title: "Хранилище секретов и ключей (Encrypted Vault)",
    description: "Шифрование пользовательских API-ключей и токенов интеграций (AES-256)",
    operationCode: "aes256_gcm_vault",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "secret_id",
      "cipher_algorithm",
      "key_rotation_version",
      "authenticated_tag_valid"
    ]
  },
  {
    featureId: "F136",
    stage: "stage5-enterprise",
    title: "Политики разрешённых инструментов (Tool Allowlisting)",
    description: "Ограничение списка скиллов и внешних доменов для конкретных агентов и ролей",
    operationCode: "tool_allowlist_enforcer",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["agent_role", "requested_tool_id", "allowlist_matched", "enforcement_action"]
  },
  {
    featureId: "F137",
    stage: "stage5-enterprise",
    title: "Неизменяемый лог безопасности (Immutable Audit Trail)",
    description: "Запись всех входов, вызовов инструментов, экспорта данных и изменений прав",
    operationCode: "hash_chained_audit_ledger",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "sequence_number",
      "previous_entry_hash",
      "current_entry_hash",
      "chain_tamper_free"
    ]
  },
  {
    featureId: "F138",
    stage: "stage5-enterprise",
    title: "Биллинг и учёт расхода токенов по тенантам",
    description: "Детальная разбивка стоимости запросов по проектам, пользователям и моделям",
    operationCode: "tenant_usage_metering",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["tenant_id", "prompt_tokens", "completion_tokens", "accrued_cost_usd"]
  },
  {
    featureId: "F139",
    stage: "stage5-enterprise",
    title: "Квоты и Rate Limiting",
    description:
      "Ограничение числа одновременных агентных графов и запросов в минуту на организацию",
    operationCode: "token_bucket_ratelimiter",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["tenant_id", "requests_per_minute", "concurrent_graphs", "throttled"]
  },
  {
    featureId: "F140",
    stage: "stage5-enterprise",
    title: "Поддержка собственных ключей и локальных моделей (BYOK & Local LLM)",
    description:
      "Возможность подключить корпоративные эндпоинты или локальные модели для закрытого контура",
    operationCode: "byok_endpoint_router",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["tenant_id", "custom_endpoint_url", "airgapped_mode", "handshake_verified"]
  },
  {
    featureId: "F141",
    stage: "stage5-enterprise",
    title: "Сквозная трассировка мультиагентных прогонов (OpenTelemetry Tracing)",
    description: "Визуализация полного пути запроса через все микросервисы и воркеры",
    operationCode: "otel_span_exporter",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["trace_id", "span_id", "parent_span_id", "service_hop_timings"]
  },
  {
    featureId: "F142",
    stage: "stage5-enterprise",
    title: "Панель здоровья CI/CD и авто-диагностика билдов",
    description:
      "Мониторинг сборок монорепозитория с быстрым выявлением падающих тестов типизации и интеграций",
    operationCode: "monorepo_health_probe",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["pipeline_id", "packages_checked", "typecheck_green", "test_suite_green"]
  },
  {
    featureId: "F143",
    stage: "stage5-enterprise",
    title: "Сьют технических бенчмарков для Kosmora (Benchmark Suite)",
    description:
      "Автоматизированный прогон эталонных задач для замера точности, скорости и стоимости после коммита",
    operationCode: "benchmark_harness",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["suite_version", "scenarios_executed", "accuracy_score_pct", "cost_per_run_usd"]
  },
  {
    featureId: "F144",
    stage: "stage5-enterprise",
    title: "Регрессионное тестирование промптов и скиллов",
    description:
      "Проверка того, что обновление системного промпта не ухудшило качество старых сценариев",
    operationCode: "prompt_regression_gate",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["baseline_version", "candidate_version", "drift_detected", "regression_passed"]
  },
  {
    featureId: "F145",
    stage: "stage5-enterprise",
    title: "Менеджер миграций схемы БД и графа",
    description: "Безопасное накатывание обновлений структуры базы с поддержкой отката без простоя",
    operationCode: "schema_migration_runner",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["migration_version", "direction", "tables_migrated", "rollback_ready"]
  },
  {
    featureId: "F146",
    stage: "stage5-enterprise",
    title: "Горизонтальное автомасштабирование воркеров очереди",
    description: "Динамическое поднятие новых инстансов обработчиков при пиковой нагрузке",
    operationCode: "queue_horizon_scaler",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["queue_depth", "current_replicas", "target_replicas", "scale_event_triggered"]
  },
  {
    featureId: "F147",
    stage: "stage5-enterprise",
    title: "Очередь недоставленных задач (Dead-Letter Queue)",
    description: "Сохранение упавших фоновых джобов для повторного запуска после устранения сбоя",
    operationCode: "dlq_replay_manager",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["dlq_job_id", "failure_reason", "retry_count", "requeued_successfully"]
  },
  {
    featureId: "F148",
    stage: "stage5-enterprise",
    title: "Вебхуки событий платформы для внешних систем",
    description:
      "Отправка уведомлений в корпоративные шины при готовности отчёта или падении графа",
    operationCode: "webhook_dispatcher",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["webhook_id", "event_topic", "hmac_signature", "delivery_http_status"]
  },
  {
    featureId: "F149",
    stage: "stage5-enterprise",
    title: "Публичное REST / GraphQL API платформы",
    description:
      "Возможность запускать задачи Kosmora и забирать готовые артефакты из внешних B2B-систем",
    operationCode: "b2b_api_gateway",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["api_key_id", "graphql_or_rest_op", "rate_limit_remaining", "response_envelope"]
  },
  {
    featureId: "F150",
    stage: "stage5-enterprise",
    title: "Безопасный шаринг артефактов по внешним ссылкам",
    description:
      "Генерация read-only ссылок на отчёты и презентации с паролем и сроком жизни (TTL)",
    operationCode: "secure_share_link_issuer",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["share_token", "artifact_id", "expires_at_iso", "password_protected"]
  },
  {
    featureId: "F151",
    stage: "stage5-enterprise",
    title: "White-Label кастомизация воркспейсов",
    description: "Настройка логотипа, цветовой палитры и домена для клиентских витрин",
    operationCode: "whitelabel_theme_registry",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["tenant_id", "custom_domain", "brand_palette", "custom_logo_svg"]
  },
  {
    featureId: "F152",
    stage: "stage5-enterprise",
    title: "Автоматическое резервное копирование и снапшоты",
    description:
      "Ежедневный бэкап графов знаний, чатов и версий Canvas с восстановлением в один клик",
    operationCode: "snapshot_backup_engine",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["snapshot_id", "included_graphs", "included_canvas_tabs", "one_click_restorable"]
  },
  {
    featureId: "F153",
    stage: "stage5-enterprise",
    title: "Политики хранения и автоочистки данных (Data Retention)",
    description: "Автоматическое архивирование или удаление временных логов по расписанию",
    operationCode: "retention_policy_sweeper",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["policy_id", "max_age_days", "purged_records_count", "archived_records_count"]
  },
  {
    featureId: "F154",
    stage: "stage5-enterprise",
    title: "Единый вход и корпоративная авторизация (SSO / OAuth2 / JWT)",
    description: "Бесшовный вход через провайдеров идентификации с двухфакторной защитой",
    operationCode: "sso_jwt_verifier",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["idp_provider", "subject_claim", "mfa_verified", "session_token_issued"]
  },
  {
    featureId: "F155",
    stage: "stage5-enterprise",
    title: "Сетевой прокси с белым списком доменов (Egress Proxy)",
    description: "Контроль всех исходящих сетевых обращений из агентской среды",
    operationCode: "egress_domain_firewall",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["destination_host", "tenant_allowlist", "egress_permitted", "audit_logged"]
  },
  {
    featureId: "F156",
    stage: "stage5-enterprise",
    title: "Кэширование идентичных LLM-запросов (Semantic Cache)",
    description:
      "Мгновенный возврат ответа на типовые аналитические подзапросы без повторной оплаты токенов",
    operationCode: "semantic_vector_cache",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["query_fingerprint", "similarity_hit", "tokens_saved", "cached_completion"]
  },
  {
    featureId: "F157",
    stage: "stage5-enterprise",
    title: "Graceful Degradation (Отказоустойчивый фоллбэк)",
    description:
      "Автоматическое переключение на резервного провайдера модели при падении основного API",
    operationCode: "provider_failover_switch",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "primary_provider",
      "backup_provider",
      "failover_activated",
      "continuity_preserved"
    ]
  },
  {
    featureId: "F158",
    stage: "stage5-enterprise",
    title: "Шаблоны быстрого онбординга воркспейсов",
    description:
      "Развёртывание преднастроенного пространства с демо-графом, скиллами и примерами на Canvas за 30 секунд",
    operationCode: "instant_onboarding_seeder",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: ["template_name", "seeded_nodes_count", "seeded_skills_count", "elapsed_ms"]
  },
  {
    featureId: "F159",
    stage: "stage5-enterprise",
    title: "Мониторинг квот хранилища и индексации",
    description:
      "Контроль объёма загруженных файлов, таблиц и векторных индексов по каждому проекту",
    operationCode: "storage_quota_meter",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "project_id",
      "used_megabytes",
      "quota_limit_megabytes",
      "alert_threshold_reached"
    ]
  },
  {
    featureId: "F160",
    stage: "stage5-enterprise",
    title: "Экспорт полного дампа проекта (Full Tenant Portability)",
    description:
      "Выгрузка всех артефактов, истории чатов, графа знаний и скиллов в самодостаточный архив",
    operationCode: "tenant_portability_dumper",
    packageDir: "packages/policy-engine/src/stage5-enterprise",
    domainFields: [
      "export_bundle_id",
      "tenant_id",
      "manifest_integrity_hash",
      "self_contained_ready"
    ]
  }
];

export function verifyCoreStages96Modules(): Array<{
  featureId: string;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
}> {
  return [
    ...verifyStage_stage1_autonomy(),
    ...verifyStage_stage2_canvas(),
    ...verifyStage_stage4_intelligence_graph()
  ];
}
