/** Gemini PR390 descriptors: names are proposals, not proof of readiness. */
export type ApexFeatureDescriptor = {
  featureId: string;
  stage: string;
  title: string;
  description: string;
  operationCode: string;
  packageDir: string;
  domainFields: readonly string[];
};
export const APEX_CATALOG: readonly ApexFeatureDescriptor[] = [
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
  },
  {
    featureId: "F161",
    stage: "stage6-sovereign-cluster",
    title: "Реестр узлов Raft-кластера и отслеживание задержек",
    description: "Регистрация пиров кластера с верификацией endpoint, роли и задержки heartbeat",
    operationCode: "raft_peer_discovery_registry",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["peer_id", "endpoint_url", "voting_member", "latency_ms"]
  },
  {
    featureId: "F162",
    stage: "stage6-sovereign-cluster",
    title: "Координатор выборов лидера с проверкой кворума",
    description:
      "Проведение раунда голосования Raft с инкрементом term и выпуском монотонного fencing-токена",
    operationCode: "quorum_leader_election_coordinator",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["candidate_peer_id", "term", "quorum_size", "fencing_token"]
  },
  {
    featureId: "F163",
    stage: "stage6-sovereign-cluster",
    title: "Защита от Split-Brain через монотонные Fencing-токены",
    description:
      "Блокировка мутаций состояния от изолированных лидеров с устаревшим fencing-токеном",
    operationCode: "split_brain_fencing_token_guard",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["leader_peer_id", "fencing_token", "expected_min_token", "guard_verdict"]
  },
  {
    featureId: "F164",
    stage: "stage6-sovereign-cluster",
    title: "Репликация журнала предзаписи (WAL) на кворум узлов",
    description:
      "Запись команды в реплицированный лог с цепочкой SHA-256 хешей и подтверждением большинства",
    operationCode: "replicated_state_wal_commit_engine",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["log_index", "command_type", "payload_digest", "replicated_to_peers"]
  },
  {
    featureId: "F165",
    stage: "stage6-sovereign-cluster",
    title: "CRDT LWW-Element-Set мутатор блоков Canvas",
    description:
      "Конфликтно-свободное обновление и удаление блоков документа с гибридными логическими часами Лампорта",
    operationCode: "crdt_lww_canvas_block_mutator",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["document_id", "block_id", "lamport_clock", "replica_id"]
  },
  {
    featureId: "F166",
    stage: "stage6-sovereign-cluster",
    title: "Коммутативное слияние состояний CRDT-реплик",
    description:
      "Детерминированное объединение конкурентных правок из нескольких офлайн/онлайн реплик без потери данных",
    operationCode: "crdt_commutative_replica_merger",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["document_id", "merged_op_count", "active_blocks_count", "convergence_digest"]
  },
  {
    featureId: "F167",
    stage: "stage6-sovereign-cluster",
    title: "Сборка мусора для удалённых CRDT-блоков (Tombstone GC)",
    description:
      "Безопасная очистка метаданных удалённых блоков после достижения стабильного векторного горизонта",
    operationCode: "crdt_tombstone_garbage_collector",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["document_id", "tombstones_inspected", "retained_active_blocks", "state_digest"]
  },
  {
    featureId: "F168",
    stage: "stage6-sovereign-cluster",
    title: "Синхронизатор причинно-следственных векторных часов",
    description: "Вычисление дельты операций между репликами для досылки только недостающих правок",
    operationCode: "causal_vector_clock_synchronizer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["document_id", "max_lamport_clock", "replica_count", "sync_status"]
  },
  {
    featureId: "F169",
    stage: "stage6-sovereign-cluster",
    title: "Оптимизатор контекстного окна по лимиту токенов",
    description: "Умное сжатие и отбор сегментов промпта в рамках жёсткого бюджета токенов модели",
    operationCode: "prompt_token_budget_pruner",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["max_token_budget", "used_tokens", "retained_count", "compression_ratio"]
  },
  {
    featureId: "F170",
    stage: "stage6-sovereign-cluster",
    title: "Защита цитируемых источников при сжатии контекста",
    description:
      "Гарантированное сохранение чанков с активными библиографическими ссылками при усечении промпта",
    operationCode: "citation_anchoring_context_guard",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: [
      "preserved_citations_count",
      "pinned_segments_count",
      "budget_overflow_prevented",
      "compiled_digest"
    ]
  },
  {
    featureId: "F171",
    stage: "stage6-sovereign-cluster",
    title: "Ранжирование сегментов контекста по информационной значимости",
    description:
      "Приоритизация системных инструкций, свежих сообщений и высокорелевантных фактов перед упаковкой промпта",
    operationCode: "semantic_salience_segment_ranker",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["total_segments", "retained_segments", "dropped_segments", "top_salience_score"]
  },
  {
    featureId: "F172",
    stage: "stage6-sovereign-cluster",
    title: "Скользящая компрессия старых реплик диалога",
    description:
      "Вытеснение низкоприоритетных исторических сообщений при сохранении свежих реплик и фактов",
    operationCode: "sliding_window_episodic_summarizer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["window_token_limit", "tokens_before", "tokens_after", "evicted_segment_ids"]
  },
  {
    featureId: "F173",
    stage: "stage6-sovereign-cluster",
    title: "Калибровщик расхода токенов для кириллицы и кода",
    description:
      "Точная оценка стоимости промпта с учётом плотности токенизации UTF-8, кода и пунктуации",
    operationCode: "multi_model_tokenizer_estimator",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["estimated_tokens", "character_count", "budget_utilization_pct", "within_limit"]
  },
  {
    featureId: "F174",
    stage: "stage6-sovereign-cluster",
    title: "Невытесняемое закрепление системных политик безопасности",
    description:
      "Защита системных директив и ограничений безопасности от вытеснения при переполнении окна контекста",
    operationCode: "system_guardrail_pinning_enforcer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["pinned_system_segments", "used_tokens", "max_token_budget", "guardrail_intact"]
  },
  {
    featureId: "F175",
    stage: "stage6-sovereign-cluster",
    title: "Транзакционное применение Unified Diff патчей к коду",
    description:
      "Построчный парсинг и наложение ханков @@ -l,s +l,s @@ с верификацией контекстных строк",
    operationCode: "unified_diff_hunk_applier",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["applied_hunks", "lines_added", "lines_removed", "patched_digest"]
  },
  {
    featureId: "F176",
    stage: "stage6-sovereign-cluster",
    title: "Синтезатор обратного патча для мгновенного отката (Rollback)",
    description:
      "Автоматическая генерация инверсного Unified Diff для безошибочного возврата файла к исходному состоянию",
    operationCode: "inverse_rollback_patch_synthesizer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["original_digest", "patched_digest", "rollback_verified", "inverse_patch_length"]
  },
  {
    featureId: "F177",
    stage: "stage6-sovereign-cluster",
    title: "Детектор конфликтов контекста при наложении патчей",
    description:
      "Предварительная проверка совпадения базовых строк файла перед модификацией кода агентом",
    operationCode: "patch_context_conflict_detector",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["hunk_count", "context_matched", "lines_delta", "verification_hash"]
  },
  {
    featureId: "F178",
    stage: "stage6-sovereign-cluster",
    title: "Пересчёт смещений строк при многоблочном патчинге",
    description:
      "Корректировка координат строк при последовательном применении нескольких ханков разной длины",
    operationCode: "multi_hunk_offset_recalculator",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["applied_hunks", "net_line_offset", "original_digest", "patched_digest"]
  },
  {
    featureId: "F179",
    stage: "stage6-sovereign-cluster",
    title: "Атомарное обновление ревизии артефакта через Diff",
    description:
      "Создание новой неизменяемой ревизии кода только при успешном наложении всех ханков патча",
    operationCode: "atomic_file_revision_patcher",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["original_digest", "patched_digest", "lines_added", "lines_removed"]
  },
  {
    featureId: "F180",
    stage: "stage6-sovereign-cluster",
    title: "Верификатор обратимости патчей (Forward + Inverse Roundtrip)",
    description:
      "Математическая проверка того, что прямое и обратное применение патча возвращает бит-в-бит исходный текст",
    operationCode: "roundtrip_patch_determinism_verifier",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["forward_digest", "restored_digest", "bit_exact_match", "applied_hunks"]
  },
  {
    featureId: "F181",
    stage: "stage6-sovereign-cluster",
    title: "Управление ключевыми парами Ed25519 для подписи артефактов",
    description:
      "Генерация и хранение асимметричных ключей Ed25519 с вычислением криптографического отпечатка публичного ключа",
    operationCode: "ed25519_keypair_lifecycle_manager",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["key_id", "algorithm", "public_key_fingerprint", "created_at_iso"]
  },
  {
    featureId: "F182",
    stage: "stage6-sovereign-cluster",
    title: "Генератор криптографических аттестаций SLSA v1.0",
    description:
      "Формирование и подпись конверта происхождения артефакта (хеш данных, дерево зависимостей, узел сборки)",
    operationCode: "slsa_provenance_attestation_signer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["attestation_id", "artifact_id", "artifact_sha256", "signature_base64"]
  },
  {
    featureId: "F183",
    stage: "stage6-sovereign-cluster",
    title: "Верификатор цифровой подписи Ed25519 и целостности байтов",
    description:
      "Проверка подлинности конверта аттестации и защита от подмены содержимого артефакта",
    operationCode: "ed25519_signature_integrity_verifier",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["attestation_id", "valid", "reason", "verified_key_id"]
  },
  {
    featureId: "F184",
    stage: "stage6-sovereign-cluster",
    title: "Привязка графа зависимостей к аттестации сборки",
    description:
      "Фиксация криптографических дайджестов всех входных источников и скиллов в подписанном манифесте",
    operationCode: "supply_chain_dependency_merkle_binder",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["artifact_id", "dependencies_count", "source_dag_run_id", "attestation_id"]
  },
  {
    featureId: "F185",
    stage: "stage6-sovereign-cluster",
    title: "Криптографический шлюз отбраковки модифицированных артефактов",
    description:
      "Немедленная блокировка выдачи или экспорта артефакта при расхождении байтового SHA-256 с подписью Ed25519",
    operationCode: "tamper_evident_artifact_gatekeeper",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["artifact_id", "untampered_valid", "tampered_rejected", "rejection_reason"]
  },
  {
    featureId: "F186",
    stage: "stage6-sovereign-cluster",
    title: "Независимый аудит цепочки аттестаций тенанта",
    description:
      "Пакетная проверка всех подписанных артефактов проекта по публичному реестру ключей Ed25519",
    operationCode: "cross_tenant_attestation_auditor",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["tenant_id", "verified_count", "public_key_fingerprint", "audit_passed"]
  },
  {
    featureId: "F187",
    stage: "stage6-sovereign-cluster",
    title: "Извлечение повторяющихся паттернов из успешных траекторий DAG",
    description:
      "Анализ выполненных цепочек инструментов и выделение стабильных последовательностей шагов",
    operationCode: "episodic_trajectory_pattern_miner",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["skill_id", "source_trajectory_count", "synthesized_step_count", "pass_rate"]
  },
  {
    featureId: "F188",
    stage: "stage6-sovereign-cluster",
    title: "Канареечный шлюз регрессионного тестирования скиллов",
    description:
      "Автоматический допуск или отбраковка синтезированного скилла по порогу успешности и латентности",
    operationCode: "canary_regression_benchmark_gate",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["skill_id", "pass_rate", "avg_latency_ms", "promoted"]
  },
  {
    featureId: "F189",
    stage: "stage6-sovereign-cluster",
    title: "Автоматическая публикация проверенных композитных скиллов",
    description:
      "Перевод дистиллированного навыка в активный реестр после прохождения канареечного бенчмарка",
    operationCode: "self_evolving_skill_promoter",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["skill_id", "skill_name", "promoted", "determinism_digest"]
  },
  {
    featureId: "F190",
    stage: "stage6-sovereign-cluster",
    title: "Карантинный фильтр нестабильных или медленных траекторий",
    description: "Отсев аварийных и высоколатентных запусков при обучении и синтезе новых скиллов",
    operationCode: "suboptimal_trajectory_quarantine_filter",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["skill_id", "pass_rate", "promoted", "quarantine_reason"]
  },
  {
    featureId: "F191",
    stage: "stage6-sovereign-cluster",
    title: "Контроль скоростного бюджета дистиллированных скиллов",
    description:
      "Измерение средней длительности шагов траектории и блокировка деградировавших цепочек",
    operationCode: "skill_latency_budget_optimizer",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: ["skill_id", "avg_latency_ms", "synthesized_steps_count", "promoted"]
  },
  {
    featureId: "F192",
    stage: "stage6-sovereign-cluster",
    title: "Комплексный верификатор готовности Sovereign Cluster (Stage 6)",
    description:
      "Сквозная проверка консенсуса Raft, CRDT, патчинга кода, подписи Ed25519 и дистилляции скиллов",
    operationCode: "sovereign_cluster_full_lifecycle_readiness",
    packageDir: "packages/core/src/stage6-sovereign-cluster",
    domainFields: [
      "leader_peer_id",
      "crdt_convergence_digest",
      "attestation_valid",
      "distilled_skill_promoted"
    ]
  },
  {
    featureId: "F193",
    stage: "stage7-formal-verification",
    title: "Верификатор инвариантов конечных автоматов (Bounded Model Checker)",
    description:
      "Обход в ширину (BFS) пространства состояний DAG и протокола для математического доказательства отсутствия запрещённых состояний",
    operationCode: "bounded_fsm_model_checker",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "visited_states_count", "invariants_satisfied", "state_space_digest"]
  },
  {
    featureId: "F194",
    stage: "stage7-formal-verification",
    title: "Доказательство отсутствия взаимных блокировок (Deadlock Freedom)",
    description:
      "Обнаружение терминальных тупиковых состояний в графах переходов агентов до запуска рантайма",
    operationCode: "temporal_deadlock_freedom_prover",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "deadlock_states_found", "terminal_states_valid", "proof_status"]
  },
  {
    featureId: "F195",
    stage: "stage7-formal-verification",
    title: "Синтезатор контрпримеров при нарушении инварианта безопасности",
    description:
      "Построение кратчайшей трассы переходов от начального состояния до состояния отказа",
    operationCode: "counterexample_trace_synthesizer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "violated_state", "counterexample_length", "counterexample_path"]
  },
  {
    featureId: "F196",
    stage: "stage7-formal-verification",
    title: "Анализатор недостижимых ветвей и мёртвых состояний графа",
    description:
      "Выявление изолированных узлов конечного автомата, в которые невозможно попасть из начального состояния",
    operationCode: "unreachable_state_pruning_analyzer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "unreachable_states_count", "reachable_ratio", "pruned_digest"]
  },
  {
    featureId: "F197",
    stage: "stage7-formal-verification",
    title: "Верификатор свойств безопасности (Safety Properties) протокола Kosmora",
    description:
      "Проверка инварианта невозможности перехода в состояние списания средств без предварительного аппрува",
    operationCode: "protocol_safety_property_verifier",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "checked_transitions", "safety_verified", "verification_hash"]
  },
  {
    featureId: "F198",
    stage: "stage7-formal-verification",
    title: "Криптографический сертификатор пространства состояний автомата",
    description:
      "Вычисление детерминированного SHA-256 отпечатка графа переходов после успешной верификации модели",
    operationCode: "state_space_digest_certifier",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["model_id", "visited_states", "checked_transitions", "certificate_sha256"]
  },
  {
    featureId: "F199",
    stage: "stage7-formal-verification",
    title: "Решатель задач удовлетворения ограничений (CSP) для размещения воркеров",
    description:
      "Поиск с возвратом (Backtracking) допустимого распределения задач по хостам с учётом CPU, RAM и бюджета",
    operationCode: "csp_resource_placement_solver",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["feasible", "assigned_tasks_count", "total_cost_usd", "schedule_digest"]
  },
  {
    featureId: "F200",
    stage: "stage7-formal-verification",
    title: "Контроллер правил анти-аффинности (Anti-Affinity) между критическими агентами",
    description:
      "Гарантия размещения исполнителя и агента-критика на разных физических узлах или зонах отказоустойчивости",
    operationCode: "anti_affinity_fault_domain_guard",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["anti_affinity_enforced", "distinct_hosts_used", "feasible", "placement_map"]
  },
  {
    featureId: "F201",
    stage: "stage7-formal-verification",
    title: "Оптимизатор упаковки задач по лимитам CPU и памяти узлов",
    description:
      "Предотвращение перегрузки воркеров путём точного учёта остаточной ёмкости хостов при планировании",
    operationCode: "gpu_vram_capacity_bin_packer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["host_count", "packed_tasks", "remaining_cpu_cores", "Remaining_mem_gb"]
  },
  {
    featureId: "F202",
    stage: "stage7-formal-verification",
    title: "Минимизатор стоимости размещения при соблюдении SLA и ролей",
    description:
      "Выбор наиболее экономичных совместимых узлов кластера без нарушения ограничений ролей и памяти",
    operationCode: "sla_cost_minimizing_scheduler",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["total_cost_usd", "budget_limit_usd", "within_budget", "selected_hosts"]
  },
  {
    featureId: "F203",
    stage: "stage7-formal-verification",
    title: "Диагностика неразрешимых конфликтов ограничений (UNSAT Explainer)",
    description:
      "Точное указание противоречивых правил анти-аффинности или нехватки ресурсов при невозможности размещения",
    operationCode: "infeasible_constraint_conflict_explainer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["feasible", "conflict_detected", "unsat_reason", "diagnostic_digest"]
  },
  {
    featureId: "F204",
    stage: "stage7-formal-verification",
    title: "Экспортер детерминированной матрицы назначений задач на узлы",
    description:
      "Формирование верифицированного плана распределения воркеров с криптографическим дайджестом",
    operationCode: "deterministic_placement_matrix_exporter",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["assignments_count", "schedule_digest", "total_cost_usd", "ready_for_dispatch"]
  },
  {
    featureId: "F205",
    stage: "stage7-formal-verification",
    title: "Парсер и инжектор заголовков сквозной трассировки W3C TraceContext",
    description:
      "Валидация формата 00-traceId-spanId-flags и генерация дочернего spanId при передаче управления между агентами",
    operationCode: "w3c_traceparent_header_propagator",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["trace_id", "parent_span_id", "child_span_id", "next_traceparent"]
  },
  {
    featureId: "F206",
    stage: "stage7-formal-verification",
    title: "Сборщик распределённого дерева спанов (Span DAG) мультиагентного прогона",
    description:
      "Реконструкция полной причинно-следственной иерархии вызовов микросервисов и скиллов по traceId",
    operationCode: "distributed_span_dag_assembler",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["trace_id", "span_count", "root_span_id", "trace_digest"]
  },
  {
    featureId: "F207",
    stage: "stage7-formal-verification",
    title: "Анализатор критического пути (Critical Path) в распределённой трассе",
    description:
      "Вычисление самой длинной цепочки зависимых спанов, определяющей общее время ответа системы",
    operationCode: "critical_path_latency_analyzer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["trace_id", "critical_path_ms", "critical_span_ids", "total_duration_ms"]
  },
  {
    featureId: "F208",
    stage: "stage7-formal-verification",
    title: "Детектор узких мест по чистому собственному времени спана (Self-Time)",
    description:
      "Вычитание длительности дочерних вызовов для точного определения сервиса, создающего основную задержку",
    operationCode: "self_time_bottleneck_detector",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["bottleneck_span_id", "bottleneck_service", "self_time_ms", "total_duration_ms"]
  },
  {
    featureId: "F209",
    stage: "stage7-formal-verification",
    title: "Корректор рассинхронизации часов между узлами при анализе трасс",
    description:
      "Нормализация временных меток старта и завершения спанов для точного расчёта длительности прогона",
    operationCode: "cross_service_clock_skew_normalizer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["trace_id", "total_duration_ms", "critical_path_ms", "normalized_ok"]
  },
  {
    featureId: "F210",
    stage: "stage7-formal-verification",
    title: "Генератор криптографического слепка распределённой трассы",
    description:
      "Фиксация структуры спанов, статусов и таймингов в неизменяемом SHA-256 дайджесте телеметрии",
    operationCode: "trace_telemetry_digest_sealer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["trace_id", "span_count", "trace_digest", "sealed_status"]
  },
  {
    featureId: "F211",
    stage: "stage7-formal-verification",
    title: "Рекордер детерминированных кассет исполнения (Execution Cassette)",
    description:
      "Запись всех входов, выходов и цепочки SHA-256 хешей шагов графа для последующего воспроизведения",
    operationCode: "execution_cassette_recorder",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "graph_id", "recorded_steps_count", "cassette_seal_sha256"]
  },
  {
    featureId: "F212",
    stage: "stage7-formal-verification",
    title: "Движок побитово-точного воспроизведения (Deterministic Time-Travel Replay)",
    description:
      "Верификация совпадения всех входов и выходов при повторном прогоне сохранённой кассеты",
    operationCode: "bit_exact_deterministic_replayer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "replay_verified", "replayed_steps", "divergence_step"]
  },
  {
    featureId: "F213",
    stage: "stage7-formal-verification",
    title: "Детектор точки расхождения (Divergence Pinpointer) при реплее траектории",
    description:
      "Мгновенная локализация шага, инструмента и причины несовпадения хешей при деградации детерминизма",
    operationCode: "replay_divergence_pinpointer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "replay_verified", "divergence_step_index", "divergence_reason"]
  },
  {
    featureId: "F214",
    stage: "stage7-formal-verification",
    title: "Верификатор целостности криптографической пломбы кассеты исполнения",
    description:
      "Защита архивных траекторий от несанкционированной модификации входов или результатов инструментов",
    operationCode: "cassette_tamper_seal_verifier",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "seal_valid", "cassette_seal_sha256", "tamper_detected"]
  },
  {
    featureId: "F215",
    stage: "stage7-formal-verification",
    title: "Компаратор эталонных кассет (Golden Cassette) для CI/CD тестирования",
    description:
      "Автоматическое сравнение нового билда агентов с эталонной записью без обращения к внешним LLM API",
    operationCode: "regression_golden_cassette_comparator",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "steps_matched", "replay_verified", "ci_gate_passed"]
  },
  {
    featureId: "F216",
    stage: "stage7-formal-verification",
    title: "Гидратор состояния рантайма из сохранённой кассеты на произвольном шаге",
    description:
      "Восстановление точного контекста и выходов инструментов для отладки инцидентов продакшена",
    operationCode: "time_travel_state_hydration_engine",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["cassette_id", "hydrated_step_count", "seal_sha256", "state_ready"]
  },
  {
    featureId: "F217",
    stage: "stage7-formal-verification",
    title: "Статический анализатор распространения недоверенных данных (Taint Analysis)",
    description:
      "Отслеживание потоков данных от внешних источников (req.body, untrustedInput) через переменные до опасных вызовов",
    operationCode: "static_dataflow_taint_tracker",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["safe", "tainted_variables_count", "violations_count", "analysis_digest"]
  },
  {
    featureId: "F218",
    stage: "stage7-formal-verification",
    title: "Блокировщик передачи неочищенных данных в опасные стоки (eval, execSync, db.exec)",
    description:
      "Предотвращение RCE и инъекций кода в сгенерированных агентами скриптах до запуска в песочнице",
    operationCode: "dangerous_sink_invocation_blocker",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["safe", "blocked_sink_name", "violation_line", "variable_name"]
  },
  {
    featureId: "F219",
    stage: "stage7-formal-verification",
    title: "Верификатор корректного применения функций санитизации (escapeSql, sanitizeHtml)",
    description:
      "Подтверждение того, что недоверенный ввод прошёл через утверждённый санитайзер перед попаданием в сток",
    operationCode: "sanitizer_effectiveness_verifier",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["safe", "sanitized_variables", "violations_count", "analysis_digest"]
  },
  {
    featureId: "F220",
    stage: "stage7-formal-verification",
    title: "Анализатор транзитивного заражения переменных через цепочки присваиваний",
    description:
      "Выявление скрытых потоков данных вида a = req.body; b = a; eval(b) при многошаговых трансформациях",
    operationCode: "transitive_variable_taint_propagator",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["tainted_chain", "violations_count", "safe", "analysis_digest"]
  },
  {
    featureId: "F221",
    stage: "stage7-formal-verification",
    title: "Аудитор безопасности кодовых артефактов перед публикацией на Canvas и в GitHub PR",
    description:
      "Комплексная проверка сгенерированного TypeScript/JavaScript кода на отсутствие уязвимых потоков данных",
    operationCode: "code_injection_sink_auditor",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["safe", "audited_lines_count", "violations_count", "audit_certificate"]
  },
  {
    featureId: "F222",
    stage: "stage7-formal-verification",
    title: "Автоматический шлюз безопасности (Security Gate) для агентских патчей",
    description:
      "Блокировка слияния кода при обнаружении хотя бы одного неочищенного пути от источника к опасному стоку",
    operationCode: "automated_security_gate_enforcer",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["gate_decision", "unsafe_blocked", "sanitized_allowed", "gate_digest"]
  },
  {
    featureId: "F223",
    stage: "stage7-formal-verification",
    title: "Агрегатор формальных доказательств безопасности, CSP и детерминизма",
    description:
      "Сборка единого манифеста верификации из результатов Model Checking, CSP, W3C Trace, Replay и Taint Analysis",
    operationCode: "multi_stage_formal_proof_aggregator",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: ["fsm_safe", "csp_feasible", "replay_verified", "taint_safe"]
  },
  {
    featureId: "F224",
    stage: "stage7-formal-verification",
    title: "Комплексный верификатор готовности контура формальной верификации (Stage 7)",
    description:
      "Сквозная аттестация всех 32 модулей F193–F224 с проверкой математических инвариантов",
    operationCode: "stage7_formal_verification_readiness",
    packageDir: "packages/core/src/stage7-formal-verification",
    domainFields: [
      "stage7_ready",
      "verified_modules_count",
      "composite_proof_digest",
      "timestamp_iso"
    ]
  },
  {
    featureId: "F225",
    stage: "stage8-finops-compliance",
    title: "Адаптивный маршрутизатор LLM-провайдеров на базе алгоритма UCB1 Bandit",
    description:
      "Балансировка исследования и эксплуатации (Exploration/Exploitation) между моделями по качеству, задержке и цене",
    operationCode: "ucb1_multi_armed_bandit_router",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["selected_provider_id", "selected_model_id", "ucb_score", "routing_digest"]
  },
  {
    featureId: "F226",
    stage: "stage8-finops-compliance",
    title: "Калькулятор экспоненциально взвешенной задержки (EWMA) и штрафов за нарушение SLO",
    description:
      "Динамическое снижение рейтинга провайдера при превышении целевого порога латентности ответа",
    operationCode: "ewma_latency_slo_penalty_calculator",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "selected_provider_id",
      "expected_latency_ms",
      "max_latency_slo_ms",
      "slo_compliant"
    ]
  },
  {
    featureId: "F227",
    stage: "stage8-finops-compliance",
    title: "Автоматический прерыватель цепи (Circuit Breaker) для нестабильных LLM-эндпоинтов",
    description:
      "Размыкание цепи и перевод трафика на резервные модели после серии последовательных сбоев провайдера",
    operationCode: "circuit_breaker_arm_quarantine_guard",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "quarantined_provider_id",
      "circuit_open",
      "active_fallback_provider_id",
      "failover_verified"
    ]
  },
  {
    featureId: "F228",
    stage: "stage8-finops-compliance",
    title: "Оптимизатор полезности токенов с учётом стоимости за 1K токенов",
    description:
      "Выбор оптимального соотношения вероятности успеха (Empirical Win Rate) и стоимости вызова модели",
    operationCode: "cost_aware_token_utility_optimizer",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["selected_provider_id", "empirical_win_rate", "estimated_cost_usd", "ucb_score"]
  },
  {
    featureId: "F229",
    stage: "stage8-finops-compliance",
    title: "Планировщик калибровочных запросов (Cold-Start Exploration) для новых моделей",
    description:
      "Гарантированное выделение тестового трафика новым подключённым моделям для набора статистики",
    operationCode: "cold_start_provider_exploration_scheduler",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["explored_provider_id", "total_pulls", "exploration_bonus", "routing_digest"]
  },
  {
    featureId: "F230",
    stage: "stage8-finops-compliance",
    title: "Обновитель апостериорной статистики вознаграждений бандита в реальном времени",
    description:
      "Пересчёт весов успешности и EWMA-латентности после каждого завершённого вызова LLM",
    operationCode: "bandit_telemetry_posterior_updater",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["provider_id", "total_pulls", "empirical_win_rate", "ewma_latency_ms"]
  },
  {
    featureId: "F231",
    stage: "stage8-finops-compliance",
    title:
      "Прогнозировщик скорости сгорания бюджета (Burn Rate) методом наименьших квадратов (OLS)",
    description:
      "Линейная регрессия часового расхода средств тенанта для расчёта точного времени исчерпания квоты",
    operationCode: "ols_burn_rate_trend_forecaster",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "hourly_burn_rate_usd", "ols_slope_usd_per_hour", "forecast_digest"]
  },
  {
    featureId: "F232",
    stage: "stage8-finops-compliance",
    title: "Статистический детектор аномальных скачков расхода токенов (Z-Score Anomaly Detector)",
    description:
      "Выявление нетипичных всплесков потребления бюджета (Z > 2.2) для защиты от runaway-графов",
    operationCode: "zscore_spend_spike_anomaly_detector",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "latest_z_score", "anomaly_detected", "alert_level"]
  },
  {
    featureId: "F233",
    stage: "stage8-finops-compliance",
    title: "Предиктор остаточного времени работы тенанта до исчерпания лимита (Time-to-Exhaustion)",
    description:
      "Расчёт количества часов до обнуления баланса при сохранении текущего наклона линии тренда",
    operationCode: "budget_exhaustion_time_predictor",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "tenant_id",
      "remaining_budget_usd",
      "estimated_hours_until_exhaustion",
      "alert_level"
    ]
  },
  {
    featureId: "F234",
    stage: "stage8-finops-compliance",
    title: "Многоуровневый классификатор финансовых инцидентов (Normal / Warning / Critical)",
    description:
      "Автоматическая эскалация уведомлений владельцу холдинга при опасном ускорении расхода средств",
    operationCode: "multi_tier_finops_alert_escalator",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "alert_level", "anomaly_detected", "forecast_digest"]
  },
  {
    featureId: "F235",
    stage: "stage8-finops-compliance",
    title: "Аудитор финансовой траектории подразделений цифровой холдинговой компании",
    description:
      "Верификация временных рядов затрат и защита от ретроспективного искажения биллинговой статистики",
    operationCode: "tenant_cost_trajectory_auditor",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "tenant_id",
      "current_cumulative_spend_usd",
      "remaining_budget_usd",
      "forecast_digest"
    ]
  },
  {
    featureId: "F236",
    stage: "stage8-finops-compliance",
    title: "Губернатор автоматического квотирования при критическом прогнозе FinOps",
    description:
      "Принудительное переключение графов тенанта на экономичные модели при остатке бюджета менее чем на 12 часов",
    operationCode: "automated_budget_throttle_governor",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "alert_level", "throttle_activated", "recommended_tier"]
  },
  {
    featureId: "F237",
    stage: "stage8-finops-compliance",
    title: "Калибровщик шума Лапласа для механизмов дифференциальной приватности (ε, δ)-DP",
    description:
      "Вычисление масштаба шума b = Δf / ε и детерминированная зашумлённая агрегация чувствительных метрик",
    operationCode: "differential_privacy_laplace_calibrator",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "query_id", "laplace_scale_b", "privatized_value"]
  },
  {
    featureId: "F238",
    stage: "stage8-finops-compliance",
    title: "Бухгалтерская книга учёта расхода бюджета приватности (Privacy Loss Accountant)",
    description:
      "Строгий учёт накопленных параметров ε и δ по каждому аналитическому запросу к данным тенанта",
    operationCode: "privacy_budget_accountant_ledger",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "epsilon_consumed", "remaining_epsilon", "remaining_delta"]
  },
  {
    featureId: "F239",
    stage: "stage8-finops-compliance",
    title: "Блокировщик аналитических запросов при исчерпании лимита дифференциальной приватности",
    description:
      "Предотвращение реконструкции персональных данных путём отказа в выдаче агрегатов сверх квоты ε",
    operationCode: "epsilon_exhaustion_query_guard",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "tenant_id",
      "first_query_allowed",
      "exhausted_query_blocked",
      "remaining_epsilon"
    ]
  },
  {
    featureId: "F240",
    stage: "stage8-finops-compliance",
    title:
      "Агрегатор корпоративной телеметрии с ограниченной L1-чувствительностью (Sensitivity Bound)",
    description:
      "Нормализация вклада отдельной записи перед наложением криптографически стойкого шума Лапласа",
    operationCode: "sensitivity_bounded_analytics_aggregator",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["query_id", "sensitivity", "epsilon_consumed", "dp_receipt_sha256"]
  },
  {
    featureId: "F241",
    stage: "stage8-finops-compliance",
    title: "Эмитент криптографических квитанций соблюдения дифференциальной приватности",
    description:
      "Формирование неизменяемого SHA-256 подтверждения параметров шума и остатка бюджета ε для аудиторов",
    operationCode: "dp_cryptographic_receipt_issuer",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["query_id", "privatized_value", "remaining_epsilon", "dp_receipt_sha256"]
  },
  {
    featureId: "F242",
    stage: "stage8-finops-compliance",
    title: "Изолятор бюджетов приватности между независимыми воркспейсами и тенантами",
    description:
      "Гарантия невозможности использования бюджета приватности одного проекта для запросов к другому",
    operationCode: "cross_workspace_privacy_leakage_preventer",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "tenant_a_remaining_eps",
      "tenant_b_remaining_eps",
      "isolation_intact",
      "receipt_digest"
    ]
  },
  {
    featureId: "F243",
    stage: "stage8-finops-compliance",
    title: "Построитель бинарных деревьев Меркла (SHA-256 Merkle Tree) для комплаенс-утверждений",
    description:
      "Агрегация конфиденциальных полей аудита в единый криптографический корень (Merkle Root)",
    operationCode: "merkle_compliance_tree_builder",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["document_id", "merkle_root", "total_leaves", "revealed_claim_key"]
  },
  {
    featureId: "F244",
    stage: "stage8-finops-compliance",
    title:
      "Генератор доказательств включения (Selective Disclosure Proof) без раскрытия соседних полей",
    description:
      "Предоставление внешнему аудитору математического доказательства одного факта при сохранении в тайне остальных",
    operationCode: "selective_disclosure_inclusion_prover",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["document_id", "revealed_claim_key", "siblings_count", "merkle_root"]
  },
  {
    featureId: "F245",
    stage: "stage8-finops-compliance",
    title: "Независимый верификатор путей Меркла для селективно раскрытых утверждений",
    description:
      "Проверка совпадения вычисленного по хеш-пути корня с подписанным Merkle Root документа",
    operationCode: "zero_leakage_merkle_proof_verifier",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["document_id", "proof_valid", "tampered_rejected", "merkle_root"]
  },
  {
    featureId: "F246",
    stage: "stage8-finops-compliance",
    title: "Защита листьев дерева Меркла от словарного перебора (Preimage Salting)",
    description:
      "Индивидуальное криптографическое солирование каждого атрибута перед хешированием листа",
    operationCode: "salted_leaf_preimage_protector",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["leaf_hash", "merkle_root", "proof_valid", "preimage_protected"]
  },
  {
    featureId: "F247",
    stage: "stage8-finops-compliance",
    title: "Аттестатор регуляторных требований (GDPR / 152-ФЗ / SOC2) через селективное раскрытие",
    description:
      "Подтверждение статуса прохождения проверок безопасности без публикации внутренних логов компании",
    operationCode: "regulatory_audit_claim_attester",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["claim_key", "claim_value", "merkle_root", "verified"]
  },
  {
    featureId: "F248",
    stage: "stage8-finops-compliance",
    title: "Реестр неизменяемых корней Меркла для пакетной верификации комплаенс-пакетов",
    description:
      "Фиксация корневых хешей отчётности тенантов с мгновенным обнаружением подмены любого байта",
    operationCode: "tamper_resistant_merkle_root_registry",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["document_id", "merkle_root", "total_leaves", "integrity_verified"]
  },
  {
    featureId: "F249",
    stage: "stage8-finops-compliance",
    title:
      "Индексатор персональных данных субъектов по контурам хранения (GDPR / 152-ФЗ Inventory)",
    description:
      "Учёт привязки записей субъекта к воркспейсам, векторным индексам, кэшам и архивам",
    operationCode: "rtbf_subject_data_inventory_indexer",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["tenant_id", "subject_id", "indexed_records_count", "stores_covered"]
  },
  {
    featureId: "F250",
    stage: "stage8-finops-compliance",
    title:
      "Движок каскадного криптографического уничтожения данных (Right-to-be-Forgotten Cascade)",
    description:
      "Полное удаление записей субъекта из всех таблиц и кэшей с затиранием криптографических дайджестов",
    operationCode: "cryptographic_shredding_rtbf_cascade",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "certificate_id",
      "purged_records_count",
      "remaining_records_count",
      "erasure_root_hash"
    ]
  },
  {
    featureId: "F251",
    stage: "stage8-finops-compliance",
    title: "Генератор юридически значимых сертификатов об удалении персональных данных",
    description:
      "Выпуск неизменяемого документа с хешем уничтоженных идентификаторов и подписью комплаенс-контура",
    operationCode: "signed_erasure_certificate_generator",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: ["certificate_id", "subject_id", "purged_stores", "signature_sha256"]
  },
  {
    featureId: "F252",
    stage: "stage8-finops-compliance",
    title: "Верификатор нулевого остатка данных (Zero-Residue Verifier) после исполнения RTBF",
    description:
      "Повторное сканирование всех контуров тенанта для гарантии отсутствия остаточных записей субъекта",
    operationCode: "zero_residue_post_erasure_verifier",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "subject_id",
      "remaining_records_count",
      "zero_residue_confirmed",
      "certificate_id"
    ]
  },
  {
    featureId: "F253",
    stage: "stage8-finops-compliance",
    title: "Защитник межтенантной изоляции при выполнении каскадного удаления данных",
    description:
      "Гарантия того, что запрос на забвение в одном тенанте не затрагивает одноимённые идентификаторы в других организациях",
    operationCode: "cross_tenant_rtbf_isolation_guard",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "erased_tenant_remaining",
      "other_tenant_preserved",
      "isolation_verified",
      "erasure_root_hash"
    ]
  },
  {
    featureId: "F254",
    stage: "stage8-finops-compliance",
    title: "Идемпотентный обработчик повторных запросов на удаление данных субъекта",
    description:
      "Корректный выпуск подтверждающего сертификата при повторном обращении после уже выполненной зачистки",
    operationCode: "idempotent_erasure_replay_handler",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "first_purged_count",
      "second_purged_count",
      "idempotent_safe",
      "certificate_signature"
    ]
  },
  {
    featureId: "F255",
    stage: "stage8-finops-compliance",
    title:
      "Единый центр управления FinOps-маршрутизацией, дифференциальной приватностью и комплаенсом",
    description:
      "Координация бандит-роутера, OLS-прогнозов, бюджетов приватности (ε, δ), деревьев Меркла и RTBF",
    operationCode: "unified_finops_privacy_governance_hub",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "bandit_provider",
      "finops_alert_level",
      "dp_remaining_epsilon",
      "merkle_verified"
    ]
  },
  {
    featureId: "F256",
    stage: "stage8-finops-compliance",
    title: "Финальный сертификатор полной 8-этапной архитектуры Kosmora (256 модулей: F001–F256)",
    description:
      "Полная сквозная проверка готовности всех 8 этапов (Autonomy, Canvas, Skills, Graph, Enterprise, Sovereign, Formal, FinOps)",
    operationCode: "kosmora_256_master_architecture_certifier",
    packageDir: "packages/core/src/stage8-finops-compliance",
    domainFields: [
      "total_modules_verified",
      "stages_active",
      "master_architecture_sha256",
      "production_ready"
    ]
  },
  {
    featureId: "F257",
    stage: "stage9-quantum-zk",
    title: "Экстрактор мастер-ключей HKDF-SHA512 (RFC 5869)",
    description:
      "Криптографическое извлечение псевдослучайного ключа (PRK) из входного ключевого материала и соли",
    operationCode: "hkdf_master_extract",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["ikm_material", "salt_material", "info_context", "key_length_bytes"]
  },
  {
    featureId: "F258",
    stage: "stage9-quantum-zk",
    title: "Экспандер изолированных тенантных ключей HKDF",
    description:
      "Детерминированный вывод дочерних ключей шифрования конвертов (DEK/KEK) с привязкой к tenant_id",
    operationCode: "hkdf_tenant_expand",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["tenant_id", "master_prk_hex", "envelope_purpose", "key_length_bytes"]
  },
  {
    featureId: "F259",
    stage: "stage9-quantum-zk",
    title: "Детерминированный криптографический храповик эпох (Key Ratchet)",
    description:
      "Одностороннее продвижение цепочки ключей с защитой прямой секретности (Forward Secrecy)",
    operationCode: "hkdf_epoch_ratchet",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["current_chain_key", "epoch_sequence", "ratchet_salt", "domain_label"]
  },
  {
    featureId: "F260",
    stage: "stage9-quantum-zk",
    title: "Защитник доменного разделения подключей",
    description:
      "Гарантия криптографической ортогональности ключей для подписи, шифрования и аудита",
    operationCode: "hkdf_domain_separation",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["source_key_id", "domain_tag_a", "domain_tag_b", "collision_policy"]
  },
  {
    featureId: "F261",
    stage: "stage9-quantum-zk",
    title: "Конвейер генерации эфемерных сессионных ключей",
    description: "Выпуск краткоживущих ключей для защищённых межагентных каналов",
    operationCode: "hkdf_ephemeral_session",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["session_nonce", "peer_public_key", "cipher_suite", "ttl_seconds"]
  },
  {
    featureId: "F262",
    stage: "stage9-quantum-zk",
    title: "Аудитор ротации и криптографического затирания ключей",
    description: "Верификация смены ключевых эпох и контрольных сумм KCV (Key Check Value)",
    operationCode: "hkdf_rotation_audit",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["rotation_epoch", "previous_key_digest", "next_key_digest", "audit_policy"]
  },
  {
    featureId: "F263",
    stage: "stage9-quantum-zk",
    title: "Разделитель секретов Шамира над простым полем GF(65537)",
    description:
      "Генерация пороговых долей секрета (k, n) через полиномы степени (k-1) по модулю простого числа Ферма 65537",
    operationCode: "shamir_polynomial_split",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["secret_payload", "threshold_k", "total_shares_n", "field_prime"]
  },
  {
    featureId: "F264",
    stage: "stage9-quantum-zk",
    title: "Интерполятор Лагранжа для порогового восстановления секрета",
    description:
      "Точное восстановление мастер-ключа из любых k долей методом полиномиальной интерполяции Лагранжа в GF(65537)",
    operationCode: "shamir_lagrange_reconstruct",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["share_subset", "threshold_k", "expected_checksum", "recovery_actor"]
  },
  {
    featureId: "F265",
    stage: "stage9-quantum-zk",
    title: "Верификатор целостности долей Шамира против искажений",
    description:
      "Проверка криптографических контрольных сумм каждой доли перед началом интерполяции Лагранжа",
    operationCode: "shamir_commitment_verify",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["share_index", "share_hex_payload", "commitment_root", "verifier_node"]
  },
  {
    featureId: "F266",
    stage: "stage9-quantum-zk",
    title: "Координатор проактивного обновления долей без смены секрета",
    description:
      "Перевыпуск долей хранителей при сохранении нулевого свободного члена полинома P(0)",
    operationCode: "shamir_proactive_refresh",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["custodian_group", "refresh_epoch", "threshold_k", "zero_sum_poly_seed"]
  },
  {
    featureId: "F267",
    stage: "stage9-quantum-zk",
    title: "Кворумный шлюз депонирования ключей хранителей",
    description:
      "Контроль сбора минимального порога k независимых хранителей для разблокировки критического контура",
    operationCode: "shamir_custodian_escrow",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["escrow_session_id", "submitted_custodians", "required_quorum", "vault_target"]
  },
  {
    featureId: "F268",
    stage: "stage9-quantum-zk",
    title: "Аварийный рекомбинатор мастер-ключа (Break-Glass Recovery)",
    description:
      "Восстановление корневого доступа при аварии с обязательной фиксацией в неизменяемом журнале",
    operationCode: "shamir_breakglass_recover",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["incident_ticket_id", "approver_signatures", "threshold_k", "audit_sink"]
  },
  {
    featureId: "F269",
    stage: "stage9-quantum-zk",
    title:
      "Прувер неинтерактивных доказательств с нулевым разглашением (Fiat-Shamir Schnorr NIZKP)",
    description:
      "Доказательство знания секретного свидетеля x для публичного обязательства y = g^x mod p без раскрытия x",
    operationCode: "zk_schnorr_prove",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["statement_context", "secret_witness", "prover_identity", "group_modulus"]
  },
  {
    featureId: "F270",
    stage: "stage9-quantum-zk",
    title: "Верификатор неинтерактивных ZK-доказательств Фиата-Шамира",
    description:
      "Математическая проверка тождества Шнорра g^s mod p === (t * y^c) mod p и хеш-вызова c",
    operationCode: "zk_schnorr_verify",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["statement_context", "commitment_hex", "challenge_hex", "response_hex"]
  },
  {
    featureId: "F271",
    stage: "stage9-quantum-zk",
    title: "ZK-аттестатор выполнения предикатов политики безопасности",
    description:
      "Доказательство соответствия приватных параметров запуска корпоративным правилам без утечки значений",
    operationCode: "zk_policy_predicate",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["policy_rule_id", "private_witness_seed", "public_claim_digest", "verifier_role"]
  },
  {
    featureId: "F272",
    stage: "stage9-quantum-zk",
    title: "Привязчик ZK-вызовов с защитой от атак повтора (Replay Guard)",
    description:
      "Включение идентификатора утверждения и одноразового зерна в хеш Фиата-Шамира H(g||y||t||stmt)",
    operationCode: "zk_challenge_binder",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["session_challenge", "epoch_timestamp", "prover_commitment", "nonce_window"]
  },
  {
    featureId: "F273",
    stage: "stage9-quantum-zk",
    title: "ZK-хранитель подтверждения владения мандатом агента",
    description:
      "Аутентификация воркера в суверенном кластере через NIZKP без передачи секретного ключа по сети",
    operationCode: "zk_credential_witness",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["credential_id", "holder_secret", "relying_party_id", "disclosure_scope"]
  },
  {
    featureId: "F274",
    stage: "stage9-quantum-zk",
    title:
      "Монитор криптографической корректности (Soundness) и перехвата поддельных ZK-доказательств",
    description: "Мгновенная отбраковка сфальсифицированных откликов s и неверных обязательств t",
    operationCode: "zk_soundness_monitor",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: [
      "proof_transcript_id",
      "lhs_verification_hex",
      "rhs_expected_hex",
      "penalty_action"
    ]
  },
  {
    featureId: "F275",
    stage: "stage9-quantum-zk",
    title: "Генератор постквантовых хеш-ключей Лэмпорта-Винтерница (SHA-256 OTS)",
    description:
      "Построение квантово-устойчивых цепочек хеш-прообразов и корневого публичного ключа",
    operationCode: "pqc_lamport_keygen",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["key_id", "entropy_seed_hex", "hash_chain_depth", "security_level"]
  },
  {
    featureId: "F276",
    stage: "stage9-quantum-zk",
    title: "Постквантовый подписант сообщений на базе хеш-цепочек (Lamport-SHA256)",
    description:
      "Формирование квантово-устойчивой подписи без опоры на факторизацию или дискретный логарифм",
    operationCode: "pqc_lamport_sign",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["message_payload", "key_seed_hex", "signature_counter", "domain_context"]
  },
  {
    featureId: "F277",
    stage: "stage9-quantum-zk",
    title: "Верификатор постквантовых подписей Лэмпорта-Меркла",
    description:
      "Досчёт хеш-цепочек от раскрытых промежуточных значений до публичного корня и сверка дайджеста",
    operationCode: "pqc_lamport_verify",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: [
      "message_payload",
      "public_key_root_hex",
      "revealed_preimages",
      "verifier_policy"
    ]
  },
  {
    featureId: "F278",
    stage: "stage9-quantum-zk",
    title: "Менеджер дерева Меркла для многоразовых постквантовых подписей (Stateful HBS)",
    description:
      "Объединение одноразовых ключей OTS в единое дерево с проверкой индекса использованного листа",
    operationCode: "pqc_merkle_ots_tree",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["tree_id", "leaf_index", "max_one_time_keys", "root_anchor_hex"]
  },
  {
    featureId: "F279",
    stage: "stage9-quantum-zk",
    title: "Детектор повторного использования одноразового постквантового ключа",
    description:
      "Предотвращение деградации стойкости OTS при попытке подписать два разных сообщения одним листом",
    operationCode: "pqc_double_sign_detect",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["public_key_root", "message_digest_a", "message_digest_b", "revocation_hook"]
  },
  {
    featureId: "F280",
    stage: "stage9-quantum-zk",
    title: "Гибридный криптоконверт (Ed25519 + Post-Quantum Lamport-SHA256)",
    description:
      "Двойная аттестация критических релизов одновременно классической и постквантовой подписью",
    operationCode: "pqc_hybrid_envelope",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: [
      "payload_digest",
      "hmac_classical_sig",
      "lamport_quantum_sig",
      "verification_mode"
    ]
  },
  {
    featureId: "F281",
    stage: "stage9-quantum-zk",
    title: "Аппендер криптографического журнала прозрачности (RFC 6962 Merkle Log)",
    description:
      "Добавление записей в append-only дерево Меркла с мгновенным выпуском квитанции включения",
    operationCode: "transparency_log_append",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["actor_id", "operation_code", "payload_hash", "log_partition"]
  },
  {
    featureId: "F282",
    stage: "stage9-quantum-zk",
    title: "Генератор подписанных вершин дерева прозрачности (Signed Tree Head)",
    description: "Фиксация размера журнала и корневого хеша Меркла для внешней перекрёстной сверки",
    operationCode: "transparency_sth_checkpoint",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["tree_size", "merkle_root_hash", "checkpoint_epoch", "signer_key_id"]
  },
  {
    featureId: "F283",
    stage: "stage9-quantum-zk",
    title: "Построитель маршрутов доказательства включения (Merkle Audit Path)",
    description:
      "Вычисление логарифмического пути соседей от целевого листа до корня дерева прозрачности",
    operationCode: "transparency_inclusion_gen",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["leaf_sequence", "leaf_payload_hash", "snapshot_tree_size", "audit_requester"]
  },
  {
    featureId: "F284",
    stage: "stage9-quantum-zk",
    title: "Верификатор квитанций включения в журнал прозрачности",
    description:
      "Независимая проверка того, что событие действительно зафиксировано в неизменяемом дереве Меркла",
    operationCode: "transparency_receipt_verify",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["entry_id", "leaf_hash", "inclusion_proof_nodes", "expected_merkle_root"]
  },
  {
    featureId: "F285",
    stage: "stage9-quantum-zk",
    title: "Аудитор защиты от раздвоения журнала (Split-View Gossip Detector)",
    description: "Сравнение вершин дерева между узлами кластера для исключения подмены истории",
    operationCode: "transparency_gossip_audit",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["local_tree_head", "remote_tree_head", "tree_size", "conflict_action"]
  },
  {
    featureId: "F286",
    stage: "stage9-quantum-zk",
    title: "Прувер монотонности расширения журнала (Append-Only Consistency)",
    description:
      "Доказательство того, что новое состояние дерева является строгим надмножеством предыдущего",
    operationCode: "transparency_consistency_prove",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["old_tree_size", "new_tree_size", "old_root_hash", "new_root_hash"]
  },
  {
    featureId: "F287",
    stage: "stage9-quantum-zk",
    title: "Экспортер криптографических квитанций прозрачности для внешнего аудита",
    description:
      "Формирование самодостаточного JSON-пакета с путём Меркла, ZK-доказательством и PQC-подписью",
    operationCode: "transparency_receipt_export",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["receipt_target_id", "inclusion_path", "sth_signature", "export_format"]
  },
  {
    featureId: "F288",
    stage: "stage9-quantum-zk",
    title:
      "Единый мост постквантовой защиты, Шамира, ZK-доказательств и журнала прозрачности (Stage 9 Hub)",
    description:
      "Сквозная криптографическая привязка HKDF, пороговых долей Шамира, Фиата-Шамира и PQC-подписей",
    operationCode: "transparency_anchor_bridge",
    packageDir: "packages/core/src/stage9-quantum-zk",
    domainFields: ["anchor_batch_id", "merkle_root_hash", "zk_proof_digest", "pqc_signature_root"]
  },
  {
    featureId: "F289",
    stage: "stage10-game-theory",
    title: "Вычислитель предельного вклада агентов в коалициях (Marginal Contribution Evaluator)",
    description:
      "Оценка прироста ценности v(S U {i}) - v(S) по всем 2^(n-1) подмножествам коалиции агентов",
    operationCode: "shapley_marginal_eval",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "coalition_agents",
      "characteristic_values",
      "target_agent_id",
      "permutation_mode"
    ]
  },
  {
    featureId: "F290",
    stage: "stage10-game-theory",
    title: "Точный распределитель вектора Шепли (Exact Shapley Value Allocator)",
    description:
      "Факториальный расчёт справедливого вклада каждого агента в общий результат многоагентного DAG",
    operationCode: "shapley_exact_allocate",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["agent_list", "coalition_worth_map", "grand_coalition_total", "rounding_policy"]
  },
  {
    featureId: "F291",
    stage: "stage10-game-theory",
    title: "Верификатор аксиомы эффективности Шепли (Sum phi_i === v(N))",
    description:
      "Математическая проверка того, что сумма выплат агентам в точности равна ценности большой коалиции",
    operationCode: "shapley_efficiency_check",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "shapley_vector",
      "grand_coalition_value",
      "tolerance_epsilon",
      "reconcile_target"
    ]
  },
  {
    featureId: "F292",
    stage: "stage10-game-theory",
    title: "Детектор нулевых игроков (Null Player Axiom Guard)",
    description:
      "Идентификация агентов с нулевым предельным вкладом во все коалиции для отсечения паразитных вызовов",
    operationCode: "shapley_null_player_detect",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["agent_contributions", "marginal_deltas", "zero_threshold", "pruning_policy"]
  },
  {
    featureId: "F293",
    stage: "stage10-game-theory",
    title: "Верификатор аксиомы симметрии и равноправия агентов",
    description:
      "Гарантия одинакового вознаграждения для агентов с идентичным вкладом во все подмножества задач",
    operationCode: "shapley_symmetry_verify",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["agent_pair_ids", "coalition_payoffs", "shapley_shares", "fairness_action"]
  },
  {
    featureId: "F294",
    stage: "stage10-game-theory",
    title: "Анализатор супераддитивной синергии коалиций (v(A U B) >= v(A) + v(B))",
    description:
      "Измерение чистого кооперативного выигрыша от совместной работы специализированных агентов",
    operationCode: "shapley_synergy_analyze",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "singleton_sum",
      "grand_coalition_worth",
      "synergy_bonus_pool",
      "distribution_rule"
    ]
  },
  {
    featureId: "F295",
    stage: "stage10-game-theory",
    title: "Диспетчер распределения призового бюджета по долям Шепли",
    description:
      "Пропорциональное начисление квот токенов и вычислительного бюджета по нормализованным весам Шепли",
    operationCode: "shapley_reward_settle",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["settlement_batch_id", "total_budget_usd", "normalized_shares", "ledger_account"]
  },
  {
    featureId: "F296",
    stage: "stage10-game-theory",
    title: "Аудиторский реестр кооперативной атрибуции полезности агентов",
    description:
      "Неизменяемая запись дайджестов распределения Шепли для каждого завершённого графа задач",
    operationCode: "shapley_credit_ledger",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["dag_run_id", "agent_payoff_map", "efficiency_gap", "audit_signature"]
  },
  {
    featureId: "F297",
    stage: "stage10-game-theory",
    title: "Сборщик ставок комбинаторного аукциона задач (VCG Bid Collector)",
    description:
      "Приём заявок агентов с заявленной стоимостью выполнения и оценкой качества по слотам задач",
    operationCode: "vcg_bid_collector",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["auction_session_id", "bidder_agents", "task_slots", "reported_cost_matrix"]
  },
  {
    featureId: "F298",
    stage: "stage10-game-theory",
    title: "Оптимизатор общественного благосостояния в аукционе Викри-Кларка-Гровса",
    description:
      "Поиск назначения агентов по задачам, максимизирующего суммарную полезность (качество минус издержки)",
    operationCode: "vcg_cost_minimizer",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "candidate_assignments",
      "bid_cost_table",
      "slot_constraints",
      "optimization_goal"
    ]
  },
  {
    featureId: "F299",
    stage: "stage10-game-theory",
    title: "Вычислитель экстерналий правила ведущего элемента Кларка (Clarke Pivot Rule)",
    description:
      "Расчёт разницы благосостояния системы с участием агента и без него для честного ценообразования",
    operationCode: "vcg_clarke_pivot",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "excluded_agent_id",
      "remaining_agents",
      "optimal_with_agent_cost",
      "counterfactual_cost"
    ]
  },
  {
    featureId: "F300",
    stage: "stage10-game-theory",
    title: "Движок неманипулируемых выплат VCG (Strategy-Proof Payment Engine)",
    description:
      "Формирование выплат победителям, при которых сообщение истинных издержек является доминирующей стратегией",
    operationCode: "vcg_truthful_payment",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["winning_assignments", "reported_bids", "clarke_externality", "payment_cap_usd"]
  },
  {
    featureId: "F301",
    stage: "stage10-game-theory",
    title: "Гарант индивидуальной рациональности участия агентов (Individual Rationality)",
    description:
      "Проверка того, что итоговая выплата VCG каждому победителю не ниже его истинных заявленных затрат",
    operationCode: "vcg_utility_surplus",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["agent_id", "vcg_payment_usd", "true_execution_cost_usd", "participation_floor"]
  },
  {
    featureId: "F302",
    stage: "stage10-game-theory",
    title: "Детектор сговора и фиктивных ставок в агентных аукционах",
    description:
      "Анализ дисперсии ставок и выявление координированного завышения цен в пуле исполнителей",
    operationCode: "vcg_collusion_detect",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["bid_history_window", "spread_variance", "suspect_coalition", "mitigation_mode"]
  },
  {
    featureId: "F303",
    stage: "stage10-game-theory",
    title: "Контроллер бюджетного баланса и информационной ренты аукциона VCG",
    description: "Учёт премий Кларка и контроль соблюдения верхнего лимита расходов воркспейса",
    operationCode: "vcg_budget_balance",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "total_vcg_payments",
      "total_reported_costs",
      "information_rent_usd",
      "treasury_pool_id"
    ]
  },
  {
    featureId: "F304",
    stage: "stage10-game-theory",
    title: "Финализатор смарт-контрактов распределения задач по итогам VCG",
    description:
      "Закрепление выбранных исполнителей и гарантированных выплат в плане исполнения DAG",
    operationCode: "vcg_contract_finalize",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["auction_id", "winner_schedule", "vcg_payment_vector", "escrow_lock_id"]
  },
  {
    featureId: "F305",
    stage: "stage10-game-theory",
    title: "Построитель матрицы попарных предпочтений Кондорсе (Pairwise Matrix Builder)",
    description:
      "Подсчёт числа бюллетеней агентов-экспертов, в которых кандидат A строго предпочтительнее кандидата B",
    operationCode: "schulze_pairwise_matrix",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["candidate_options", "voter_ballots", "ballot_weights", "tie_break_seed"]
  },
  {
    featureId: "F306",
    stage: "stage10-game-theory",
    title: "Решатель сильнейших путей Шульце методом Флойда-Уоршелла (Beatpath Solver)",
    description:
      "Вычисление пропускной способности сильнейших цепочек побед p[A,B] между всеми парами архитектурных альтернатив",
    operationCode: "schulze_widest_path",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "pairwise_defeats",
      "candidate_count",
      "path_strength_metric",
      "convergence_check"
    ]
  },
  {
    featureId: "F307",
    stage: "stage10-game-theory",
    title: "Сертификатор победителя Кондорсе по методу Шульце",
    description:
      "Определение решения, побеждающего все остальные альтернативы по сильнейшим путям предпочтений",
    operationCode: "schulze_condorcet_certify",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["beatpath_matrix", "candidate_ids", "ballot_count", "quorum_rule"]
  },
  {
    featureId: "F308",
    stage: "stage10-game-theory",
    title: "Защитник независимости от клонов-спойлеров (Independence of Clones)",
    description:
      "Гарантия того, что добавление схожих вариантов ответа не искажает выбор лучшего плана",
    operationCode: "schulze_clone_guard",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["original_candidates", "cloned_candidate_set", "ranking_before", "ranking_after"]
  },
  {
    featureId: "F309",
    stage: "stage10-game-theory",
    title: "Фильтр валидности ранжированных бюллетеней при византийском голосовании",
    description:
      "Проверка полноты и отсутствия циклов внутри индивидуальных ранжировок агентов-верификаторов",
    operationCode: "schulze_ballot_filter",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["raw_ballots", "authorized_voters", "duplicate_policy", "completeness_rule"]
  },
  {
    featureId: "F310",
    stage: "stage10-game-theory",
    title: "Детерминированный арбитр разрешения ничьих в методе Шульце",
    description:
      "Разрешение симметричных циклов Кондорсе по криптографически фиксированному правилу старшинства",
    operationCode: "schulze_tie_arbiter",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "tied_candidate_pair",
      "beatpath_forward",
      "beatpath_reverse",
      "lexicographic_rule"
    ]
  },
  {
    featureId: "F311",
    stage: "stage10-game-theory",
    title: "Селектор коллективного архитектурного решения комитета агентов",
    description:
      "Выбор финального патча или стратегии рефакторинга на основе ранжированного консенсуса Шульце",
    operationCode: "schulze_arch_selector",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["proposal_candidates", "reviewer_rankings", "winning_proposal", "execution_gate"]
  },
  {
    featureId: "F312",
    stage: "stage10-game-theory",
    title: "Генератор протокола доказательства консенсуса Шульце",
    description:
      "Публикация полной матрицы попарных сравнений d[i,j] и сильнейших путей p[i,j] для аудита",
    operationCode: "schulze_transcript_emit",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["election_id", "pairwise_table", "beatpath_table", "final_ranking_order"]
  },
  {
    featureId: "F313",
    stage: "stage10-game-theory",
    title: "Валидатор двусторонних профилей предпочтений (Gale-Shapley Profile Validator)",
    description:
      "Проверка строгого порядка предпочтений между пулом агентов-исполнителей и очередью задач",
    operationCode: "galeshapley_profile_validate",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "proposer_agents",
      "reviewer_tasks",
      "agent_preference_map",
      "task_preference_map"
    ]
  },
  {
    featureId: "F314",
    stage: "stage10-game-theory",
    title: "Алгоритм отложенного согласия Гейла-Шепли (Deferred Acceptance Engine)",
    description:
      "Пошаговое формирование устойчивого паросочетания между агентами и вычислительными слотами",
    operationCode: "galeshapley_deferred_propose",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["unmatched_agents", "next_proposal_index", "task_rankings", "round_limit"]
  },
  {
    featureId: "F315",
    stage: "stage10-game-theory",
    title: "Верификатор отсутствия блокирующих пар (Blocking Pair Stability Prover)",
    description:
      "Математическая проверка того, что ни одна пара (агент, задача) не предпочитает друг друга своим текущим назначениям",
    operationCode: "galeshapley_blocking_verify",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["matched_pairs", "agent_prefs", "task_prefs", "stability_policy"]
  },
  {
    featureId: "F316",
    stage: "stage10-game-theory",
    title: "Аудитор Парето-оптимальности назначений для предлагающей стороны",
    description:
      "Подтверждение того, что алгоритм Гейла-Шепли нашёл наилучшее устойчивое назначение для всех агентов",
    operationCode: "galeshapley_pareto_audit",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "agent_optimal_map",
      "average_agent_rank",
      "average_task_rank",
      "optimality_bound"
    ]
  },
  {
    featureId: "F317",
    stage: "stage10-game-theory",
    title: "Механизм устойчивого распределения с квотами ёмкости узлов",
    description:
      "Сопоставление групп воркеров с пулами задач с учётом ограничений слотов и приоритетов",
    operationCode: "galeshapley_quota_matcher",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["worker_agents", "queue_buckets", "bucket_capacities", "preference_lists"]
  },
  {
    featureId: "F318",
    stage: "stage10-game-theory",
    title: "Диспетчер переназначения свободных задач при асимметричных пулах",
    description: "Безопасная маршрутизация нераспределённых задач в резервный контур исполнения",
    operationCode: "galeshapley_unmatched_fallback",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "unmatched_agent_ids",
      "unmatched_task_ids",
      "fallback_queue",
      "escalation_target"
    ]
  },
  {
    featureId: "F319",
    stage: "stage10-game-theory",
    title: "Компилятор таблицы маршрутизации на базе устойчивого равновесия Гейла-Шепли",
    description:
      "Преобразование доказанно устойчивого паросочетания в исполняемый план диспетчера воркеров",
    operationCode: "galeshapley_routing_compile",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: ["stable_pair_list", "proposal_count", "stability_verified", "dispatch_epoch"]
  },
  {
    featureId: "F320",
    stage: "stage10-game-theory",
    title: "Финальный сертификатор 10-этапной архитектуры Kosmora (320 модулей: F001–F320)",
    description:
      "Полная сквозная проверка всех 10 этапов (Autonomy, Canvas, Skills, Graph, Enterprise, Sovereign, Formal, FinOps, Quantum-ZK, Game-Theory)",
    operationCode: "galeshapley_telemetry_aggregate",
    packageDir: "packages/core/src/stage10-game-theory",
    domainFields: [
      "matching_run_id",
      "blocking_pairs_count",
      "shapley_efficiency",
      "vcg_truthful_flag"
    ]
  },
  {
    featureId: "F321",
    stage: "stage11-causal-bayesian",
    title: "Компилятор структурных причинно-следственных моделей (SCM DAG Compiler)",
    description:
      "Построение топологически упорядоченного графа структурных уравнений X_i = f_i(pa_i, U_i)",
    operationCode: "scm_dag_compiler",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["variables_list", "causal_edges", "exogenous_priors", "acyclic_verified"]
  },
  {
    featureId: "F322",
    stage: "stage11-causal-bayesian",
    title: "Оператор хирургии графа do(X = x) по исчислению Перла (Graph Mutilation Engine)",
    description:
      "Удаление входящих рёбер в переменную воздействия X для отделения истинной причинности от корреляции",
    operationCode: "pearl_do_mutilator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "target_variable",
      "intervention_value",
      "severed_parent_edges",
      "mutilated_dag_hash"
    ]
  },
  {
    featureId: "F323",
    stage: "stage11-causal-bayesian",
    title: "Детектор конфаундеров и критерия обходного пути (Backdoor Criterion Analyzer)",
    description: "Идентификация общих предков воздействия и исхода для устранения смещения отбора",
    operationCode: "backdoor_confounder_finder",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["treatment_node", "outcome_node", "detected_confounders", "backdoor_blocked"]
  },
  {
    featureId: "F324",
    stage: "stage11-causal-bayesian",
    title: "Вычислитель среднего причинно-следственного эффекта (Average Causal Effect Estimator)",
    description: "Точный расчёт разницы E[Y | do(X=1)] - E[Y | do(X=0)] по структурным уравнениям",
    operationCode: "ace_causal_estimator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["treatment_var", "outcome_var", "ace_delta", "confounding_bias"]
  },
  {
    featureId: "F325",
    stage: "stage11-causal-bayesian",
    title: "Анализатор опосредованных путей воздействия (Frontdoor Mediator Quantifier)",
    description:
      "Декомпозиция прямого и косвенного причинного влияния через промежуточные узлы-медиаторы",
    operationCode: "frontdoor_mediator_quantifier",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["source_treatment", "mediator_node", "outcome_node", "mediated_share_pct"]
  },
  {
    featureId: "F326",
    stage: "stage11-causal-bayesian",
    title: "Детектор ложных корреляций и парадокса Симпсона (Spurious Correlation Guard)",
    description:
      "Сравнение наблюдаемой ассоциации и интервенционного распределения для отсечения ложных выводов",
    operationCode: "spurious_bias_detector",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "observational_corr",
      "interventional_effect",
      "bias_magnitude",
      "simpson_reversal"
    ]
  },
  {
    featureId: "F327",
    stage: "stage11-causal-bayesian",
    title: "Сканер устойчивости причинных выводов к скрытым конфаундерам",
    description:
      "Оценка минимальной силы неучтённого фактора (E-value), способного обнулить наблюдаемый эффект",
    operationCode: "causal_sensitivity_scanner",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["estimated_ace", "unobserved_bound", "robustness_score", "verdict_stable"]
  },
  {
    featureId: "F328",
    stage: "stage11-causal-bayesian",
    title: "Симулятор управленческих интервенций над графом воркспейса",
    description:
      "Прогнозирование последствий изменения лимитов, моделей и параметров DAG до применения в проде",
    operationCode: "scm_policy_simulator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["policy_knob", "do_setting", "predicted_kpi_delta", "simulation_digest"]
  },
  {
    featureId: "F329",
    stage: "stage11-causal-bayesian",
    title: "Модуль абдукции экзогенного шума по наблюдаемым фактам (Step 1: Abduction)",
    description:
      "Восстановление скрытых индивидуальных факторов U = u из фактической траектории выполнения задачи",
    operationCode: "cf_noise_abductor",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["observed_evidence", "inferred_exogenous_u", "residual_norm", "abduction_exact"]
  },
  {
    featureId: "F330",
    stage: "stage11-causal-bayesian",
    title: "Исполнитель гипотетического действия в контрфактическом мире (Step 2: Action)",
    description:
      "Фиксация альтернативного решения агента do(X = x') при сохранении восстановленного фона U",
    operationCode: "cf_action_mutator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["abducted_state_id", "hypothetical_var", "hypothetical_val", "modified_scm_id"]
  },
  {
    featureId: "F331",
    stage: "stage11-causal-bayesian",
    title: "Предиктор контрфактического исхода Y_{X <- x'}(u) (Step 3: Prediction)",
    description:
      "Прямой прогон модифицированной структурной модели с индивидуальными шумами для ответа «что было бы, если»",
    operationCode: "cf_trajectory_predictor",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "factual_outcome",
      "counterfactual_outcome",
      "individual_effect_ite",
      "prediction_digest"
    ]
  },
  {
    featureId: "F332",
    stage: "stage11-causal-bayesian",
    title: "Вычислитель индивидуального эффекта воздействия (Individual Treatment Effect Prover)",
    description:
      "Точная оценка выигрыша или потерь конкретного прогона DAG от выбора альтернативной модели",
    operationCode: "cf_ite_prover",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["run_id", "baseline_outcome", "alternate_outcome", "ite_delta"]
  },
  {
    featureId: "F333",
    stage: "stage11-causal-bayesian",
    title: "Контрфактический атрибутор первопричины сбоя (Counterfactual Root-Cause Locator)",
    description:
      "Проверка того, исчезла ли бы ошибка пайплайна при замене конкретного узла на эталонный",
    operationCode: "cf_blame_attributor",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["failed_node_id", "counterfactual_fixed", "necessity_prob", "blame_rank"]
  },
  {
    featureId: "F334",
    stage: "stage11-causal-bayesian",
    title: "Калькулятор вероятности необходимости и достаточности (PN / PS / PNS)",
    description:
      "Математическая оценка того, насколько действие агента было необходимым и достаточным для успеха",
    operationCode: "cf_pns_calculator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["event_x", "outcome_y", "pns_score", "sufficiency_verified"]
  },
  {
    featureId: "F335",
    stage: "stage11-causal-bayesian",
    title:
      "Компаратор двойных сетей (Twin-Network Graph) для параллельной оценки факта и контрфакта",
    description:
      "Одновременное ведение реального и контрфактического мира с общими экзогенными переменными",
    operationCode: "cf_twin_comparator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "factual_world_hash",
      "cf_world_hash",
      "shared_noise_vector",
      "divergence_metric"
    ]
  },
  {
    featureId: "F336",
    stage: "stage11-causal-bayesian",
    title: "Синтезатор верифицируемых контрфактических объяснений для аудитора",
    description:
      "Формирование отчёта о минимальном изменении входа, которое перевело бы вердикт Критика в Approved",
    operationCode: "cf_explanation_synth",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "current_verdict",
      "minimal_delta_input",
      "flipped_verdict",
      "explanation_sha256"
    ]
  },
  {
    featureId: "F337",
    stage: "stage11-causal-bayesian",
    title: "Конструктор априорных распределений и таблиц условных вероятностей (CPT Builder)",
    description:
      "Задание априорных вероятностей гипотез P(H) и функций правдоподобия P(E | H) для диагностики",
    operationCode: "bayes_cpt_builder",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["hypothesis_ids", "prior_vector", "cpt_matrix_dim", "normalization_ok"]
  },
  {
    featureId: "F338",
    stage: "stage11-causal-bayesian",
    title: "Движок точного байесовского обновления апостериорных вероятностей P(H | E)",
    description:
      "Пересчёт распределения вероятностей гипотез при поступлении новых диагностических сигналов",
    operationCode: "bayes_posterior_updater",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["evidence_map", "posterior_vector", "marginal_likelihood", "update_verified"]
  },
  {
    featureId: "F339",
    stage: "stage11-causal-bayesian",
    title: "Классификатор наиболее вероятной гипотезы отказа (Maximum A Posteriori Fault Finder)",
    description:
      "Выбор корневой причины инцидента с максимальной апостериорной вероятностью argmax_H P(H | E)",
    operationCode: "bayes_map_diagnostician",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["map_hypothesis", "map_probability", "runner_up_gap", "confidence_tier"]
  },
  {
    featureId: "F340",
    stage: "stage11-causal-bayesian",
    title: "Анализатор снижения энтропии Шеннона и прироста информации (Information Gain)",
    description:
      "Измерение в битах того, насколько собранные свидетельства уменьшили неопределённость системы",
    operationCode: "bayes_info_gain_analyzer",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "prior_entropy_bits",
      "posterior_entropy_bits",
      "information_gain_bits",
      "uncertainty_reduced"
    ]
  },
  {
    featureId: "F341",
    stage: "stage11-causal-bayesian",
    title:
      "Селектор следующего оптимального диагностического теста по максимуму взаимной информации",
    description:
      "Выбор проверки, дающей наибольшее ожидаемое сжатие энтропии апостериорного распределения",
    operationCode: "bayes_active_probe",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["candidate_probes", "expected_ig_bits", "selected_probe_id", "probe_cost_ms"]
  },
  {
    featureId: "F342",
    stage: "stage11-causal-bayesian",
    title: "Последовательный аккумулятор байесовских свидетельств в реальном времени",
    description:
      "Итеративное обновление апостериорного распределения по мере поступления телеметрии спанов",
    operationCode: "bayes_evidence_accum",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["step_count", "latest_evidence_key", "converged_hypothesis", "posterior_prob"]
  },
  {
    featureId: "F343",
    stage: "stage11-causal-bayesian",
    title: "Аудитор коэффициентов Байеса (Bayes Factor K) для проверки конкурирующих гипотез",
    description:
      "Количественная оценка силы доказательств в пользу основной гипотезы против альтернативной",
    operationCode: "bayes_factor_auditor",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["hypothesis_a", "hypothesis_b", "bayes_factor_k", "evidence_strength"]
  },
  {
    featureId: "F344",
    stage: "stage11-causal-bayesian",
    title: "Калибратор точности вероятностных прогнозов по метрике Брайера (Brier Score)",
    description: "Оценка среднеквадратичной погрешности байесовских оценок достоверности агентов",
    operationCode: "bayes_brier_evaluator",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["predictions_count", "brier_score", "calibration_error", "well_calibrated"]
  },
  {
    featureId: "F345",
    stage: "stage11-causal-bayesian",
    title: "Трекер сопряжённых априорных распределений Beta(alpha, beta) для стратегий агентов",
    description:
      "Точный аналитический учёт успешных (alpha) и неуспешных (beta) исходов без численного дрейфа",
    operationCode: "thompson_beta_tracker",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["arm_id", "alpha_param", "beta_param", "posterior_mean"]
  },
  {
    featureId: "F346",
    stage: "stage11-causal-bayesian",
    title: "Детерминированный сэмплер апостериорного распределения Томпсона (Thompson Sampler)",
    description:
      "Генерация выборок theta_i ~ Beta(alpha_i, beta_i) для оптимального баланса исследования и эксплуатации",
    operationCode: "thompson_posterior_sampler",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["candidate_arms", "sampled_thetas", "selected_arm_id", "seed_digest"]
  },
  {
    featureId: "F347",
    stage: "stage11-causal-bayesian",
    title: "Вычислитель 95% байесовских доверительных интервалов (Credible Intervals)",
    description: "Расчёт нижней и верхней границ истинной эффективности каждой агентной стратегии",
    operationCode: "thompson_credible_interval",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["arm_id", "posterior_mean", "ci_lower_95", "ci_upper_95"]
  },
  {
    featureId: "F348",
    stage: "stage11-causal-bayesian",
    title: "Оптимизатор вариантов системных промптов методом сэмплирования Томпсона",
    description:
      "Автоматическое перераспределение трафика в пользу промптов с наивысшим апостериорным качеством",
    operationCode: "thompson_prompt_optimizer",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: [
      "prompt_variants",
      "winning_variant_id",
      "conversion_lift_pct",
      "posterior_confidence"
    ]
  },
  {
    featureId: "F349",
    stage: "stage11-causal-bayesian",
    title: "Монитор накопленного байесовского сожаления (Cumulative Bayesian Regret)",
    description:
      "Контроль сходимости сэмплирования Томпсона к теоретическому логарифмическому пределу",
    operationCode: "thompson_regret_monitor",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["total_rounds", "cumulative_regret", "sublinear_verified", "optimal_arm_share"]
  },
  {
    featureId: "F350",
    stage: "stage11-causal-bayesian",
    title:
      "Механизм экспоненциального забывания для нестационарных распределенийBeta(gamma*alpha, gamma*beta)",
    description:
      "Адаптация параметров распределения при дрейфе качества или скорости внешних моделей",
    operationCode: "thompson_discounted_beta",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["discount_gamma", "decayed_alpha", "decayed_beta", "drift_adapted"]
  },
  {
    featureId: "F351",
    stage: "stage11-causal-bayesian",
    title: "Многокритериальный арбитр Томпсона (точность + задержка + стоимость)",
    description:
      "Взвешенная агрегация апостериорных выборок для выбора Парето-эффективной стратегии",
    operationCode: "thompson_pareto_arbiter",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["selected_arm_id", "composite_theta", "latency_penalty", "pareto_optimal"]
  },
  {
    featureId: "F352",
    stage: "stage11-causal-bayesian",
    title: "Комплексный сертификатор контура причинного вывода и байесовских сетей (Stage 11 Hub)",
    description:
      "Сквозная аттестация SCM do-Calculus, контрфактов, байесовских сетей и сэмплирования Томпсона",
    operationCode: "stage11_causal_certifier",
    packageDir: "packages/core/src/stage11-causal-bayesian",
    domainFields: ["ace_verified", "counterfactual_verified", "bayes_map_id", "thompson_arm_id"]
  },
  {
    featureId: "F353",
    stage: "stage12-homomorphic-vdf",
    title: "Инициализатор ключей аддитивного гомоморфного шифрования Пэйе (Paillier Keygen)",
    description:
      "Генерация модуля n = p*q, квадрата n^2, генератора g = n+1 и секретных параметров (lambda, mu)",
    operationCode: "paillier_key_init",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["public_modulus_n", "modulus_n_squared", "generator_g", "key_ready"]
  },
  {
    featureId: "F354",
    stage: "stage12-homomorphic-vdf",
    title: "Гомоморфный шифратор Пэйе c ослепляющим множителем c = g^m * r^n mod n^2",
    description:
      "Семантически стойкое шифрование числовых метрик и бюджетов в мультипликативной группе Z_{n^2}^*",
    operationCode: "paillier_encrypt",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["plaintext_value", "blinding_seed", "ciphertext_dec", "modulus_n"]
  },
  {
    featureId: "F355",
    stage: "stage12-homomorphic-vdf",
    title: "Гомоморфный сумматор зашифрованных текстов E(m1) * E(m2) mod n^2 = E(m1 + m2)",
    description:
      "Сложение приватных финансовых и телеметрических показателей разных тенантов без расшифровки",
    operationCode: "paillier_homomorphic_add",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["ciphertext_a", "ciphertext_b", "sum_ciphertext", "homomorphic_verified"]
  },
  {
    featureId: "F356",
    stage: "stage12-homomorphic-vdf",
    title: "Гомоморфный умножитель шифротекста на константу E(m)^k mod n^2 = E(k * m)",
    description:
      "Масштабирование зашифрованных оценок и весов агентов в слепом вычислительном контуре",
    operationCode: "paillier_scalar_mul",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["base_ciphertext", "scalar_factor_k", "scaled_ciphertext", "decrypted_check"]
  },
  {
    featureId: "F357",
    stage: "stage12-homomorphic-vdf",
    title: "Дешифратор Пэйе через функцию L(c^lambda mod n^2) * mu mod n",
    description:
      "Точное восстановление суммы открытых текстов уполномоченным владельцем приватного ключа",
    operationCode: "paillier_decrypt",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["ciphertext_input", "decrypted_sum", "expected_sum", "exact_match"]
  },
  {
    featureId: "F358",
    stage: "stage12-homomorphic-vdf",
    title:
      "Модуль повторного ослепления шифротекстов c' = c * r^n mod n^2 без изменения открытого текста",
    description: "Защита от корреляции шифротекстов при передаче между узлами конвейера",
    operationCode: "paillier_rerandomize",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["original_cipher", "rerandomized_cipher", "same_plaintext", "unlinkable_ok"]
  },
  {
    featureId: "F359",
    stage: "stage12-homomorphic-vdf",
    title: "Федеративный агрегатор зашифрованных KPI подразделений холдинга",
    description:
      "Вычисление консолидированного баланса компании по зашифрованным отчётам дочерних тенантов",
    operationCode: "paillier_federated_agg",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["tenant_ciphertexts", "aggregated_cipher", "decrypted_total", "zero_leakage"]
  },
  {
    featureId: "F360",
    stage: "stage12-homomorphic-vdf",
    title: "Аудитор корректности гомоморфных линейных комбинаций",
    description: "Проверка тождества D(E(m1)^a * E(m2)^b mod n^2) === a*m1 + b*m2",
    operationCode: "paillier_integrity_audit",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["linear_combo_cipher", "decrypted_result", "expected_linear_val", "audit_passed"]
  },
  {
    featureId: "F361",
    stage: "stage12-homomorphic-vdf",
    title:
      "Вычислитель функции верифицируемой задержки y = x^(2^T) mod N (Sequential Squaring VDF)",
    description:
      "Строго последовательное возведение в квадрат в группе Z_N^*, защищённое от распараллеливания",
    operationCode: "vdf_sequential_eval",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["challenge_id", "input_x", "iterations_t", "output_y"]
  },
  {
    featureId: "F362",
    stage: "stage12-homomorphic-vdf",
    title: "Генератор простого вызова Фиата-Шамира l для алгебраического доказательства VDF",
    description:
      "Детерминированный выбор простого делителя l из криптографического транскрипта H(x || y || T)",
    operationCode: "vdf_prime_challenge",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["input_x", "output_y", "iterations_t", "prime_challenge_l"]
  },
  {
    featureId: "F363",
    stage: "stage12-homomorphic-vdf",
    title: "Синтезатор компактного доказательства Весоловского pi = x^(floor(2^T / l)) mod N",
    description:
      "Построение краткого криптографического свидетельства выполненной временной работы",
    operationCode: "vdf_wesolowski_prover",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["challenge_id", "prime_l", "wesolowski_pi", "proof_ready"]
  },
  {
    featureId: "F364",
    stage: "stage12-homomorphic-vdf",
    title: "Быстрый алгебраический верификатор VDF: pi^l * x^(2^T mod l) === y (mod N)",
    description:
      "Мгновенная проверка доказательства задержки за O(log l) операций без повторения T возведений в квадрат",
    operationCode: "vdf_fast_verifier",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["challenge_id", "proof_pi", "remainder_r", "vdf_verified"]
  },
  {
    featureId: "F365",
    stage: "stage12-homomorphic-vdf",
    title: "Генератор неманипулируемого маяка случайности (Unbiasable Randomness Beacon)",
    description:
      "Использование выхода VDF для честной жеребьёвки лидеров и аудиторов без возможности подбора зерна",
    operationCode: "vdf_randomness_beacon",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["epoch_id", "vdf_output_y", "beacon_sha256", "unbiasable_verified"]
  },
  {
    featureId: "F366",
    stage: "stage12-homomorphic-vdf",
    title:
      "Криптографический тайм-лок капсулы с гарантированной задержкой открытия (Time-Lock Puzzle)",
    description:
      "Привязка ключа расшифровки к решению задачи последовательного возведения в квадрат",
    operationCode: "vdf_timelock_sealer",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["puzzle_id", "required_squarings_t", "unlock_digest", "timelock_active"]
  },
  {
    featureId: "F367",
    stage: "stage12-homomorphic-vdf",
    title: "Защитник контура управления от DDoS через доказательство последовательной задержки",
    description: "Отбраковка запросов с невалидным или поддельным доказательством Весоловского pi",
    operationCode: "vdf_antispam_gate",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["request_id", "submitted_pi", "valid_proof", "gate_passed"]
  },
  {
    featureId: "F368",
    stage: "stage12-homomorphic-vdf",
    title: "Хронологический якорь последовательности событий на базе цепочки VDF",
    description:
      "Математическое доказательство того, что событие B произошло строго после события A",
    operationCode: "vdf_timestamp_anchor",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["prev_anchor_y", "next_anchor_y", "iterations_t", "causal_order_proven"]
  },
  {
    featureId: "F369",
    stage: "stage12-homomorphic-vdf",
    title: "Эмитент корневых мандатов доступа на базе цепочечных HMAC (Capability Macaroons)",
    description: "Выпуск криптографических токенов полномочий с корневой подписью HMAC-SHA256",
    operationCode: "macaroon_root_minter",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["macaroon_id", "target_location", "caveats_count", "root_sig_hex"]
  },
  {
    featureId: "F370",
    stage: "stage12-homomorphic-vdf",
    title: "Делегирующий ограничитель полномочий макаруна (Offline Caveat Attenuation)",
    description:
      "Сужение прав токена дочернему суб-агенту (добавление условий tenant, project, op, ttl) без обращения к серверу ключей",
    operationCode: "macaroon_attenuator",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["parent_macaroon_id", "added_caveats", "attenuated_sig_hex", "delegation_safe"]
  },
  {
    featureId: "F371",
    stage: "stage12-homomorphic-vdf",
    title: "Верификатор цепочки HMAC и контекстных предикатов макаруна",
    description:
      "Одновременная проверка неизменности цепочки подписей и выполнения всех условий окружения",
    operationCode: "macaroon_verifier",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["macaroon_id", "context_attributes", "signature_valid", "predicates_satisfied"]
  },
  {
    featureId: "F372",
    stage: "stage12-homomorphic-vdf",
    title: "Детектор попыток удаления или модификации ограничений в макаруне",
    description:
      "Мгновенный отказ в доступе при попытке суб-агента отрезать добавленный caveat и повысить свои права",
    operationCode: "macaroon_tamper_detector",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["macaroon_id", "tampered_caveat_detected", "access_denied", "security_logged"]
  },
  {
    featureId: "F373",
    stage: "stage12-homomorphic-vdf",
    title: "Генератор узкоспециализированных макарунов минимальных привилегий для воркеров DAG",
    description:
      "Ограничение мандата суб-агента только конкретным артефактом, операцией и лимитом стоимости",
    operationCode: "macaroon_subagent_scope",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["worker_role", "bound_artifact_id", "max_cost_caveat", "token_verified"]
  },
  {
    featureId: "F374",
    stage: "stage12-homomorphic-vdf",
    title: "Контроллер временных ограничений жизни мандата (ttl_epoch <= limit)",
    description:
      "Автоматическая инвалидация делегированного макаруна по истечении окна выполнения узла",
    operationCode: "macaroon_ttl_enforcer",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["macaroon_id", "current_epoch", "expiry_limit", "ttl_valid"]
  },
  {
    featureId: "F375",
    stage: "stage12-homomorphic-vdf",
    title: "Связыватель макарунов с подтверждениями третьей стороны (Third-Party Caveat Discharge)",
    description:
      "Требование сопутствующего криптографического подтверждения от контура MFA или HITL",
    operationCode: "macaroon_discharge_binder",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["primary_macaroon_id", "discharge_proof_id", "bound_signature", "authorized"]
  },
  {
    featureId: "F376",
    stage: "stage12-homomorphic-vdf",
    title: "Шлюз Zero-Trust авторизации межсервисных вызовов по цепочкам макарунов",
    description:
      "Сквозная проверка делегированных полномочий между API, оркестратором, воркером и хранилищем",
    operationCode: "macaroon_mesh_guard",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["source_service", "target_service", "caveats_verified_count", "mesh_allowed"]
  },
  {
    featureId: "F377",
    stage: "stage12-homomorphic-vdf",
    title: "Калькулятор параметров византийской отказоустойчивости n >= 3f + 1 (Malkhi-Reiter BQS)",
    description:
      "Определение максимального числа скомпрометированных узлов f и размера кворума 2f + 1",
    operationCode: "bft_quorum_calculator",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["total_validators_n", "max_faulty_f", "required_quorum_2f1", "bft_feasible"]
  },
  {
    featureId: "F378",
    stage: "stage12-homomorphic-vdf",
    title: "Математический верификатор пересечения любых двух кворумов |Q1 ∩ Q2| >= f + 1",
    description:
      "Доказательство наличия минимум одного честного узла в пересечении любых двух кворумов чтения и записи",
    operationCode: "bft_intersection_prover",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: [
      "quorum_a_size",
      "quorum_b_size",
      "intersection_nodes",
      "honest_overlap_guaranteed"
    ]
  },
  {
    featureId: "F379",
    stage: "stage12-homomorphic-vdf",
    title: "Детектор двойного голосования византийских валидаторов (Equivocation Slasher)",
    description:
      "Обнаружение узлов, подписавших два противоречащих дайджеста блока в одном номере вида (view)",
    operationCode: "bft_equivocation_detector",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: [
      "inspected_votes_count",
      "equivocating_validators",
      "slashing_triggered",
      "evidence_hash"
    ]
  },
  {
    featureId: "F380",
    stage: "stage12-homomorphic-vdf",
    title: "Протокол смены вида (View-Change) при зависании или компрометации текущего лидера",
    description:
      "Детерминированный переход к следующему лидеру v+1 по кворуму из 2f + 1 подписанных жалоб",
    operationCode: "bft_view_change",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["previous_view", "next_view", "new_leader_id", "quorum_cert_hash"]
  },
  {
    featureId: "F381",
    stage: "stage12-homomorphic-vdf",
    title:
      "Генератор криптографических сертификатов наказания (Slashing Certificate) за эквивокацию",
    description:
      "Формирование неопровержимого доказательства византийского поведения узла для исключения из кластера",
    operationCode: "bft_slashing_cert",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: [
      "offending_validator",
      "conflicting_digests",
      "slashing_cert_sha256",
      "validator_evicted"
    ]
  },
  {
    featureId: "F382",
    stage: "stage12-homomorphic-vdf",
    title: "Агрегатор кворумных сертификатов фиксации состояния (2f + 1 Commit Certificate)",
    description:
      "Сборка финального криптографического подтверждения блока после прохождения фаз Prepare и Commit",
    operationCode: "bft_commit_aggregator",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["block_digest", "signers_count", "quorum_threshold", "commit_certificate"]
  },
  {
    featureId: "F383",
    stage: "stage12-homomorphic-vdf",
    title: "Верификатор контрольных точек синхронизации отстающих реплик (BFT State Transfer)",
    description:
      "Безопасная докачка состояния узлом при наличии 2f + 1 совпадающих подписей над дайджестом снапшота",
    operationCode: "bft_checkpoint_verifier",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["checkpoint_seq", "state_digest", "verified_signatures", "sync_completed"]
  },
  {
    featureId: "F384",
    stage: "stage12-homomorphic-vdf",
    title: "Финальный сертификатор полной 12-этапной архитектуры Kosmora (384 модуля: F001–F384)",
    description:
      "Полная сквозная проверка всех 12 этапов (F001–F384) с гомоморфным шифрованием, VDF, макарунами и BFT-кворумом",
    operationCode: "kosmora_384_master_certifier",
    packageDir: "packages/core/src/stage12-homomorphic-vdf",
    domainFields: ["total_modules_384", "paillier_verified", "vdf_verified", "bft_quorum_verified"]
  },
  {
    featureId: "F385",
    stage: "stage13-neurosymbolic-sat",
    title: "StratifiedDatalogFixpointEvaluator",
    description:
      "Evaluating bottom-up semi-naive stratified Datalog fixed-point closure with negation-as-failure and proof lineage trees",
    operationCode: "F385_STRATIFIED_DATALOG_FIXPOINT_EVALUATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["rules_spec", "seed_facts", "query_predicate", "max_strata"]
  },
  {
    featureId: "F386",
    stage: "stage13-neurosymbolic-sat",
    title: "DpllBooleanSatUnitPropagator",
    description:
      "Solving exact CNF Boolean Satisfiability via Davis-Putnam-Logemann-Loveland (DPLL) with iterative unit propagation",
    operationCode: "F386_DPLL_BOOLEAN_SAT_UNIT_PROPAGATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["cnf_clauses", "num_variables", "decision_heuristic", "conflict_limit"]
  },
  {
    featureId: "F387",
    stage: "stage13-neurosymbolic-sat",
    title: "RobinsonFirstOrderUnificationEngine",
    description:
      "Computing Most General Unifier (MGU) over recursive first-order algebraic terms with strict occurs-check cycle detection",
    operationCode: "F387_ROBINSON_FIRST_ORDER_UNIFICATION_ENGINE",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["left_term", "right_term", "variable_prefix", "occurs_check_mode"]
  },
  {
    featureId: "F388",
    stage: "stage13-neurosymbolic-sat",
    title: "DeonticPolicyConflictVerifier",
    description:
      "Detecting Obligation vs Prohibition deontic modality contradictions and subsumption redundancies across policy rules",
    operationCode: "F388_DEONTIC_POLICY_CONFLICT_VERIFIER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["policy_rules", "context_facts", "modality_hierarchy", "resolution_strategy"]
  },
  {
    featureId: "F389",
    stage: "stage13-neurosymbolic-sat",
    title: "HornClauseForwardChainingReasoner",
    description:
      "Executing forward-chaining modus ponens over definite Horn clauses with cycle-free derivation step indexing",
    operationCode: "F389_HORN_CLAUSE_FORWARD_CHAINING_REASONER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["horn_rules", "initial_assertions", "goal_atom", "derivation_depth_cap"]
  },
  {
    featureId: "F390",
    stage: "stage13-neurosymbolic-sat",
    title: "PureLiteralEliminationSatReducer",
    description:
      "Eliminating single-polarity pure literals and tautological clauses prior to DPLL branching search",
    operationCode: "F390_PURE_LITERAL_ELIMINATION_SAT_REDUCER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["cnf_formula", "polarity_watch_list", "simplification_passes", "preserve_models"]
  },
  {
    featureId: "F391",
    stage: "stage13-neurosymbolic-sat",
    title: "NeurosymbolicConstraintLossProjector",
    description:
      "Projecting neural token scores onto satisfying assignments of hard symbolic CNF invariants",
    operationCode: "F391_NEUROSYMBOLIC_CONSTRAINT_LOSS_PROJECTOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "neural_logits",
      "symbolic_cnf_constraints",
      "temperature_tau",
      "projection_norm"
    ]
  },
  {
    featureId: "F392",
    stage: "stage13-neurosymbolic-sat",
    title: "DatalogNegationAsFailureStratifier",
    description:
      "Computing strongly connected predicate dependency components to verify safe stratification of negated body atoms",
    operationCode: "F392_DATALOG_NEGATION_AS_FAILURE_STRATIFIER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "program_rules",
      "negated_predicates",
      "dependency_graph",
      "strict_stratification"
    ]
  },
  {
    featureId: "F393",
    stage: "stage13-neurosymbolic-sat",
    title: "SmtLinearIntegerBoundChecker",
    description:
      "Propagating interval bound constraints and Fourier-Motzkin integer bounds coupled with SAT boolean guards",
    operationCode: "F393_SMT_LINEAR_INTEGER_BOUND_CHECKER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["linear_inequalities", "integer_bounds", "variable_domains", "tightening_rounds"]
  },
  {
    featureId: "F394",
    stage: "stage13-neurosymbolic-sat",
    title: "AbductiveHypothesisMinimalHittingSet",
    description:
      "Computing minimal cardinality abductive explanation hypotheses that entail observed diagnostic symptoms",
    operationCode: "F394_ABDUCTIVE_HYPOTHESIS_MINIMAL_HITTING_SET",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["observations", "background_rules", "candidate_abducibles", "parsimony_weight"]
  },
  {
    featureId: "F395",
    stage: "stage13-neurosymbolic-sat",
    title: "EquationalTermRewritingNormalizer",
    description:
      "Reducing algebraic expressions to canonical normal form via orientable Knuth-Bendix style rewrite steps",
    operationCode: "F395_EQUATIONAL_TERM_REWRITING_NORMALIZER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["rewrite_rules", "input_term", "reduction_order", "max_rewrite_steps"]
  },
  {
    featureId: "F396",
    stage: "stage13-neurosymbolic-sat",
    title: "DefeasibleArgumentationExtensionSolver",
    description:
      "Computing grounded and preferred Dung abstract argumentation extensions over conflicting agent claims",
    operationCode: "F396_DEFEASIBLE_ARGUMENTATION_EXTENSION_SOLVER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["arguments_set", "attack_relations", "semantics_mode", "preference_weights"]
  },
  {
    featureId: "F397",
    stage: "stage13-neurosymbolic-sat",
    title: "OntologiesSubsumptionLatticeClassifier",
    description:
      "Materializing transitive concept subsumption hierarchy and disjointness conflicts in description logic",
    operationCode: "F397_ONTOLOGIES_SUBSUMPTION_LATTICE_CLASSIFIER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["concept_axioms", "role_hierarchy", "instance_assertions", "closure_depth"]
  },
  {
    featureId: "F398",
    stage: "stage13-neurosymbolic-sat",
    title: "SymbolicProgramPreconditionWeakestCalc",
    description:
      "Calculating Dijkstra weakest liberal preconditions backwards across guarded command statements",
    operationCode: "F398_SYMBOLIC_PROGRAM_PRECONDITION_WEAKEST_CALC",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "postcondition_formula",
      "statement_ast",
      "loop_invariants",
      "verification_scope"
    ]
  },
  {
    featureId: "F399",
    stage: "stage13-neurosymbolic-sat",
    title: "UnsatCoreMinimalClauseExtractor",
    description:
      "Isolating minimal unsatisfiable subformulas (MUS) responsible for policy or specification contradiction",
    operationCode: "F399_UNSAT_CORE_MINIMAL_CLAUSE_EXTRACTOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "unsat_cnf_clauses",
      "clause_labels",
      "deletion_probe_order",
      "proof_trace_enabled"
    ]
  },
  {
    featureId: "F400",
    stage: "stage13-neurosymbolic-sat",
    title: "KnowledgeGraphConjunctiveQueryPlanner",
    description:
      "Optimizing multi-pattern conjunctive Datalog queries over relational fact tables with selectivity estimation",
    operationCode: "F400_KNOWLEDGE_GRAPH_CONJUNCTIVE_QUERY_PLANNER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "conjunctive_atoms",
      "relation_cardinalities",
      "join_ordering_policy",
      "projection_vars"
    ]
  },
  {
    featureId: "F401",
    stage: "stage13-neurosymbolic-sat",
    title: "ModalEpistemicKripkeFrameValidator",
    description:
      "Evaluating multi-agent epistemic knowledge and belief formulas across Kripke possible-world accessibility frames",
    operationCode: "F401_MODAL_EPISTEMIC_KRIPKE_FRAME_VALIDATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["kripke_worlds", "accessibility_edges", "valuation_map", "modal_formula"]
  },
  {
    featureId: "F402",
    stage: "stage13-neurosymbolic-sat",
    title: "SymbolicGuardrailActionMaskSynthesizer",
    description:
      "Synthesizing deterministic boolean action masks that block tool invocations violating symbolic safety theorems",
    operationCode: "F402_SYMBOLIC_GUARDRAIL_ACTION_MASK_SYNTHESIZER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "candidate_tool_calls",
      "safety_datalog_rules",
      "state_predicates",
      "fallback_action"
    ]
  },
  {
    featureId: "F403",
    stage: "stage13-neurosymbolic-sat",
    title: "MaxsatWeightedSoftClauseOptimizer",
    description:
      "Solving partial weighted MaxSAT to maximize satisfied soft preferences while strictly enforcing hard invariants",
    operationCode: "F403_MAXSAT_WEIGHTED_SOFT_CLAUSE_OPTIMIZER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "hard_clauses",
      "weighted_soft_clauses",
      "branch_and_bound_limit",
      "initial_assignment"
    ]
  },
  {
    featureId: "F404",
    stage: "stage13-neurosymbolic-sat",
    title: "TemporalIntervalAllenAlgebraPropagator",
    description:
      "Propagating Allen interval algebra constraints (before, meets, overlaps, during) for consistent schedule synthesis",
    operationCode: "F404_TEMPORAL_INTERVAL_ALLEN_ALGEBRA_PROPAGATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "interval_nodes",
      "allen_relations",
      "composition_table_mode",
      "consistency_check"
    ]
  },
  {
    featureId: "F405",
    stage: "stage13-neurosymbolic-sat",
    title: "AntiUnificationLeastGeneralGeneralizer",
    description:
      "Computing Plotkin least general generalization (LGG) of symbolic terms for inductive rule learning",
    operationCode: "F405_ANTI_UNIFICATION_LEAST_GENERAL_GENERALIZER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["term_pair_left", "term_pair_right", "generalization_vars", "type_lattice"]
  },
  {
    featureId: "F406",
    stage: "stage13-neurosymbolic-sat",
    title: "AccessControlDatalogDelegationProver",
    description:
      "Verifying distributed authorization credentials via Binder/SecPAL style Datalog proof trees",
    operationCode: "F406_ACCESS_CONTROL_DATALOG_DELEGATION_PROVER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["delegation_certs", "principal_facts", "requested_resource", "trust_root_set"]
  },
  {
    featureId: "F407",
    stage: "stage13-neurosymbolic-sat",
    title: "PropositionalModelCounterSharpSat",
    description:
      "Counting exact satisfying boolean assignments (#SAT) to quantify symbolic policy solution space",
    operationCode: "F407_PROPOSITIONAL_MODEL_COUNTER_SHARP_SAT",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["cnf_clauses", "variable_count", "component_partitioning", "exact_probability"]
  },
  {
    featureId: "F408",
    stage: "stage13-neurosymbolic-sat",
    title: "InductiveLogicRuleSpecializationSearch",
    description:
      "Refining Horn clause hypotheses top-down using information-gain heuristics to cover positive examples and exclude negatives",
    operationCode: "F408_INDUCTIVE_LOGIC_RULE_SPECIALIZATION_SEARCH",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "positive_examples",
      "negative_examples",
      "background_predicates",
      "foil_gain_threshold"
    ]
  },
  {
    featureId: "F409",
    stage: "stage13-neurosymbolic-sat",
    title: "ConstraintHandlingRulesChrStore",
    description:
      "Executing committed-choice Constraint Handling Rules (CHR) simplification and propagation transitions",
    operationCode: "F409_CONSTRAINT_HANDLING_RULES_CHR_STORE",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "chr_simplification_rules",
      "chr_propagation_rules",
      "initial_constraint_store",
      "max_firings"
    ]
  },
  {
    featureId: "F410",
    stage: "stage13-neurosymbolic-sat",
    title: "SortedManyValuedLogicEvaluator",
    description:
      "Evaluating Gödel and Łukasiewicz continuous truth degrees for fuzzy-symbolic hybrid rule bases",
    operationCode: "F410_SORTED_MANY_VALUED_LOGIC_EVALUATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "lukasiewicz_clauses",
      "truth_degree_map",
      "t_norm_operator",
      "designated_threshold"
    ]
  },
  {
    featureId: "F411",
    stage: "stage13-neurosymbolic-sat",
    title: "SymbolicPlanCausalLinkThreatResolver",
    description:
      "Resolving clobbering threats in partial-order symbolic plans via promotion or demotion ordering constraints",
    operationCode: "F411_SYMBOLIC_PLAN_CAUSAL_LINK_THREAT_RESOLVER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "partial_order_steps",
      "causal_links",
      "ordering_constraints",
      "threat_promotion_policy"
    ]
  },
  {
    featureId: "F412",
    stage: "stage13-neurosymbolic-sat",
    title: "SymmetryBreakingPredicateGenerator",
    description:
      "Generating lexicographic-leader symmetry breaking clauses to prune isomorphic SAT search branches",
    operationCode: "F412_SYMMETRY_BREAKING_PREDICATE_GENERATOR",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["cnf_clauses", "automorphism_orbits", "lex_leader_vars", "max_predicates"]
  },
  {
    featureId: "F413",
    stage: "stage13-neurosymbolic-sat",
    title: "AnswerSetProgrammingStableModelFinder",
    description:
      "Computing Gelfond-Lifschitz reducts to verify stable models of non-monotonic Answer Set Programs",
    operationCode: "F413_ANSWER_SET_PROGRAMMING_STABLE_MODEL_FINDER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["asp_rules", "default_negation_atoms", "choice_rules", "integrity_constraints"]
  },
  {
    featureId: "F414",
    stage: "stage13-neurosymbolic-sat",
    title: "LinearLogicResourceConsumptionChecker",
    description:
      "Verifying single-use resource consumption invariants under multiplicative-additive Girard linear logic",
    operationCode: "F414_LINEAR_LOGIC_RESOURCE_CONSUMPTION_CHECKER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["linear_hypotheses", "lollipop_rules", "target_multiset", "exponential_bang_set"]
  },
  {
    featureId: "F415",
    stage: "stage13-neurosymbolic-sat",
    title: "ProofCarryingCodeCertificateChecker",
    description:
      "Validating compact resolution refutation proof certificates in linear time with SHA-256 step commitments",
    operationCode: "F415_PROOF_CARRYING_CODE_CERTIFICATE_CHECKER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: ["resolution_steps", "axiom_clauses", "target_theorem", "hash_chain_seed"]
  },
  {
    featureId: "F416",
    stage: "stage13-neurosymbolic-sat",
    title: "NeurosymbolicVerificationAuditLedger",
    description:
      "Sealing neurosymbolic Datalog derivations, SAT models, MGU substitutions, and deontic verdicts into an immutable ledger",
    operationCode: "F416_NEUROSYMBOLIC_VERIFICATION_AUDIT_LEDGER",
    packageDir: "packages/core/src/stage13-neurosymbolic-sat",
    domainFields: [
      "datalog_digest",
      "sat_witness_hash",
      "unification_mgu_digest",
      "deontic_verdict"
    ]
  },
  {
    featureId: "F417",
    stage: "stage14-cybernetic-control",
    title: "DiscretePidAntiWindupController",
    description:
      "Simulating discrete-time Proportional-Integral-Derivative (PID) closed-loop control with actuator clamping and back-calculation anti-windup",
    operationCode: "F417_DISCRETE_PID_ANTI_WINDUP_CONTROLLER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["setpoint", "kp_gain", "ki_gain", "kd_gain"]
  },
  {
    featureId: "F418",
    stage: "stage14-cybernetic-control",
    title: "KalmanFilterStateCovarianceEstimator",
    description:
      "Executing optimal discrete Kalman predict-and-update state estimation with Joseph-form error covariance convergence",
    operationCode: "F418_KALMAN_FILTER_STATE_COVARIANCE_ESTIMATOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "noisy_measurements",
      "process_noise_q",
      "measurement_noise_r",
      "initial_state_x0"
    ]
  },
  {
    featureId: "F419",
    stage: "stage14-cybernetic-control",
    title: "GraphLaplacianFiedlerConnectivityAnalyzer",
    description:
      "Computing graph Laplacian matrix L = D - A, algebraic connectivity Fiedler value lambda_2, and Cheeger spectral bisection",
    operationCode: "F419_GRAPH_LAPLACIAN_FIEDLER_CONNECTIVITY_ANALYZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["node_ids", "weighted_edges", "power_iterations", "partition_threshold"]
  },
  {
    featureId: "F420",
    stage: "stage14-cybernetic-control",
    title: "SubmodularGreedyCoverageMaximizer",
    description:
      "Maximizing monotone submodular coverage under cardinality constraints with (1 - 1/e) Nemhauser-Wolsey approximation guarantee",
    operationCode: "F420_SUBMODULAR_GREEDY_COVERAGE_MAXIMIZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "candidate_elements",
      "cardinality_budget_k",
      "element_weights",
      "marginal_gain_floor"
    ]
  },
  {
    featureId: "F421",
    stage: "stage14-cybernetic-control",
    title: "ModelPredictiveControlRecedingHorizon",
    description:
      "Solving finite-horizon receding-horizon quadratic control trajectories subject to state and input saturation bounds",
    operationCode: "F421_MODEL_PREDICTIVE_CONTROL_RECEDING_HORIZON",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "prediction_horizon_n",
      "state_reference_trajectory",
      "control_effort_weight_r",
      "actuator_limits"
    ]
  },
  {
    featureId: "F422",
    stage: "stage14-cybernetic-control",
    title: "LyapunovQuadraticStabilityCertifier",
    description:
      "Verifying asymptotic stability of autonomous dynamical loops via discrete Stein / Lyapunov energy decrease certificates",
    operationCode: "F422_LYAPUNOV_QUADRATIC_STABILITY_CERTIFIER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "system_matrix_a",
      "candidate_lyapunov_p",
      "decay_rate_margin",
      "discrete_time_mode"
    ]
  },
  {
    featureId: "F423",
    stage: "stage14-cybernetic-control",
    title: "LinearQuadraticRegulatorRiccatiSolver",
    description:
      "Iterating the discrete-time Algebraic Riccati Equation (DARE) to synthesize optimal state-feedback gain K",
    operationCode: "F423_LINEAR_QUADRATIC_REGULATOR_RICCATI_SOLVER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["state_transition_a", "control_input_b", "state_cost_q", "control_cost_r"]
  },
  {
    featureId: "F424",
    stage: "stage14-cybernetic-control",
    title: "SlidingModeRobustSwitchingController",
    description:
      "Enforcing finite-time convergence onto a sliding manifold with boundary-layer saturation to suppress chattering",
    operationCode: "F424_SLIDING_MODE_ROBUST_SWITCHING_CONTROLLER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "sliding_surface_slope",
      "boundary_layer_phi",
      "switching_gain_eta",
      "tracking_error_vector"
    ]
  },
  {
    featureId: "F425",
    stage: "stage14-cybernetic-control",
    title: "ExtendedKalmanJacobianLinearizer",
    description:
      "Propagating first-order Taylor linearized state transitions and measurement Jacobians for nonlinear sensor fusion",
    operationCode: "F425_EXTENDED_KALMAN_JACOBIAN_LINEARIZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "nonlinear_state_fn",
      "jacobian_f_matrix",
      "innovation_sequence",
      "covariance_p_prior"
    ]
  },
  {
    featureId: "F426",
    stage: "stage14-cybernetic-control",
    title: "LuenbergerStateObserverPolePlacer",
    description:
      "Synthesizing deterministic Luenberger observer injection gains for asymptotic state estimation error decay",
    operationCode: "F426_LUENBERGER_STATE_OBSERVER_POLE_PLACER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "system_matrix_a",
      "output_matrix_c",
      "desired_observer_poles",
      "measurement_residuals"
    ]
  },
  {
    featureId: "F427",
    stage: "stage14-cybernetic-control",
    title: "HInfinityDisturbanceAttenuationFilter",
    description:
      "Bounding worst-case energy gain from exogenous adversarial disturbances to regulated performance outputs",
    operationCode: "F427_H_INFINITY_DISTURBANCE_ATTENUATION_FILTER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "disturbance_gamma_bound",
      "plant_transfer_params",
      "worst_case_noise_energy",
      "robustness_weight"
    ]
  },
  {
    featureId: "F428",
    stage: "stage14-cybernetic-control",
    title: "AdaptiveMitRuleGainScheduler",
    description:
      "Adjusting controller parameters online via sensitivity-derivative MIT rule model-reference adaptive control",
    operationCode: "F428_ADAPTIVE_MIT_RULE_GAIN_SCHEDULER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "reference_model_output",
      "plant_actual_output",
      "adaptation_rate_gamma",
      "gain_bounds"
    ]
  },
  {
    featureId: "F429",
    stage: "stage14-cybernetic-control",
    title: "CusumSequentialChangepointDetector",
    description:
      "Running Page cumulative sum (CUSUM) sequential log-likelihood ratio tests for rapid regime drift detection",
    operationCode: "F429_CUSUM_SEQUENTIAL_CHANGEPOINT_DETECTOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "observation_stream",
      "target_mean_mu0",
      "allowance_slack_k",
      "alarm_threshold_h"
    ]
  },
  {
    featureId: "F430",
    stage: "stage14-cybernetic-control",
    title: "SmithPredictorDeadTimeCompensator",
    description:
      "Compensating pure transport delay in feedback telemetry loops using an internal delay-free plant predictor",
    operationCode: "F430_SMITH_PREDICTOR_DEAD_TIME_COMPENSATOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "transport_delay_steps",
      "internal_model_gain",
      "internal_model_tau",
      "loop_setpoint"
    ]
  },
  {
    featureId: "F431",
    stage: "stage14-cybernetic-control",
    title: "CascadeDualLoopPidCoordinator",
    description:
      "Coordinating fast inner actuator disturbance rejection with slow outer trajectory regulation in cascade PID loops",
    operationCode: "F431_CASCADE_DUAL_LOOP_PID_COORDINATOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["outer_master_setpoint", "inner_slave_feedback", "outer_kp_ki", "inner_kp_ki"]
  },
  {
    featureId: "F432",
    stage: "stage14-cybernetic-control",
    title: "AllanVarianceSensorNoiseCharacterizer",
    description:
      "Computing overlapping Allan deviation curves across averaging times tau to separate white noise from bias instability",
    operationCode: "F432_ALLAN_VARIANCE_SENSOR_NOISE_CHARACTERIZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "timeseries_samples",
      "cluster_tau_lengths",
      "sampling_period_dt",
      "drift_fit_mode"
    ]
  },
  {
    featureId: "F433",
    stage: "stage14-cybernetic-control",
    title: "AlphaBetaGammaKinematicTracker",
    description:
      "Tracking position, velocity, and acceleration kinematics with fixed-gain steady-state polynomial filtering",
    operationCode: "F433_ALPHA_BETA_GAMMA_KINEMATIC_TRACKER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["position_observations", "alpha_gain", "beta_gain", "gamma_gain"]
  },
  {
    featureId: "F434",
    stage: "stage14-cybernetic-control",
    title: "ConsensusOlfatiSaberFlockingProtocol",
    description:
      "Driving multi-agent distributed state values to average consensus via iterative Laplacian neighbor averaging",
    operationCode: "F434_CONSENSUS_OLFATI_SABER_FLOCKING_PROTOCOL",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "agent_states_initial",
      "laplacian_weights",
      "step_size_epsilon",
      "consensus_rounds"
    ]
  },
  {
    featureId: "F435",
    stage: "stage14-cybernetic-control",
    title: "EffectiveResistanceKirchhoffIndexCalc",
    description:
      "Calculating Moore-Penrose Laplacian pseudoinverse L+ to measure pairwise effective electrical resistance and Kirchhoff robustness",
    operationCode: "F435_EFFECTIVE_RESISTANCE_KIRCHHOFF_INDEX_CALC",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["graph_nodes", "conductance_edges", "source_sink_pairs", "pseudoinverse_tol"]
  },
  {
    featureId: "F436",
    stage: "stage14-cybernetic-control",
    title: "MarkovMixingTimeSpectralGapEstimator",
    description:
      "Estimating random walk mixing time and relaxation time from the normalized Laplacian spectral gap",
    operationCode: "F436_MARKOV_MIXING_TIME_SPECTRAL_GAP_ESTIMATOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "transition_edges",
      "lazy_walk_alpha",
      "target_total_variation",
      "max_power_steps"
    ]
  },
  {
    featureId: "F437",
    stage: "stage14-cybernetic-control",
    title: "CheegerConductanceBottleneckPartitioner",
    description:
      "Performing spectral sweep cuts along the Fiedler ordering to identify minimum-conductance network bottlenecks",
    operationCode: "F437_CHEEGER_CONDUCTANCE_BOTTLENECK_PARTITIONER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "fiedler_eigenvector",
      "adjacency_matrix",
      "degree_vector",
      "sweep_cut_granularity"
    ]
  },
  {
    featureId: "F438",
    stage: "stage14-cybernetic-control",
    title: "SubmodularKnapsackCostEffectiveGreedy",
    description:
      "Executing Leskovec CELF cost-effective lazy forward selection comparing uniform and benefit-cost ratio greedy passes",
    operationCode: "F438_SUBMODULAR_KNAPSACK_COST_EFFECTIVE_GREEDY",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["candidate_items", "knapsack_budget_b", "item_costs", "utility_universe"]
  },
  {
    featureId: "F439",
    stage: "stage14-cybernetic-control",
    title: "FacilityLocationKMedoidsSubmodular",
    description:
      "Selecting k representative cluster medoids by maximizing monotone submodular facility-location similarity",
    operationCode: "F439_FACILITY_LOCATION_K_MEDOIDS_SUBMODULAR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["client_nodes", "facility_candidates", "affinity_matrix", "open_facilities_k"]
  },
  {
    featureId: "F440",
    stage: "stage14-cybernetic-control",
    title: "DOptimalExperimentalDesignSelector",
    description:
      "Maximizing log-determinant log det(I + V^T V) of Fisher information matrices via greedy submodular sensor placement",
    operationCode: "F440_D_OPTIMAL_EXPERIMENTAL_DESIGN_SELECTOR",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "candidate_feature_rows",
      "selection_budget_k",
      "regularization_lambda",
      "determinant_log_mode"
    ]
  },
  {
    featureId: "F441",
    stage: "stage14-cybernetic-control",
    title: "TokenBucketLeakyShaperCalculus",
    description:
      "Computing network-calculus arrival and service curves to bound worst-case backlog and queuing delay",
    operationCode: "F441_TOKEN_BUCKET_LEAKY_SHAPER_CALCULUS",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["Committed_rate_cir", "burst_size_cbs", "arrival_packet_bursts", "horizon_ticks"]
  },
  {
    featureId: "F442",
    stage: "stage14-cybernetic-control",
    title: "AimdCongestionWindowFairnessController",
    description:
      "Simulating Chiu-Jain Additive-Increase Multiplicative-Decrease (AIMD) control to converge toward Jain fairness index 1.0",
    operationCode: "F442_AIMD_CONGESTION_WINDOW_FAIRNESS_CONTROLLER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "flow_rates_initial",
      "link_capacity_c",
      "additive_increase_alpha",
      "multiplicative_decrease_beta"
    ]
  },
  {
    featureId: "F443",
    stage: "stage14-cybernetic-control",
    title: "LittleLawQueuingOccupancyStabilizer",
    description:
      "Regulating M/M/c worker pool concurrency and admission control using Little's Law L = lambda * W",
    operationCode: "F443_LITTLE_LAW_QUEUING_OCCUPANCY_STABILIZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "arrival_rate_lambda",
      "service_rate_mu",
      "server_count_c",
      "target_sojourn_time"
    ]
  },
  {
    featureId: "F444",
    stage: "stage14-cybernetic-control",
    title: "NyquistGainPhaseMarginAnalyzer",
    description:
      "Evaluating open-loop frequency response magnitude and phase crossover margins to guard against oscillatory instability",
    operationCode: "F444_NYQUIST_GAIN_PHASE_MARGIN_ANALYZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "open_loop_gain",
      "dominant_time_constant",
      "loop_delay_tau",
      "frequency_grid_points"
    ]
  },
  {
    featureId: "F445",
    stage: "stage14-cybernetic-control",
    title: "DiscreteDeadbeatSettlingSynthesizer",
    description:
      "Designing discrete-time deadbeat control laws that drive tracking error to zero in minimum finite sampling steps",
    operationCode: "F445_DEADBEAT_FINITE_STEP_SETTLING_SYNTHESIZER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "plant_impulse_coeffs",
      "sample_period_ts",
      "target_settling_steps",
      "control_saturation"
    ]
  },
  {
    featureId: "F446",
    stage: "stage14-cybernetic-control",
    title: "PontryaginBangBangMinimumTimePlanner",
    description:
      "Computing time-optimal double-integrator switching curves under Pontryagin Maximum Principle bounded thrust",
    operationCode: "F446_PONTRYAGIN_BANG_BANG_MINIMUM_TIME_PLANNER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: ["initial_position", "initial_velocity", "max_acceleration_u", "target_origin"]
  },
  {
    featureId: "F447",
    stage: "stage14-cybernetic-control",
    title: "VectorLyapunovDecentralizedInterconnect",
    description:
      "Verifying large-scale interconnected subsystem stability via M-matrix diagonal dominance of vector Lyapunov functions",
    operationCode: "F447_VECTOR_LYAPUNOV_DECENTRALIZED_INTERCONNECT",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "subsystem_gains",
      "interconnection_matrix_m",
      "metzler_check",
      "stability_tolerance"
    ]
  },
  {
    featureId: "F448",
    stage: "stage14-cybernetic-control",
    title: "CyberneticControlStabilityAuditLedger",
    description:
      "Sealing PID anti-windup metrics, Kalman filter covariance traces, Laplacian Fiedler eigenvalues, and submodular bounds",
    operationCode: "F448_CYBERNETIC_CONTROL_STABILITY_AUDIT_LEDGER",
    packageDir: "packages/core/src/stage14-cybernetic-control",
    domainFields: [
      "pid_settling_digest",
      "kalman_gain_hash",
      "fiedler_lambda2_digest",
      "submodular_bound_verdict"
    ]
  },
  {
    featureId: "F449",
    stage: "stage15-topological-persistence",
    title: "VietorisRipsSimplicialComplexBuilder",
    description:
      "Constructing Vietoris-Rips simplicial complexes (0-vertices, 1-edges, 2-triangles) from metric point clouds",
    operationCode: "F449_VIETORIS_RIPS_SIMPLICIAL_COMPLEX_BUILDER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["point_cloud_coords", "filtration_epsilon", "max_simplex_dim", "metric_space"]
  },
  {
    featureId: "F450",
    stage: "stage15-topological-persistence",
    title: "Gf2BoundaryMatrixGaussianRankSolver",
    description:
      "Computing exact rank of simplicial boundary operators del_1 and del_2 over GF(2) via Gaussian elimination",
    operationCode: "F450_GF2_BOUNDARY_MATRIX_GAUSSIAN_RANK_SOLVER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["boundary_matrix_b1", "boundary_matrix_b2", "field_modulus_p", "pivot_strategy"]
  },
  {
    featureId: "F451",
    stage: "stage15-topological-persistence",
    title: "TopologicalBettiNumberHomologyExtractor",
    description:
      "Calculating Betti numbers beta_0 (connected components) and beta_1 (1D topological cycles/holes)",
    operationCode: "F451_TOPOLOGICAL_BETTI_NUMBER_HOMOLOGY_EXTRACTOR",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["simplicial_complex", "betti_0_target", "betti_1_target", "homology_coeff"]
  },
  {
    featureId: "F452",
    stage: "stage15-topological-persistence",
    title: "EulerPoincareCharacteristicInvariantProver",
    description:
      "Verifying the Euler-Poincare topological invariance theorem chi = V - E + F = beta_0 - beta_1 + beta_2",
    operationCode: "F452_EULER_POINCARE_CHARACTERISTIC_INVARIANT_PROVER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["vertices_count_v", "edges_count_e", "faces_count_f", "alternating_betti_sum"]
  },
  {
    featureId: "F453",
    stage: "stage15-topological-persistence",
    title: "NerveComplexOpenCoverIntersectionMapper",
    description:
      "Building the Cech/Nerve simplicial complex of overlapping knowledge clusters under the Nerve Theorem",
    operationCode: "F453_NERVE_COMPLEX_OPEN_COVER_INTERSECTION_MAPPER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "cover_subsets",
      "intersection_threshold",
      "simplex_nerve_nodes",
      "homotopy_check"
    ]
  },
  {
    featureId: "F454",
    stage: "stage15-topological-persistence",
    title: "SimplicialCliqueComplexFlagExpander",
    description:
      "Expanding 1-skeleton graphs into flag/clique complexes by enumerating all k-cliques",
    operationCode: "F454_SIMPLICIAL_CLIQUE_COMPLEX_FLAG_EXPANDER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "one_skeleton_edges",
      "max_clique_k",
      "triangles_materialized",
      "tetrahedra_count"
    ]
  },
  {
    featureId: "F455",
    stage: "stage15-topological-persistence",
    title: "CohomologyCocycleObstructionDetector",
    description:
      "Detecting cohomological obstructions to merging local multi-agent consensus states into a global section",
    operationCode: "F455_COHOMOLOGY_COCYCLE_OBSTRUCTION_DETECTOR",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["coboundary_matrix", "local_sections", "global_consistency", "obstruction_class"]
  },
  {
    featureId: "F456",
    stage: "stage15-topological-persistence",
    title: "SimplicialComplexHomotopyCollapseReducer",
    description:
      "Performing Whitehead elementary simplicial collapses to shrink complexes while preserving homotopy type",
    operationCode: "F456_SIMPLICIAL_COMPLEX_HOMOTOPY_COLLAPSE_REDUCER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["free_faces_list", "elementary_collapses", "core_subcomplex", "betti_preserved"]
  },
  {
    featureId: "F457",
    stage: "stage15-topological-persistence",
    title: "PersistentHomologyFiltrationBarcodeGenerator",
    description:
      "Generating multi-scale persistent homology birth-death barcodes [eps_birth, eps_death) across filtration scales",
    operationCode: "F457_PERSISTENT_HOMOLOGY_FILTRATION_BARCODE_GENERATOR",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["filtration_steps", "elder_rule_pairing", "h0_bars", "h1_bars"]
  },
  {
    featureId: "F458",
    stage: "stage15-topological-persistence",
    title: "ElderRuleUnionFindPersistenceTracker",
    description:
      "Tracking 0-dimensional topological component merges with strict Elder Rule persistence pairing",
    operationCode: "F458_ELDER_RULE_UNION_FIND_PERSISTENCE_TRACKER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "vertex_birth_times",
      "sorted_edge_weights",
      "component_mergers",
      "immortal_classes"
    ]
  },
  {
    featureId: "F459",
    stage: "stage15-topological-persistence",
    title: "PersistenceDiagramWassersteinDistanceMetric",
    description:
      "Computing p-Wasserstein optimal transport distance between persistence diagrams with diagonal matching",
    operationCode: "F459_PERSISTENCE_DIAGRAM_WASSERSTEIN_DISTANCE_METRIC",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "diagram_alpha",
      "diagram_beta",
      "wasserstein_exponent_p",
      "diagonal_projections"
    ]
  },
  {
    featureId: "F460",
    stage: "stage15-topological-persistence",
    title: "PersistenceBottleneckStabilityCertifier",
    description:
      "Verifying Cohen-Steiner-Edelsbrunner-Harer bottleneck stability of persistence diagrams under input noise",
    operationCode: "F460_PERSISTENCE_BOTTLENECK_STABILITY_CERTIFIER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "baseline_barcode",
      "perturbed_barcode",
      "hausdorff_perturbation",
      "linf_bottleneck_dist"
    ]
  },
  {
    featureId: "F461",
    stage: "stage15-topological-persistence",
    title: "PersistentEntropyTopologicalComplexityIndex",
    description:
      "Calculating normalized Shannon persistent entropy over barcode interval lifetimes",
    operationCode: "F461_PERSISTENT_ENTROPY_TOPOLOGICAL_COMPLEXITY_INDEX",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "barcode_lifetimes",
      "total_persistence_sum",
      "shannon_entropy_bits",
      "noise_cutoff"
    ]
  },
  {
    featureId: "F462",
    stage: "stage15-topological-persistence",
    title: "PersistenceLandscapeBanachSpaceVectorizer",
    description:
      "Transforming persistence diagrams into piecewise-linear Bubenik persistence landscapes for statistical fusion",
    operationCode: "F462_PERSISTENCE_LANDSCAPE_BANACH_SPACE_VECTORIZER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["birth_death_pairs", "landscape_layers_k", "grid_resolution", "l2_hilbert_norm"]
  },
  {
    featureId: "F463",
    stage: "stage15-topological-persistence",
    title: "TopologicalCycleGeneratorLoopLocalizer",
    description:
      "Localizing minimal representative 1-cycles around high-persistence topological cavities in knowledge graphs",
    operationCode: "F463_TOPOLOGICAL_CYCLE_GENERATOR_LOOP_LOCALIZER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "closing_edge",
      "spanning_tree_parents",
      "fundamental_cycle_nodes",
      "persistence_span"
    ]
  },
  {
    featureId: "F464",
    stage: "stage15-topological-persistence",
    title: "ZigzagPersistenceTemporalGraphTracker",
    description:
      "Tracking topological feature birth and death across non-monotonic additions and deletions in temporal graphs",
    operationCode: "F464_ZIGZAG_PERSISTENCE_TEMPORAL_GRAPH_TRACKER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "time_slice_complexes",
      "inclusion_arrows",
      "deletion_arrows",
      "temporal_barcodes"
    ]
  },
  {
    featureId: "F465",
    stage: "stage15-topological-persistence",
    title: "OllivierRicciDiscreteGraphCurvatureEngine",
    description:
      "Computing Ollivier-Ricci discrete curvature kappa(u,v) = 1 - W_1(mu_u, mu_v)/d(u,v) across network edges",
    operationCode: "F465_OLLIVIER_RICCI_DISCRETE_GRAPH_CURVATURE_ENGINE",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["graph_vertices", "graph_edges", "lazy_walk_alpha", "wasserstein_solver"]
  },
  {
    featureId: "F466",
    stage: "stage15-topological-persistence",
    title: "WassersteinEarthMoverNeighborhoodTransport",
    description:
      "Solving 1-Wasserstein Earth Mover optimal transport between lazy random-walk neighborhood measures",
    operationCode: "F466_WASSERSTEIN_EARTH_MOVER_NEIGHBORHOOD_TRANSPORT",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "source_measure_mu",
      "target_measure_nu",
      "shortest_path_metric",
      "optimal_coupling"
    ]
  },
  {
    featureId: "F467",
    stage: "stage15-topological-persistence",
    title: "FormanRicciCombinatorialCellCurvature",
    description:
      "Evaluating combinatorial Forman-Ricci edge curvature from parallel neighbor and triangle incidences",
    operationCode: "F467_FORMAN_RICCI_COMBINATORIAL_CELL_CURVATURE",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["edge_weights", "vertex_weights", "incident_triangles", "forman_curvature_vec"]
  },
  {
    featureId: "F468",
    stage: "stage15-topological-persistence",
    title: "RicciFlowSurgicalCommunityDetector",
    description:
      "Evolving discrete Ricci flow metric weights and cutting negatively curved bridge bottlenecks to isolate communities",
    operationCode: "F468_RICCI_FLOW_SURGICAL_COMMUNITY_DETECTOR",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "initial_edge_metrics",
      "ricci_flow_iterations",
      "negative_kappa_cutoff",
      "community_clusters"
    ]
  },
  {
    featureId: "F469",
    stage: "stage15-topological-persistence",
    title: "HyperbolicNegativeCurvatureBottleneckGuard",
    description:
      "Identifying negatively curved hyperbolic bridge edges susceptible to cascading routing congestion",
    operationCode: "F469_HYPERBOLIC_NEGATIVE_CURVATURE_BOTTLENECK_GUARD",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["edge_curvature_map", "min_kappa_threshold", "congested_bridges", "reroute_plan"]
  },
  {
    featureId: "F470",
    stage: "stage15-topological-persistence",
    title: "PositivelyCurvedCliqueRedundancyCertifier",
    description:
      "Certifying positively curved tightly-knit agent clusters with high local triangle redundancy",
    operationCode: "F470_POSITIVELY_CURVED_CLIQUE_REDUNDANCY_CERTIFIER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "cluster_nodes",
      "triangle_density",
      "positive_kappa_floor",
      "fault_tolerance_tier"
    ]
  },
  {
    featureId: "F471",
    stage: "stage15-topological-persistence",
    title: "BonnetMyersDiameterCurvatureBoundChecker",
    description:
      "Checking discrete Bonnet-Myers graph diameter upper bounds from strictly positive Ollivier-Ricci curvature",
    operationCode: "F471_BONNET_MYERS_DIAMETER_CURVATURE_BOUND_CHECKER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "min_positive_ricci_kappa",
      "observed_graph_diameter",
      "theoretical_diameter_cap",
      "bound_satisfied"
    ]
  },
  {
    featureId: "F472",
    stage: "stage15-topological-persistence",
    title: "ScalarCurvatureNodeVitalityRanker",
    description:
      "Aggregating incident edge Ollivier-Ricci curvatures into node scalar curvature vitality scores",
    operationCode: "F472_SCALAR_CURVATURE_NODE_VITALITY_RANKER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "node_incident_kappas",
      "scalar_ricci_sum",
      "structural_importance",
      "top_vital_nodes"
    ]
  },
  {
    featureId: "F473",
    stage: "stage15-topological-persistence",
    title: "Hodge1LaplacianHelmholtzFlowDecomposer",
    description:
      "Decomposing edge flows into orthogonal gradient (curl-free), curl (triangle), and harmonic (cyclic) components",
    operationCode: "F473_HODGE_1_LAPLACIAN_HELMHOLTZ_FLOW_DECOMPOSER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["edge_flow_vector", "incidence_matrix_b1", "curl_matrix_b2", "decomposition_tol"]
  },
  {
    featureId: "F474",
    stage: "stage15-topological-persistence",
    title: "DiscreteCurlFreeGradientPotentialSolver",
    description:
      "Solving least-squares node potentials L_0 * phi = div(f) to extract globally transitive ranking potentials",
    operationCode: "F474_DISCRETE_CURL_FREE_GRADIENT_POTENTIAL_SOLVER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "edge_preferences",
      "graph_laplacian_l0",
      "node_potentials_phi",
      "gradient_projection"
    ]
  },
  {
    featureId: "F475",
    stage: "stage15-topological-persistence",
    title: "DivergenceFreeHarmonicCycleFlowIsolator",
    description:
      "Isolating divergence-free cyclic flow residuals that cause circular arbitrage or voting paradoxes",
    operationCode: "F475_DIVERGENCE_FREE_HARMONIC_CYCLE_FLOW_ISOLATOR",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "raw_edge_flow",
      "gradient_component",
      "cyclic_residual_flow",
      "zero_divergence_check"
    ]
  },
  {
    featureId: "F476",
    stage: "stage15-topological-persistence",
    title: "HodgeRankIntransitivityCircularityQuantifier",
    description:
      "Quantifying cyclic inconsistency vs transitive hierarchy in multi-agent pairwise preference flows via HodgeRank",
    operationCode: "F476_HODGE_RANK_INTRANSITIVITY_CIRCULARITY_QUANTIFIER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "pairwise_comparisons",
      "gradient_energy_pct",
      "cyclic_energy_pct",
      "transitivity_ratio"
    ]
  },
  {
    featureId: "F477",
    stage: "stage15-topological-persistence",
    title: "OrthogonalityGalerkinInnerProductVerifier",
    description:
      "Verifying L2 orthogonality <f_grad, f_divFree> = 0 and Pythagorean energy conservation ||f||^2 = ||f_g||^2 + ||f_c||^2",
    operationCode: "F477_ORTHOGONALITY_GALERKIN_INNER_PRODUCT_VERIFIER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "gradient_vector",
      "harmonic_vector",
      "l2_inner_product",
      "pythagorean_energy_ok"
    ]
  },
  {
    featureId: "F478",
    stage: "stage15-topological-persistence",
    title: "SheafLaplacianConsensusDisagreementFilter",
    description:
      " diffusing vector states over cellular sheaves using the Sheaf Laplacian to minimize restriction disagreement",
    operationCode: "F478_SHEAF_LAPLACIAN_CONSENSUS_DISAGREEMENT_FILTER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: ["stalk_vectors", "restriction_maps", "sheaf_coboundary", "global_section_error"]
  },
  {
    featureId: "F479",
    stage: "stage15-topological-persistence",
    title: "MapperReebGraphTopologicalSkeletonizer",
    description:
      "Constructing topological Mapper / Reeb graph skeletons from high-dimensional telemetry embeddings",
    operationCode: "F479_MAPPER_REEB_GRAPH_TOPOLOGICAL_SKELETONIZER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "filter_lens_values",
      "overlapping_intervals",
      "pullback_clusters",
      "nerve_skeleton_edges"
    ]
  },
  {
    featureId: "F480",
    stage: "stage15-topological-persistence",
    title: "TopologicalPersistenceStage15AuditLedger",
    description:
      "Sealing Vietoris-Rips Betti invariants, persistence barcodes, Ollivier-Ricci curvatures, and Hodge decompositions",
    operationCode: "F480_TOPOLOGICAL_PERSISTENCE_STAGE15_AUDIT_LEDGER",
    packageDir: "packages/core/src/stage15-topological-persistence",
    domainFields: [
      "betti_digest",
      "barcode_wasserstein_hash",
      "ricci_curvature_digest",
      "hodge_orthogonality_ok"
    ]
  },
  {
    featureId: "F481",
    stage: "stage16-wasm-evolutionary-synth",
    title: "StackBytecodeStaticDepthTypeVerifier",
    description:
      "Performing static abstract interpretation over bytecode to prove absence of stack underflow and overflow before execution",
    operationCode: "F481_STACK_BYTECODE_STATIC_DEPTH_TYPE_VERIFIER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: ["instruction_stream", "max_stack_limit", "operand_type_rules", "underflow_guard"]
  },
  {
    featureId: "F482",
    stage: "stage16-wasm-evolutionary-synth",
    title: "DeterministicGasMeteredBytecodeVm",
    description:
      "Executing verified stack bytecode instructions with strict instruction-level gas metering and OutOfGas halting",
    operationCode: "F482_DETERMINISTIC_GAS_METERED_BYTECODE_VM",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "bytecode_program",
      "gas_budget_limit",
      "opcode_cost_schedule",
      "memory_slot_cap"
    ]
  },
  {
    featureId: "F483",
    stage: "stage16-wasm-evolutionary-synth",
    title: "ControlFlowGraphDominatorTreeBuilder",
    description:
      "Computing Cooper-Harvey-Kennedy immediate dominators and dominance frontiers across bytecode basic blocks",
    operationCode: "F483_CONTROL_FLOW_GRAPH_DOMINATOR_TREE_BUILDER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: ["basic_blocks", "cfg_directed_edges", "entry_block_id", "immediate_dominators"]
  },
  {
    featureId: "F484",
    stage: "stage16-wasm-evolutionary-synth",
    title: "SsaPhiNodeMinimalInsertionCompiler",
    description:
      "Transforming bytecode register assignments into Static Single Assignment (SSA) form with minimal phi-node placement",
    operationCode: "F484_SSA_PHI_NODE_MINIMAL_INSERTION_COMPILER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "dominance_frontiers",
      "variable_def_blocks",
      "inserted_phi_nodes",
      "ssa_renamed_vars"
    ]
  },
  {
    featureId: "F485",
    stage: "stage16-wasm-evolutionary-synth",
    title: "DeadCodeAndUnreachableBlockEliminator",
    description:
      "Eliminating unreachable basic blocks and side-effect-free dead instructions via backward liveness analysis",
    operationCode: "F485_DEAD_CODE_AND_UNREACHABLE_BLOCK_ELIMINATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "ssa_instructions",
      "live_out_variables",
      "pruned_dead_ops",
      "optimized_bytecode_hash"
    ]
  },
  {
    featureId: "F486",
    stage: "stage16-wasm-evolutionary-synth",
    title: "ConstantFoldingPeepholeBytecodeOptimizer",
    description:
      "Folding compile-time arithmetic constants and algebraic identities in stack bytecode sequences",
    operationCode: "F486_CONSTANT_FOLDING_PEEPHOLE_BYTECODE_OPTIMIZER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "raw_instruction_seq",
      "peephole_window_size",
      "folded_constants_count",
      "gas_saved_estimate"
    ]
  },
  {
    featureId: "F487",
    stage: "stage16-wasm-evolutionary-synth",
    title: "LinearScanRegisterSpillAllocator",
    description:
      "Allocating virtual SSA temporaries to physical registers in linear time via Poletto-Sarkar live-interval scanning",
    operationCode: "F487_LINEAR_SCAN_REGISTER_SPILL_ALLOCATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "live_intervals",
      "physical_registers_k",
      "register_assignments",
      "spilled_slots_count"
    ]
  },
  {
    featureId: "F488",
    stage: "stage16-wasm-evolutionary-synth",
    title: "WasmSandboxExecutionTraceMerkleCommitter",
    description:
      "Committing every bytecode program counter step and stack transition into a verifiable SHA-256 execution trace",
    operationCode: "F488_WASM_SANDBOX_EXECUTION_TRACE_MERKLE_COMMITTER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "pc_step_trace",
      "stack_top_snapshots",
      "memory_state_root",
      "trace_commitment_sha256"
    ]
  },
  {
    featureId: "F489",
    stage: "stage16-wasm-evolutionary-synth",
    title: "Nsga2NonDominatedParetoFrontSorter",
    description:
      "Sorting multi-objective candidate synthesis programs into non-dominated Pareto fronts F_1, F_2, ... via Deb NSGA-II",
    operationCode: "F489_NSGA2_NON_DOMINATED_PARETO_FRONT_SORTER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "candidate_population",
      "objective_vectors",
      "pareto_fronts_f1_fk",
      "domination_counts"
    ]
  },
  {
    featureId: "F490",
    stage: "stage16-wasm-evolutionary-synth",
    title: "ParetoCrowdingDistanceDiversityEstimator",
    description:
      "Computing L1 cuboid crowding distances along each Pareto front to preserve solution diversity without niching parameters",
    operationCode: "F490_PARETO_CROWDING_DISTANCE_DIVERSITY_ESTIMATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "front_members",
      "normalized_objectives",
      "boundary_infinite_lock",
      "crowding_distances"
    ]
  },
  {
    featureId: "F491",
    stage: "stage16-wasm-evolutionary-synth",
    title: "HypervolumeIndicatorParetoConvergenceCalc",
    description:
      "Calculating the Zitzler-Thiele dominated hypervolume indicator against a reference nadir point",
    operationCode: "F491_HYPERVOLUME_INDICATOR_PARETO_CONVERGENCE_CALC",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "pareto_front_points",
      "reference_nadir_point",
      "dominated_hypervolume",
      "convergence_delta"
    ]
  },
  {
    featureId: "F492",
    stage: "stage16-wasm-evolutionary-synth",
    title: "TournamentCrowdedComparisonGeneticSelector",
    description:
      "Selecting parent synthesis candidates using crowded-comparison operator (lower Pareto rank, then larger crowding distance)",
    operationCode: "F492_TOURNAMENT_CROWDED_COMPARISON_GENETIC_SELECTOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: ["ranked_candidates", "tournament_size_k", "selection_seed", "selected_parents"]
  },
  {
    featureId: "F493",
    stage: "stage16-wasm-evolutionary-synth",
    title: "AstSubtreeCrossoverRecombinationOperator",
    description:
      "Performing type-safe Koza subtree crossover between parent program ASTs while enforcing depth invariants",
    operationCode: "F493_AST_SUBTREE_CROSSOVER_RECOMBINATION_OPERATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "parent_ast_alpha",
      "parent_ast_beta",
      "crossover_node_type",
      "offspring_ast_valid"
    ]
  },
  {
    featureId: "F494",
    stage: "stage16-wasm-evolutionary-synth",
    title: "PointMutationInstructionPerturbationEngine",
    description:
      "Applying type-preserving opcode and immediate-constant mutations for evolutionary program synthesis",
    operationCode: "F494_POINT_MUTATION_INSTRUCTION_PERTURBATION_ENGINE",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "source_bytecode",
      "mutation_rate_pm",
      "opcode_whitelist",
      "mutated_program_digest"
    ]
  },
  {
    featureId: "F495",
    stage: "stage16-wasm-evolutionary-synth",
    title: "LexicaseSelectionUnaggregatedTestFilter",
    description:
      "Filtering synthesis candidates sequentially across unaggregated edge-case tests via Helmuth Lexicase selection",
    operationCode: "F495_LEXICASE_SELECTION_UNAGGREGATED_TEST_FILTER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "candidate_pool",
      "shuffled_test_cases",
      "elite_survivors",
      "specialist_preserved"
    ]
  },
  {
    featureId: "F496",
    stage: "stage16-wasm-evolutionary-synth",
    title: "MapElitesQualityDiversityArchiveGrid",
    description:
      "Maintaining an illuminated Mouret MAP-Elites repertoire across behavioral complexity and latency niches",
    operationCode: "F496_MAP_ELITES_QUALITY_DIVERSITY_ARCHIVE_GRID",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "behavior_descriptors",
      "fitness_scores",
      "grid_cells_populated",
      "qd_archive_score"
    ]
  },
  {
    featureId: "F497",
    stage: "stage16-wasm-evolutionary-synth",
    title: "WagnerFischerAstEditDistanceCalculator",
    description:
      "Computing exact dynamic-programming structural edit distance between source and target AST token sequences",
    operationCode: "F497_WAGNER_FISCHER_AST_EDIT_DISTANCE_CALCULATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "source_ast_tokens",
      "target_ast_tokens",
      "edit_cost_matrix",
      "minimal_edit_distance"
    ]
  },
  {
    featureId: "F498",
    stage: "stage16-wasm-evolutionary-synth",
    title: "MinimalStructuralAstPatchScriptGenerator",
    description:
      "Synthesizing minimal sequences of KEEP, INSERT, DELETE, and RENAME operations that transform source AST to target AST",
    operationCode: "F498_MINIMAL_STRUCTURAL_AST_PATCH_SCRIPT_GENERATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "dp_backtrack_table",
      "edit_operations_list",
      "insert_delete_rename_counts",
      "reconstructed_match"
    ]
  },
  {
    featureId: "F499",
    stage: "stage16-wasm-evolutionary-synth",
    title: "GumtreeHierarchicalAstSubtreeMatcher",
    description:
      "Matching isomorphic AST subtrees top-down by Merkle hash before computing bottom-up container recovery edits",
    operationCode: "F499_GUMTREE_HIERARCHICAL_AST_SUBTREE_MATCHER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "source_tree_hashes",
      "target_tree_hashes",
      "isomorphic_anchors",
      "move_actions_detected"
    ]
  },
  {
    featureId: "F500",
    stage: "stage16-wasm-evolutionary-synth",
    title: "AntiUnificationAstTemplateAbstracter",
    description:
      "Extracting generalized refactoring templates with typed holes from repeated AST edit scripts",
    operationCode: "F500_ANTI_UNIFICATION_AST_TEMPLATE_ABSTRACTER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "concrete_patch_examples",
      "shared_ast_spine",
      "hole_placeholders",
      "reusable_refactoring_rule"
    ]
  },
  {
    featureId: "F501",
    stage: "stage16-wasm-evolutionary-synth",
    title: "ProgramEquivalenceObservationalInputProber",
    description:
      "Verifying observational equivalence of synthesized program variants across canonical boundary input vectors",
    operationCode: "F501_PROGRAM_EQUIVALENCE_OBSERVATIONAL_INPUT_PROBER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "candidate_program_a",
      "candidate_program_b",
      "probe_input_vectors",
      "observational_equivalent"
    ]
  },
  {
    featureId: "F502",
    stage: "stage16-wasm-evolutionary-synth",
    title: "DeltaDebuggingDdminFailureMinimizer",
    description:
      "Isolating minimal failure-inducing AST token subsets via Zeller ddmin binary partition search",
    operationCode: "F502_DELTA_DEBUGGING_DDMIN_FAILURE_MINIMIZER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "failing_ast_input",
      "failure_oracle_fn",
      "minimal_1_minimal_subset",
      "reduction_ratio"
    ]
  },
  {
    featureId: "F503",
    stage: "stage16-wasm-evolutionary-synth",
    title: "EGraphEqualitySaturationRewriteExplorer",
    description:
      "Expanding congruence closure over e-graphs and extracting minimum-gas equivalent AST expressions",
    operationCode: "F503_E_GRAPH_EQUALITY_SATURATION_REWRITE_EXPLORER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "initial_eclass_nodes",
      "algebraic_rewrite_rules",
      "equivalence_classes_merged",
      "lowest_cost_ast"
    ]
  },
  {
    featureId: "F504",
    stage: "stage16-wasm-evolutionary-synth",
    title: "CounterexampleGuidedInductiveSynthesisLoop",
    description:
      "Iterating Counterexample-Guided Inductive Synthesis (CEGIS) until the synthesized bytecode satisfies all I/O specs",
    operationCode: "F504_COUNTEREXAMPLE_GUIDED_INDUCTIVE_SYNTHESIS_LOOP",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "specification_io_pairs",
      "candidate_synthesizer",
      "verifier_counterexample",
      "cegis_converged"
    ]
  },
  {
    featureId: "F505",
    stage: "stage16-wasm-evolutionary-synth",
    title: "ZlibNormalizedCompressionDistanceEvaluator",
    description:
      "Computing Li-Vitanyi Normalized Compression Distance NCD(x,y) = (C(xy) - min(C(x),C(y))) / max(C(x),C(y)) via raw deflate",
    operationCode: "F505_ZLIB_NORMALIZED_COMPRESSION_DISTANCE_EVALUATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "payload_string_x",
      "payload_string_y",
      "deflate_level_9",
      "ncd_similarity_score"
    ]
  },
  {
    featureId: "F506",
    stage: "stage16-wasm-evolutionary-synth",
    title: "KolmogorovAlgorithmicComplexityApproximator",
    description:
      "Estimating upper bounds on Kolmogorov algorithmic information complexity via LZ77/Huffman dictionary compression",
    operationCode: "F506_KOLMOGOROV_ALGORITHMIC_COMPLEXITY_APPROXIMATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "artifact_utf8_bytes",
      "uncompressed_byte_len",
      "compressed_deflate_len",
      "incompressibility_ratio"
    ]
  },
  {
    featureId: "F507",
    stage: "stage16-wasm-evolutionary-synth",
    title: "MinimumDescriptionLengthMdlModelSelector",
    description:
      "Selecting parsimonious symbolic models that minimize Rissanen two-part MDL code length L(H) + L(D|H)",
    operationCode: "F507_MINIMUM_DESCRIPTION_LENGTH_MDL_MODEL_SELECTOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "candidate_hypotheses",
      "model_bit_lengths_lh",
      "residual_error_bits_ldh",
      "mdl_optimal_hypothesis"
    ]
  },
  {
    featureId: "F508",
    stage: "stage16-wasm-evolutionary-synth",
    title: "CompressionBasedAnomalyOutlierDetector",
    description:
      "Detecting zero-day telemetry anomalies via conditional compression complexity spikes C(Corpus || x) - C(Corpus)",
    operationCode: "F508_COMPRESSION_BASED_ANOMALY_OUTLIER_DETECTOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "baseline_corpus_concat",
      "incoming_telemetry_record",
      "conditional_compressed_delta",
      "anomaly_flagged"
    ]
  },
  {
    featureId: "F509",
    stage: "stage16-wasm-evolutionary-synth",
    title: "NcdDistanceMatrixAgglomerativeClusterer",
    description:
      "Clustering heterogeneous code and text artifacts parameter-free using pairwise Normalized Compression Distance",
    operationCode: "F509_NCD_DISTANCE_MATRIX_AGGLOMERATIVE_CLUSTERER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "artifact_Documents",
      "pairwise_ncd_matrix",
      "quartet_tree_topology",
      "cluster_assignments"
    ]
  },
  {
    featureId: "F510",
    stage: "stage16-wasm-evolutionary-synth",
    title: "LempelZivLz78PhraseDictionaryEntropyCalc",
    description:
      "Parsing incremental Lempel-Ziv phrase dictionaries to measure sequence entropy rate and repetition loops",
    operationCode: "F510_LEMPEL_ZIV_LZ78_PHRASE_DICTIONARY_ENTROPY_CALC",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "symbol_sequence",
      "unique_lz_phrases_c",
      "asymptotic_entropy_rate",
      "repetitiveness_index"
    ]
  },
  {
    featureId: "F511",
    stage: "stage16-wasm-evolutionary-synth",
    title: "SolomonoffUniversalPriorWeightCalibrator",
    description:
      "Assigning Solomonoff-Levin universal algorithmic prior weights 2^{-|p|} to favor concise synthesized programs",
    operationCode: "F511_SOLOMONOFF_UNIVERSAL_PRIOR_WEIGHT_CALIBRATOR",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "program_lengths_bits",
      "occam_razor_weights",
      "normalized_prior_probs",
      "shortest_program_id"
    ]
  },
  {
    featureId: "F512",
    stage: "stage16-wasm-evolutionary-synth",
    title: "Kosmora512ApexMasterArchitectureCertifier",
    description:
      "Certifying full 16-stage 512-module Kosmora Apex Architecture (F001–F512) with cryptographic readiness seal",
    operationCode: "F512_KOSMORA_512_APEX_MASTER_ARCHITECTURE_CERTIFIER",
    packageDir: "packages/core/src/stage16-wasm-evolutionary-synth",
    domainFields: [
      "total_modules_512",
      "topological_betti_verified",
      "bytecode_vm_verified",
      "apex_architecture_sha256"
    ]
  }
];
