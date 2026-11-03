# Шаблоны и DAG-валидатор сценариев Koswork с Критиком, журнал 500 квитанций памяти и единый координатор задач (Браузер + Файлы + Приложения)

Дата: `2026-11-02`
Ветка: `feature/kosmora-workflows-dag-receipts-and-unified-coordinator-20261102`
Связанные PR стека: `#416`, `#424`, `#428`

## 1. Назначение блока

Этот блок объединяет и верифицирует связующие механизмы между сценариями Koswork (`#428`), квитанциями дополнительной памяти (`#424`, миграция `0059_memory_usage.sql`) и единым исполнителем задач по браузеру, файлам и приложениям ПК (`#416`):

1. **Три базовых шаблона сценариев, топологический DAG-валидатор, перестановка шагов, проверка Критиком и неизменяемость версий (`packages/db/src/workflow-dag-templates-and-critic.ts`):**
   - **3 стартовых шаблона (`getInitialKosworkScenarioTemplates`):** «Отчёт по документу» (`document_report`), «Текст в рабочие материалы» (`text_to_materials`) и «Анализ источника с итоговой запиской» (`source_analysis_summary`).
   - **Топологическая проверка и перестановка (`validateAndBuildTopologicalWaves` / `reorderWorkflowStepsSafely`):** вычисляет волны выполнения DAG, блокирует циклы (`WORKFLOW_DAG_CYCLE_DETECTED`) и не даёт переставить зависимый шаг раньше его источника (`WORKFLOW_REORDER_VIOLATES_DEPENDENCY`).
   - **Оценка Критиком (`evaluateWorkflowCriticCheck`):** проверяет наличие непустых результатов всех шагов, создание всех заявленных артефактов `expected_results` и сохранность обязательных чисел/ссылок.
   - **Жизненный цикл и SQL-неизменяемость версий (`WorkflowLifecycleAndPrivacyManager`):** идемпотентное создание по `client_creation_id`, обновление с проверкой `expected_version` (`WORKFLOW_VERSION_CONFLICT`), SQL-триггер `workflow_version_immutable` (`RAISE(ABORT, 'WORKFLOW_VERSION_IMMUTABLE')`) и адаптер экспорта/удаления для Privacy Coordinator.

2. **Журнал квитанций источников памяти до 500 записей на владельца (`packages/db/src/context-memory-receipts-store.ts`):**
   - Реализует схему `0059_memory_usage.sql` (`context_memory_usage`) для запросов обычного чата и Koswork.
   - Сохраняет только ссылки на источники и `SHA-256` отпечатки цитат (`receiptDigestSha256`) без дублирования приватных текстов.
   - Атомарно удерживает потолок `<= 500` квитанций на владельца (`MAX_RECEIPTS_PER_OWNER = 500`), автоматически удаляя самые старые записи при вставке новых.

3. **Единый координатор мультидоменной задачи: Браузер + Приложения ОС + Рабочая папка Word `.docx` (`desktop/windows/ci/unified-task-coordinator.cjs`):**
   - Выполняет сквозной пользовательский сценарий из `#416` (`executeUnifiedResearchAndReportTask`): поиск источников в локальном браузере (`browser_search` с безопасным URL `koswork://search/...`), проверка безопасности действия и фокуса окна приложения ОС (`verifyForegroundWindowFocus` / `classifyComputerActionHazard`), генерация отчёта Microsoft Word (`.docx`) с кликабельными ссылками и обратная проверка документа через `vault-document-extractor.cjs`.
   - Ведёт криптографически связанную цепочку истории действий (`prevHash -> entryHash`).

## 2. Проверенные сценарии

Запуск `node scripts/integration-workflow-dag-receipts-and-unified-smoke.mjs`:
- `desktop/windows/test/unified-task-coordinator.test.cjs` — `1/1 PASS` (выполнение цепочки `browser -> desktop_app -> workspace_files` со сборкой `.docx` и мгновенная остановка `UNIFIED_TASK_FOCUS_LOST:FOCUS_STOLEN_BY_OTHER_WINDOW` при потере фокуса).
- `apps/api/test/workflow-dag-critic-and-receipts.test.ts` — `2/2 PASS` (валидация 3 шаблонов, блокировка неверной перестановки шагов DAG, проверка Критиком, срабатывание триггера `WORKFLOW_VERSION_IMMUTABLE` и автоматическая ротация квитанций `context_memory_usage`).
