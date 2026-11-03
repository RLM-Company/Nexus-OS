# Переносимый JSON-импорт/экспорт сценариев Koswork, однопроходная подстановка параметров, ZIP-выгрузка результатов и контроль срока discovery Fable 5

Дата: `2026-11-02`
Ветка: `feature/kosmora-workflow-portability-and-fable-discovery-20261102`
Связанные PR стека: `#426`, `#427`, `#428` (плюс сводный мастер-архив всего стека `#411`–`#428`)

## 1. Назначение блока

Этот блок реализует детальные контракты переносимости, безопасности параметров и выгрузки архивов из `docs/handoff/KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md` (`#428`) и контроль срока действия model discovery из `docs/handoff/KOSMORA_FABLE_LIVE_CONNECTIVITY_2026-11-02_RU.md` (`#426`):

1. **Переносимый JSON-пакет сценариев, проверка инструментов `WORKFLOW_TOOL_UNAVAILABLE`, защита от prompt-инъекций и ZIP-экспорт результатов (`packages/db/src/workflow-portability-and-zip-exporter.ts`):**
   - **Очистка при экспорте/импорте (`exportPortableWorkflowPackage` / `importPortableWorkflowPackage`):** переносимый пакет содержит только поля определения (`name`, `description`, `parameters`, `nodes`, `requirements`, `expected_results`) и принудительно удаляет историю запусков, значения параметров, права, привязанные аккаунты и серверный контекст.
   - **Предварительная проверка инструментов:** неизвестные значения в `requirements` отклоняются с кодом `WORKFLOW_TOOL_UNAVAILABLE` до создания плана.
   - **Однопроходная подстановка параметров (`bindWorkflowParametersSinglePass`):** значения параметров (`text`, `number`, `boolean`, `select`, `project_document`, `url`) подставляются за один проход без повторного разбора шаблонов — если пользователь передаст `{{secretTarget}}` внутри текстового параметра, строка останется буквальным текстом и никогда не раскроет другой параметр. Ссылки `url` проверяются на `http(s)://` и передаются справочной строкой без сетевого скачивания.
   - **План без расхода токенов по умолчанию (`prepareOrExecuteWorkflowRun`):** при `immediateExecution = false` создаёт план с `reservedTokensTotal = 0`; списание/резерв бюджета (до `3` запросов на шаг) включается только при явном флаге `immediateExecution = true`.
   - **ZIP-архив готовых результатов (`exportWorkflowRunResultsZip`):** собирает `run-manifest.json` и выходные файлы шагов `outputs/<stepId>-<name>` в канонический архив `ZIP STORE` с расчётом `CRC32` и `SHA-256`.

2. **Контроль срока действия discovery (`9 ноября 2026`) и проверка профиля `claude-fable-5` (`apps/api/src/fable-discovery-and-registry-validator.ts`):**
   - Проверяет профиль `config/model-registry.tokenshop.fable.v1.json` на отсутствие секретов/ключей, отключение `fallbackToMock: false`, `maxAttemptsPerRoute: 1` и лимиты `1 000 000` / `100 000` токенов.
   - Контролирует окно валидности model discovery (`discoveryExpiresAt = "2026-11-09T00:00:00.000Z"`): после истечения срока блокирует вызовы с кодом `MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED` до выполнения безопасного обновления `refreshFableModelDiscovery`.

## 2. Проверенные сценарии

Запуск `node scripts/integration-workflow-portability-and-fable-discovery-smoke.mjs`:
- `apps/api/test/workflow-portability-and-fable-discovery.test.ts` — `2/2 PASS`:
  1. Отказ `WORKFLOW_TOOL_UNAVAILABLE` на неизвестный инструмент, очистка `executionHistory`/`connectedAccounts`/`permissions` при экспорте, блокировка рекурсивной подстановки `{{secretTarget}}`, режим `plan_only_zero_tokens` (`0` токенов) против `immediate_execution` (ограничение `maxRequestsPerStep = 3`), выгрузка ZIP-архива результатов.
  2. Проверка профиля `claude-fable-5`, блокировка после `2026-11-09T00:00:01Z` (`MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED`) и продление окна discovery на 7 дней (`2026-11-16T01:00:00.000Z`) с фиксацией `discoverySha256`.
