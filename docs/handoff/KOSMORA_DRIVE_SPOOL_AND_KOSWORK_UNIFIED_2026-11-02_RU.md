# Неизменяемый спулинг Google Drive, восстановление в новый чат, обход Shadow DOM / фреймов и генератор Word-отчётов Koswork

Дата: `2026-11-02`
Ветка: `feature/kosmora-drive-spool-and-koswork-unified-20261102`
Связанные PR стека: `#414`, `#415`, `#416`, `#425`

## 1. Назначение блока

Этот блок закрывает оставшиеся пункты из `docs/handoff/KOSMORA_GOOGLE_DRIVE_2026-11-01_RU.md` (`#425`), `docs/handoff/KOSWORK_BROWSER_2026-10-29_RU.md` (`#414`/`#415`) и `docs/handoff/KOSWORK_UNIFIED_TASK_2026-10-29_RU.md` (`#416`):

1. **Неизменяемый спулинг архивов Google Drive, политика повторов, ротация квот и восстановление в новый чат (`apps/api/src/cloud-storage/google-drive-immutable-spooler.ts`):**
   - **Content-addressed спулинг (`spoolArchive`):** записывает собранный архив на диск (`<spoolRoot>/<ownerId>/<backupId>-<sha256>.spool`, права `0600`) до отправки в сеть, чтобы при сбое сети повторная отправка (`dispatchOrRetrySpooledBackup`) воспроизводила в точности те же самые байты без повторной сборки архива клиентом.
   - **Retry policy при нестабильном соединении:** экспоненциальный backoff для временных ошибок Google API (`429`, `408`, `500`, `502`, `503`, `504`, `ETIMEDOUT`, `ECONNRESET`, `DRIVE_RATE_LIMITED`, `DRIVE_TIMEOUT`) с немедленным отказом при постоянных ошибках (`401`, `403`, `404`).
   - **Контроль квот и ротация старых архивов (`enforceQuotaAndPruneOldArchives`):** проверяет лимит локального спула владельца (`<= 128 MiB`) и автоматически очищает старые завершённые архивы сверх `maxRetainedBackups`, сохраняя закреплённые (`pinned = 1`) копии.
   - **Восстановление архива в новый изолированный чат (`restoreArchiveIntoNewChat`):** создаёт отдельный `newChatId` с пометкой `«(восстановлено из Drive <дата>)»` и проверкой SHA-256, не перезаписывая и не изменяя активный исходный чат.

2. **Обход вложенных Shadow DOM и однодоменных `<iframe>` в браузере Koswork (`desktop/windows/browser/shadow-and-frame-piercer.cjs`):**
   - Рекурсивный сборщик интерактивных элементов `collectPiercedInteractiveSnapshot` и резолвер `resolveDeepSelector` (`iframe#local-editor-frame >> frame[...] >> button`), позволяющий агенту Koswork находить и нажимать элементы внутри открытых `shadowRoot` и однодоменных `<iframe>` при строгой изоляции кросс-доменных фреймов (`cross_origin_isolated`).

3. **Локальный генератор отчётов Microsoft Word (`.docx`) для единой задачи Koswork (`desktop/windows/workspace/word-report-builder.cjs`):**
   - Автономная сборка валидного OpenXML `.docx` (`buildWordReportDocxBuffer` / `saveWordReportToWorkspace`) со структурированными заголовками, кликабельными гиперссылками `<w:hyperlink>` на источники, точными цитатами и SHA-256 отпечатками внутри защищённой рабочей папки Koswork (с проверкой через `path-guard.cjs` и обратной верификацией через `vault-document-extractor.cjs`).

## 2. Проверенные сценарии

Запуск `node scripts/integration-drive-spool-and-koswork-report-smoke.mjs`:
- `desktop/windows/test/shadow-piercer-and-word-report.test.cjs` — `2/2 PASS` (обход Shadow DOM и same-origin iframe с блокировкой внешнего OAuth-фрейма; сборка `.docx` отчёта в рабочей папке и обратное извлечение текста и цитат через `vault-document-extractor.cjs`).
- `apps/api/test/google-drive-immutable-spooler.test.ts` — `2/2 PASS` (спулинг на диск, успешная отправка с 3-й попытки после `429` и `503` без повторной передачи буфера, ротация старых бэкапов с сохранением `pinned`, восстановление архива в новый чат без мутации исходного чата).
