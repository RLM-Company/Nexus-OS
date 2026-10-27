# Kosmora — финальная объединённая интеграция v3 (2026-10-09)

**База для полного патча:** `76e44320f20ae4cdc70f5202ac9e77d30c34eef7`, исходный `kosmora-source-76e4432.zip`. Полный ZIP — исходники после объединения первых и вторых пакетов плюс адресные исправления v3. Патч `full` применять только к точной базе; `incremental` — только к предыдущему ZIP `kosmora-integrated-76e44320-source.zip`; `shared` — только к предыдущему ZIP, а не к чистой базе. Не накладывать v2 пакеты второй раз.

## Реализовано

- Единый `AccountStore` используется обычным чатом, Manager, Work v1, документами, research и Code; платный dispatch без него отклоняется. `reserve` происходит до разрешения Gateway продолжить dispatch, учёт `canonical usage` не предполагает известных токенов/цены при отсутствии данных. `uncertain hold` сохраняется до доказанного расчёта; локальный `pre-dispatch` отказ освобождает `reserved` hold. На старте идемпотентно очищаются только те holds, для которых подтверждён canonical usage и цена.
- Retained ledger теперь сохраняет реальный `run_id` при удалении owner/project/chat, чтобы не списывать один неизвестный расход повторно. Четыре SQL-триггера используют явный список столбцов; учёт retained и старых незавершённых попыток консервативен. SQL-проверка миграций не пропускает несовместимый старый вариант 0030.
- Privacy: обязательный реестр owner-scoped adapters, durable quiesce/epoch/fence от поздних записей, включая Work queue, экспорт бинарных оригиналов в ZIP с `manifest.json` и проверками размера/MIME/SHA-256; failure не оставляет export fence. Удаление только по продуктовому challenge/phrase и после quiesce. Auth/operational audit/ledger и uncertain holds сохраняются. Отсутствующие и неподготовленные stores — fail-closed, а не «экспортировано всё».
- Documents: реальная библиотека с owner/project scoped оригиналами, цитаты проверяются по существующим фрагментам перед выдачей ответа. Research: модельный синтез по фактически полученным выдержкам, референсы проходят проверку. History: owner scoped FTS, фильтры, безопасное экранирование пользовательского поиска и переходы. Code: HTTP OCI runner, только при настроенном sidecar; Docker runtime НЕ проверялся.
- UI root и новые Canvas/Data/Windows/WorkDAG v2 не переписывались. WorkDAG v1 сохранён, v2-пакет ожидается отдельно. Не затронуты `globals.css`, `workspace-sections.module.css`, `github.module.css`, login-косметика и GitHub import navigation. Без глобального редизайна; платные media, tool_calling, English relay по умолчанию остаются OFF.

## SQLite upgrade — только на остановленном приложении

