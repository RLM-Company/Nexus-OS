# Единая миграция `0063` с триггерами `OWNER_DATA_FENCED`, адаптер приватности Stage-2 и защищённый IPC-мост Windows-клиента

Дата: `2026-11-02`
Ветка: `feature/kosmora-stage2-migration-privacy-and-ipc-20261102`
Охват стека: `PR #411` – `PR #428`

## 1. Назначение блока

Этот блок сводит все таблицы, триггеры жизненного цикла приватности и десктопные обработчики Stage-2 (`#411`–`#428`) в единый контур без изменения защищённых файлов параллельной работы (`apps/api/src/account-settings/**`, `packages/db/src/usage-store.ts`, `packages/contracts/src/usage.ts`):

1. **Консолидированная аддитивная миграция `packages/db/migrations/0063_unified_stage2_extensions.sql`:**
   - Определяет все таблицы второго этапа (`context_memory_entries`, `context_memory_versions`, `context_memory_settings`, `context_memory_owner_defaults`, `profile_candidate_dismissals`, `context_memory_usage`, `kosmora_drive_spool_journal`, `kosmora_drive_recovered_catalog`, `kosmora_workflow_definitions`, `kosmora_workflow_versions`, `kosmora_workflow_runs`, `kosmora_workflow_schedules`).
   - Устанавливает триггеры `BEFORE INSERT` / `BEFORE UPDATE` с проверкой `kosmora_owner_data_lifecycle` (`RAISE(ABORT, 'OWNER_DATA_FENCED')`), блокирующие любую позднюю запись фоновых задач во время экспорта или удаления данных владельца, а также триггер `workflow_version_immutable`.

2. **Адаптер приватности Stage-2 (`apps/api/src/stage2-privacy-adapter.ts`):**
   - Реализует контракт `PrivacyAdapter` (`id: "stage2-memory-drive-workflows"`, методы `quiesce`, `export`, `delete`, `resume`) в отдельном файле вне `apps/api/src/account-settings/**`.
   - При вызове `quiesce(ownerId, epoch)` переводит владельца в состояние `quiescing`, останавливает все расписания `kosmora_workflow_schedules` (`enabled = 0`) и удаляет незавершённые локальные `.spool`-файлы Google Drive.
   - При вызове `export(ownerId)` выгружает все 11 таблиц второго этапа с флагом `complete: true` без секретов/ключей.
   - При вызове `delete(ownerId, epoch)` атомарно очищает все записи и версии `ownerId`, не затрагивая данные других владельцев.

3. **Защищённый по источнику IPC-мост Windows-клиента (`desktop/windows/ci/stage2-desktop-ipc-bridge.cjs`):**
   - Объединяет вызовы `koswork:vault:extract-doc`, `koswork:vault:read-virtual-uri`, `koswork:browser:pierce-dom`, `koswork:browser:search-paginate`, `koswork:computer:check-hazard`, `koswork:computer:verify-focus` и `koswork:unified:run-task`.
   - Проверяет `event.senderFrame.url` и `ownerId` на каждом запросе: любые попытки вызова нативных каналов со стороны внешних веб-страниц внутри агентного браузера мгновенно блокируются с кодом `UNTRUSTED_IPC_SENDER_ORIGIN`.

## 2. Проверенные сценарии

Запуск `node scripts/run-all-stage2-acceptance-suites.mjs`:
- `desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs` — `1/1 PASS` (блокировка `UNTRUSTED_IPC_SENDER_ORIGIN` для внешних сайтов, блокировка `IPC_OWNER_SESSION_MISMATCH`, выполнение извлечения `.docx` и единой задачи с доверенного `file://` и `http://127.0.0.1:3300`).
- `apps/api/test/stage2-privacy-and-fencing.test.ts` — `1/1 PASS` (срабатывание `OWNER_DATA_FENCED` при попытке записи после `quiesce`, полный экспорт 11 таблиц, удаление данных `owner-1` с полной сохранностью `owner-2`).
- Проверка границ параллельной работы (`git diff apps/api/src/account-settings packages/db/src/usage-store.ts packages/contracts/src/usage.ts`) — `0` затронутых файлов (`PASS`).
