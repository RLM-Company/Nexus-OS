# Восстановление каталога Google Drive при утрате журнала, импорт внешних ZIP STORE архивов, классификатор опасных действий ПК и калиброванный BPE-оценщик

Дата: `2026-11-02`
Ветка: `feature/kosmora-drive-journal-recovery-and-hazard-guard-20261102`
Связанные PR стека: `#411`, `#412`, `#422`, `#425` (включая коммит `3579bc9` и `KOSMORA_DRIVE_BACKUP_RESTORE_2026-11-02_RU.md`)

## 1. Назначение блока

Этот блок закрывает пункты «Что остаётся следующим блокам / Ограничения» из свежего обновления `docs/handoff/KOSMORA_DRIVE_BACKUP_RESTORE_2026-11-02_RU.md` в `#425`, а также ограничения из `#411`/`#412` и `#422`:

1. **Восстановление каталога при полной утрате локального журнала и импорт внешних / Picker ZIP-архивов (`apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts`):**
   - **Канонический формат ZIP STORE (`buildCanonicalStoreZipSnapshot` / `parseAndVerifyCanonicalStoreZip`):** поддержка формата `manifest.json` + чанков `snapshot.partNNNN.json` до `2 МиБ` (общий размер до `32 МиБ`, до `2 000` чатов, `50 000` сообщений и `2 000` файлов Work) с нативной сверкой `crc32` (`node:zlib`) и `SHA-256`.
   - **Реконструкция каталога при утрате локальной БД (`discoverAndRebuildDriveJournal`):** сканирует файлы архивов в папке Google Drive, проверяет структуру ZIP STORE, `CRC32` и `SHA-256` всех частей, отсеивает чужие или повреждённые архивы и восстанавливает локальный каталог `kosmora_drive_recovered_catalog`.
   - **Безопасный импорт внешних / Google Picker ZIP-архивов (`importExternalKosmoraZipSnapshot`):** проверяет загруженный пользователем `.zip` архив на отсутствие обхода путей (`..`), соответствие лимитам и хешам, после чего атомарно восстанавливает диалоги и опубликованные файлы Work в новые изолированные ID, переводя любые прерванные (`pending`/`streaming`) сообщения в `cancelled` (чтобы прерванные вызовы LLM никогда не запускались повторно).

2. **Многоуровневый классификатор опасных действий ПК, защита от потери фокуса Windows и чекпоинт свежего согласия (`desktop/windows/ci/computer-hazard-and-focus-guard.cjs`):**
   - Классификация действий (`classifyComputerActionHazard`) на `strictly_blocked` (системные комбинации `Alt+F4`, `Win+R`, `Ctrl+Shift+Esc`, запуск `.exe`/`.msi`/`.ps1`, команды форматирования и реестра), `requires_step_up_consent` (оплата, переводы, удаление аккаунта, отправка внешних сообщений) и `safe`.
   - Проверка удержания фокуса целевого окна (`verifyForegroundWindowFocus`) по `HWND` и имени процесса перед каждым вводом с немедленной остановкой `FOCUS_STOLEN_BY_OTHER_WINDOW` / `FOCUS_LOST_OR_MINIMIZED`.
   - Чекпоинт прерванной задачи (`ComputerTaskRecoveryGuard`), требующий нового `freshConsentId` с меткой времени строго после момента прерывания (`CONSENT_TIMESTAMP_MUST_FOLLOW_INTERRUPTION`).

3. **Калиброванный BPE-оценщик токенов (кириллица + код + тайлы изображений) и аудитор подлинности контекстного окна провайдера (`packages/core/src/bpe-context-estimator-and-audit.ts`):**
   - Точная оценка субслов `estimateConversationWindowUsage` для кириллицы, латиницы, кода/JSON и high-res тайлов изображений (`85 + 170 * tiles`) под окно `1 050 000` токенов / `128 000` выходных токенов профиля Sol (`#422`).
   - Журнал аттестации провайдера `ProviderAuthenticityAuditor` с фиксацией `SHA-256` запросов/ответов и проверки извлечения маркера (`needleRecoveredVerbatim`) на длинных контекстах (`>32K` / `64K` / `128K`).

## 2. Проверенные сценарии

Запуск `node scripts/integration-journal-recovery-hazard-and-bpe-smoke.mjs`:
- `desktop/windows/test/computer-hazard-and-focus-guard.test.cjs` — `2/2 PASS` (блокировка `Alt+F4` и `.exe`, запрос step-up согласия на платежи, остановка при перехвате фокуса другим `HWND` и запрет повторного использования старого `consentId`).
- `apps/api/test/drive-journal-recovery-and-bpe-audit.test.ts` — `2/2 PASS` (реконструкция каталога из ZIP STORE архивов при пустом журнале, отбраковка чужих/битых архивов, импорт внешнего ZIP в новые ID с переводом `streaming -> cancelled`, расчёт тайлов `1024x1024 -> 765` токенов и сводка аттестации провайдера).