1. Сделать отдельный консистентный backup SQLite и WAL; убедиться, что нет активных writer, процессов, `-wal`/`-shm`, и проверить SHA-256 исходника/backup. **Не запускать offline-скрипты на работающем сервере.**
2. Если старая база уже имеет миграции 26–28, но не таблицы 25 (`document_library_files/chunks/fts`), запустить offline: `node scripts/retrofit-document-library.mjs --apply --database /path/db.sqlite --backup /safe/path/pre-25.sqlite`. После этого приложение применяет оставшиеся journal записи обычным способом. Скрипт требует отдельный backup и проверяет целостность.
3. Если ранее установлен _старый_ вариант 0030 без `kosmora_retained_accounting.run_id`, после полной остановки запустить `node scripts/retrofit-retained-accounting.mjs --apply --database /path/db.sqlite --backup /safe/path/pre-retained.sqlite`. Скрипт работает **только при нуле retained rows**: сохранённые старые записи уже не имеют `run_id`, восстановить linkage достоверно невозможно. Если есть хотя бы одна — `NONEMPTY_LEGACY_RETAINED_HISTORY`, жёсткий STOP и ручная сверка с ledger/backup; никаких заглушек или автоматических нулевых списаний. Эта операция идемпотентным повторным действием не является: при уже добавленном столбце отказывает.
4. После offline-bridge проверять `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, наличие таблиц/столбцов и journal, затем запускать официальную `pnpm db:migrate` на копии базы. Порядок новых слотов: **25→26→27→28→30→32→34**. Не заполнять 29/31/33: 31 зарезервирован WorkDAG, 35 Canvas, 36 Data.
5. На копии выполнить privacy export owner с файлами, challenge/delete только тестового owner, проверить, что другой owner, auth и ledger остались. Затем отдельный Docker/HTTP OCI E2E и UI проверка.

## Воспроизведение локальных smoke gates без сети и без платного API

```bash
node --no-warnings scripts/integration-native-smoke.mjs
node --no-warnings scripts/integration-legacy-upgrade-smoke.mjs
node --no-warnings scripts/integration-retained-upgrade-smoke.mjs
node --no-warnings scripts/integration-privacy-e2e-smoke.mjs
node --no-warnings scripts/integration-history-work-fence-smoke.mjs
node --no-warnings scripts/integration-citations-smoke.mjs
node --test scripts/test/check-secrets.test.mjs scripts/test/provider-connection-check.test.mjs deploy/alpha/test/healthcheck.test.mjs
```

Инварианты, проверенные на SQLite: миграции (32 шага), quota/hold idempotency и reconciliation без двойного списания, неизвестная цена сохраняет резерв, SQL-fence и второй владелец, реальный FTS, сохранившиеся ledger/Auth, ZIP с бинарниками/manifest, отказ при MIME mismatch, offline-bridge старой 25 и старой 30, корректная блокировка истории старого 30 с уже удержанными retained rows. Документы и research проверены на реальной функции валидации, **не на живых моделях**.

## Обнаруженный внешний блокирующий gate

- `node scripts/check-secrets.mjs` **FAIL** на уже имевшемся в предыдущем интегрированном ZIP `desktop/windows/test/draft-store.test.cjs:46`: строка синтетического теста содержит буквальный PEM-заголовок `BEGIN PRIVATE KEY`. Это **не настоящий ключ**, а проверка того, что Windows draft store отклоняет подобное содержимое; тем не менее scanner останавливает поставку. Файл Windows не менялся согласно разделению ответственности с отдельным Windows-чатом. Владелец Windows-блока должен сохранить тестовую семантику, но устранить буквальное совпадение со scanner, после чего повторить gate. Нельзя просто ослаблять правила сканирования секретов или объявлять gate пройденным.

## Обязательные gates перед deployment (UNVERIFIED)

- `corepack pnpm install --frozen-lockfile` по утверждённому lockfile, затем `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Из-за отсутствия проектных `node_modules` и pnpm в переданной среде **не выполнены**.
- Реальный Docker/OCI isolation, upgrade/integration running API, полноценная браузерная регрессия UI, Code execution, ручная сверка оплаченных моделей с provider usage и работа с рабочими секретами **не выполнены**.
- Большие owner exports сверх установленных ограничений отвечают fail-closed с явным сообщением о необходимости segmented exporter; не считать их успешным архивированием.
- Privacy удаление является необратимой продуктовой операцией, нельзя запускать на рабочей пользовательской базе до подтверждения всех mandatory adapters и теста восстановления.

## Deployment / rollback (план, не выполнено)

1. Интегратор на своей ветке применяет **один** из full/incremental патчей; проверяет `git apply --check`, test gates и что чужая ветка UI остаётся без конфликтов; не мержит незавершённый WorkDAG v2 автоматически.
2. На staging делает остановку background workers и writes, snapshot DB/attachments, контроль hashes, offline-bridges (если нужны), миграции и smoke/E2E на **копии** данных; устанавливает sidecar только после отдельного security review.
3. При FAILED gate восстановить приложение прежней версии **вместе с до-миграционной копией SQLite и оригиналами**. Не запускать старый бинарник поверх новой схемы «на удачу». Сохранить лог gate failure, не удалять удержания расходов.
4. Production deployment и merge — только после ручной авторизации главного интегратора; данный пакет ничего не выполнял на VPS/main.
