# Handoff: Полное подключение Google Drive (OAuth-контроллер, многотомные архивы, приватность и транзакционное восстановление)

- **Репозиторий**: `https://github.com/RLM-Company/Nexus-OS`
- **Целевая база**: ветка `codex/google-drive-storage-20261101` ([PR #425](https://github.com/RLM-Company/Nexus-OS/pull/425)), коммит `2377a4295a3981e48a90c22d439811df87fad1b5`
- **Рабочая ветка**: `feature/kosmora-google-drive-complete-20261101`

## 1. Что реализовано (по 5 пунктам `KOSMORA_GOOGLE_DRIVE_2026-11-01_RU.md`)

1. **OAuth-контроллер и серверная привязка `state` к `DriveConnectTicket` (`apps/api/src/cloud-storage/google-drive-controller.ts`, `apps/api/src/cloud-storage/index.ts`)**:
   - Метод `startOAuthConnect` захватывает `ticket = store.beginConnect(ownerId)` до редиректа в Google OAuth, вызывает `auth.begin({ ownerId, sessionId })` (PKCE S256, `drive.file`) и сохраняет одноразовую связку `state -> { ownerId, sessionId, ticket, expiresAt }` в памяти сервера.
   - Метод `finishOAuthCallback` немедленно удаляет одноразовый `state`, сверяет текущую сессию и владельца (`ownerId`, `sessionId`), не принимает `ticket` из браузера, обменивает `code` на `DriveGrant`, выделяет `folderId` и вызывает `store.connect(bound.ticket, grant, folderId)` с последующим `backups.initializeFolder(ownerId)`.
   - Отключение (`disconnect`) или смена `epoch` в `kosmora_owner_data_lifecycle` во время OAuth-перехода автоматически отменяет поздний callback (`DRIVE_CONNECT_EXPIRED` / `OWNER_DATA_FENCED`).
   - Функция `createConfiguredGoogleDriveStack` считывает конфигурацию отдельного клиента (`KOSMORA_GOOGLE_DRIVE_CLIENT_ID`, `KOSMORA_GOOGLE_DRIVE_CLIENT_SECRET`, `KOSMORA_GOOGLE_DRIVE_REDIRECT_URI`) и 32-байтного ключа шифрования `KOSMORA_GOOGLE_DRIVE_GRANT_KEY` для `DriveGrantCipher` (AES-256-GCM).

2. **Подключение единого экземпляра `GoogleDriveBackups` к API и `OwnerPrivacyCoordinator` + честный статус многотомных архивов (`apps/api/src/server.ts`, `apps/api/src/cloud-storage/google-drive-controller.ts`)**:
   - Один и тот же экземпляр `GoogleDriveBackups` передаётся в `googleDrivePrivacyAdapter(database.sqlite, backups)` и в `GoogleDriveController`, поэтому при запуске экспорта или удаления данных владельца `quiesce(ownerId)` останавливает активные операции Drive и блокирует новые загрузки (`OWNER_DATA_FENCED`).
   - Агрегатор `aggregateMultipartBackupSets` группирует части архива по `backupSetId` (`set_<id>_part_<k>_of_<N>`) и выставляет `complete: true, state: "verified"` **только тогда, когда все `1..totalParts` частей присутствуют и каждая часть прошла обратное скачивание и SHA-256 проверку (`verified`)**. Если загружена только одна часть из нескольких, набор имеет статус `incomplete` / `in_progress` / `uncertain` / `failed`, а HTTP-маршрут создания копии возвращает `202 Accepted` вместо `200 OK`.

3. **Сборка архивов из существующих экспортов без SQLite, токенов и системных секретов (`apps/api/src/cloud-storage/google-drive-archive-builder.ts`)**:
   - Функция `buildDriveArchiveSetFromCoordinator` собирает архив из `OwnerPrivacyCoordinator.export(ownerId)` и `coordinator.binary(ownerId, store, id)` с проверкой каждого бинарного оригинала через `verifiedOriginal` (размер + SHA-256).
   - Функция `sanitizeExportSectionsForDrive` строго исключает невосстанавливаемые и чувствительные секции/коллекции (`cloud-storage`, `policy-projects`, `agent-studio`, `code`, `work`, `computer-control`, `identity_sessions`, `step_up_proofs`, `owner_credentials`, `point_overrides` и др.), вычищает любые поля с токенами/секретами и блокирует бинарные файлы `.sqlite*`, `.db*`, `.pem`, `.key`, `.env`.
   - Большие оригиналы не пропускаются молча: они разбиваются на детерминированные чанки по 2 МиБ с фиксацией SHA-256 каждого чанка и полного файла в `manifest.json`, а сами ZIP-части формируются строго в пределах лимита транспорта `DRIVE_ARCHIVE_MAX_BYTES` (4 МиБ).

4. **Транзакционное восстановление со строгой проверкой схемы и предпросмотром (`apps/api/src/cloud-storage/google-drive-restore.ts`)**:
   - `validateAndUnpackRestoreParts` проверяет структуру каждого ZIP-тома, CRC32 всех файлов, `schemaVersion === 1`, совпадение `ownerId` и `backupSetId`, наличие всех частей `1..totalParts`, отсутствие запрещённых секций/коллекций и целостность SHA-256 всех собранных оригиналов до обращения к SQLite.
   - `previewDriveRestore` возвращает точное количество восстанавливаемых проектов, общих чатов, сообщений, документов, холстов, исследований и оригиналов без записи в БД.
   - `executeTransactionalDriveRestore` выполняется внутри одной транзакции `BEGIN IMMEDIATE ... COMMIT` (с `ROLLBACK` при любой ошибке): генерирует новые UUID для всех проектов, чатов, сообщений, документов, холстов и исследований с перепривязкой внутренних ссылок (`project_id`, `chat_id`), никогда не перезаписывая текущие данные владельца.

5. **Owner-only маршруты, защита OAuth callback и панель в настройках (`apps/api/src/cloud-storage/google-drive-routes.ts`, `apps/web/src/app/personal-settings/google-drive-panel.tsx`)**:
   - Зарегистрированы owner-only маршруты `/api/v1/personal-settings/google-drive/status`, `/connect/start`, `/connect/callback`, `/disconnect`, `/folder/retry`, `/backups`, `/backups/:archiveId/retry`, `/backups/:archiveId/reconcile`, `/restore/preview` и `/restore`.
   - Маршруты `/connect/callback` работают с `config: { logLevel: "silent" }`, заголовками `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` и никогда не логируют `code`/`state` и не возвращают `grant` в ответах.
   - В `apps/web/src/app/personal-settings/google-drive-panel.tsx` (подключён в `personal-settings/page.tsx`) добавлена панель управления Google Drive на существующих классах `personal-settings.module.css` без изменения CSS, чата, сайдбара или логотипа.

## 2. Что проверено

- Полный прогон модульных и интеграционных тестов `apps/api/test/google-drive-complete.test.ts` на реальной SQLite (`node:sqlite`) и миграции `0060_drive_storage.sql`:
  - привязка одноразового `state` к серверному `DriveConnectTicket`, блокировка чужой сессии (`DRIVE_OAUTH_SESSION_MISMATCH`), блокировка повторного использования `state` (`DRIVE_OAUTH_STATE_INVALID`), отмена позднего OAuth callback при смене privacy-эпохи (`DRIVE_CONNECT_EXPIRED`) и отсутствие токенов в ответах;
  - остановка загрузок (`OWNER_DATA_FENCED`) через общий `GoogleDriveBackups` в `googleDrivePrivacyAdapter`, честный статус `incomplete`/`uncertain` для незавершённых многотомных наборов, отказ при подмене байтов на `retryUpload` (`DRIVE_ARCHIVE_CHANGED`) и успешный повтор с исходными байтами;
  - исключение сессий, политик и секретов при сборке архива, предпросмотр `previewRestoreFromDrive` и транзакционное восстановление `executeRestoreFromDrive` в новые ID без перезаписи существующих проектов и чатов;
  - отказ на архивах с запрещёнными коллекциями (`DRIVE_RESTORE_FORBIDDEN_COLLECTION`) и полный откат `ROLLBACK` при ошибке целостности внутри транзакции.

## 3. Ограничения

- Для реального OAuth-согласия на боевом сервере оператор должен задать переменные окружения `KOSMORA_GOOGLE_DRIVE_CLIENT_ID`, `KOSMORA_GOOGLE_DRIVE_CLIENT_SECRET`, `KOSMORA_GOOGLE_DRIVE_REDIRECT_URI` и 32-байтный ключ `KOSMORA_GOOGLE_DRIVE_GRANT_KEY`, а также применить миграцию `0060_drive_storage.sql` после завершения сетевой приёмки VPS.
