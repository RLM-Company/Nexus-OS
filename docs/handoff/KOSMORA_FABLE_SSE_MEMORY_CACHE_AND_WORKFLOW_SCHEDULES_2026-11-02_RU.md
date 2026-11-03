# Отказоустойчивый SSE-стриминг Fable, изолированный кэш префиксов памяти и расписания / подсценарии Koswork

Дата: `2026-11-02`
Ветка: `feature/kosmora-fable-sse-memory-cache-and-workflows-20261102`
Связанные новые PR стека: `#426`, `#427`, `#428`

## 1. Назначение блока

Этот блок закрывает пункты «Что остаётся следующим блокам / Ограничения» из трёх новых PR, открытых 2 ноября 2026 года:
- `docs/handoff/KOSMORA_FABLE_LIVE_CONNECTIVITY_2026-11-02_RU.md` (`#426`)
- `docs/handoff/KOSMORA_MEMORY_PACKING_2026-11-02_RU.md` (`#427`)
- `docs/handoff/KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md` (`#428`, миграция `0062_reusable_workflows.sql`)

### Реализованные компоненты

1. **Отказоустойчивый SSE-стриминг `claude-fable-5` с защитой от обрывов и развёрткой `<escape>JSON</escape>` (`apps/api/src/fable-sse-resilient-stream.ts`):**
   - Потоковая сборка SSE-фреймов (`message_start`, `content_block_delta`, `message_delta`, `message_stop`, `[DONE]`) поверх произвольных границ TCP-чанков.
   - Защита от обрывов провайдера (`FABLE_SSE_TRUNCATED_BEFORE_STOP` / `FABLE_SSE_TRUNCATED_MAX_TOKENS`): если соединение закрылось до получения `message_stop`, буфер НЕ передаётся в `JSON.parse`, а статус удержания бюджета переводится в `usageDisposition = "uncertain"` (без ложного возврата средств и без повреждения состояния шага Work).
   - Мгновенная остановка при отмене задачи (`isCancelled() -> WORK_CANCELLED_DURING_STREAM`).
   - Строго однократная развёртка внешнего конверта `<escape>JSON</escape>` (`unwrapSingleEscapeJsonEnvelope`) с блокировкой вложенных инъекций `<escape>`.

2. **Изолированный по владельцам `O(N)` кэш измерения UTF-8 байтов и контроль бюджета обязательного префикса (`packages/db/src/context-memory-prefix-byte-cache.ts`):**
   - Кэширование точной длины сериализованных записей в `Map<ownerId, Map<entryId, { version, utf8Bytes }>>` (до `512` записей на владельца с LRU-вытеснением, нулевое пересечение между владельцами) и автоматической инвалидацией при инкременте `version`.
   - Линейная упаковка `packLinearWithPrefixBudget` с учётом байтов конверта `{"entries":[]}` и запятых.
   - Явное исключение `MandatoryPrefixBudgetError` (`MANDATORY_PREFIX_BUDGET_EXCEEDED`), если обязательный закреплённый префикс превышает `maxBudgetBytes`.

3. **Композиция подсценариев (с защитой от циклов), шаг-согласие для браузера/ПК и идемпотентные расписания сценариев Koswork (`packages/db/src/workflow-schedule-and-subworkflow-runner.ts`):**
   - Встраивание шагов `sub_workflow` (`resolveAndInlineSubWorkflows`) с детекцией рекурсивных циклов (`WORKFLOW_RECURSION_CYCLE_DETECTED`), лимитом глубины `<= 3` и проверкой суммарного лимита `<= 32` шагов и `<= 64 000` байт UTF-8.
   - Поддержка шагов `browser_action` и `computer_control` с интерполяцией параметров `{{param}}` и обязательным гейтом согласия владельца (`WORKFLOW_DESKTOP_OR_BROWSER_CONSENT_REQUIRED`).
   - Таблица расписаний `kosmora_workflow_schedules` и идемпотентный триггер `triggerScheduledTick` с детерминированным ключом `client_request_id = "schedule:<scheduleId>:<slotIso>"`, исключающим дублирование запусков `kosmora_workflow_runs` при повторных тиках таймера.

## 2. Проверенные сценарии

Запуск `node scripts/integration-fable-memory-cache-and-workflows-smoke.mjs`:
- `apps/api/test/fable-sse-memory-cache-and-workflows.test.ts` — `3/3 PASS`:
  1. Сборка чанкованного SSE-потока `claude-fable-5` с `<escape>{"stage":"plan","steps":3}</escape>`, перехват обрыва соединения до `message_stop` (`FABLE_SSE_TRUNCATED_BEFORE_STOP`, `usageDisposition: "uncertain"`) и отмена во время стрима.
  2. Проверка `cacheHits = 2` на повторном ходе при неизменной версии, инвалидация при обновлении `version: 2` и выброс `MANDATORY_PREFIX_BUDGET_EXCEEDED` при нехватке бюджета под обязательный префикс.
  3. Инлайнинг подсценария `wf-child-research` в `wf-parent-report`, блокировка без токена согласия на браузерный шаг, перехват взаимной рекурсии `wf-cycle-a <-> wf-cycle-b` и дедупликация повторного тика расписания на слоте `2026-11-02T09:00:00.000Z`.
