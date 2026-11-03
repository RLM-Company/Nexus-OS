# Handoff: Предпросмотр/извлечение PDF и Office в Local Vault, адресуемое чтение крупных снимков, восстановление памяти с разрешением конфликтов и починка CI

- **Репозиторий**: `https://github.com/RLM-Company/Nexus-OS`
- **Связанные ветки стека**:
  - `codex/koswork-local-vault-20261031` ([PR #420](https://github.com/RLM-Company/Nexus-OS/pull/420), `docs/handoff/KOSWORK_LOCAL_VAULT_2026-10-31_RU.md`)
  - `codex/koswork-memory-usage-20261031` ([PR #424](https://github.com/RLM-Company/Nexus-OS/pull/424), `docs/handoff/KOSMORA_MEMORY_RECEIPTS_2026-11-01_RU.md`)
- **Рабочая ветка**: `feature/koswork-vault-docs-and-memory-restore-20261101`

## 1. Что реализовано

1. **Локальное извлечение текста и предпросмотр PDF и Office (`.pdf`, `.docx`, `.xlsx`, `.pptx`) + адресуемое чтение фрагментов до 12 000 символов (`desktop/windows/vault-document-extractor.cjs`)**:
   - Реализован полностью автономный локальный парсер контейнеров Office OpenXML (`.docx`, `.xlsx`, `.pptx`) и PDF (`.pdf`) на встроенных модулях Node.js (`node:zlib`, `node:crypto`) без внешних бинарных утилит и без сетевых обращений:
     - **Защита от zip-bomb и повреждения архива (`unpackSafeZipArchive`)**: проверка EOCD (`0x06054b50`), лимит до `1000` внутренних файлов, потолок распаковки `16 МиБ` (`maxOutputLength`), проверка CRC32 каждого элемента и блокировка `..`/абсолютных путей внутри архива.
     - **Извлечение структуры документов**: абзацы и табуляции Word (`word/document.xml`), общие строки, имена листов и ячейки таблиц Excel (`xl/sharedStrings.xml`, `xl/workbook.xml`, `xl/worksheets/sheet*.xml`), по-слайдовый текст презентаций PowerPoint (`ppt/slides/slide*.xml` с заголовками `[Слайд N]`) и текстовые потоки PDF (`%PDF-`, `FlateDecode`, операторы `BT..ET`, `Tj`, `TJ`, UTF-16BE `<FEFF...>` и восьмеричные/escape-последовательности с честным статусом `no_text_layer` для сканов без текстового слоя).
     - **Адресуемое чтение крупных материалов (`splitTextIntoAddressableChunks`, `readAddressableVaultSlice`)**: документы длиннее лимита передачи в чат (`12 000` символов) никогда не обрезаются молча — они разбиваются по границам строк/абзацев на адресуемые фрагменты `1..totalChunks` с индивидуальным `sha256`, `charStart`, `charEnd`, `hasPrevious`, `hasNext` и `truncatedSilently: false`.

2. **Адресуемое чтение крупных снимков памяти и восстановление на сервер с разрешением конфликтов (`apps/api/src/memory-snapshot-reconciler.ts`)**:
   - Строгая валидация снимка (`validateAndParseMemorySnapshot`): до `1000` записей (`MAX_SNAPSHOT_RECORDS`), до `1000` настроек (`MAX_SNAPSHOT_SETTINGS`), до `4 МиБ` JSON (`MAX_SNAPSHOT_JSON_BYTES`), проверка SHA-256 каждой записи и блокировка любых сессионных паролей/токенов (`SNAPSHOT_SECRET_REJECTED`).
   - Адресуемая пагинация и фильтрация по крупному снимку (`readAddressableSnapshotSlice`): выборка по `scope` (`personal` / `chat` / `project`), `scopeId`, `recordType`, текстовому фильтру `query` и курсору (`cursor`, `limit`, `nextCursor`, `totalMatching`) без необходимости загружать все 1000 записей одновременно.
   - Планировщик и транзакционное восстановление с разрешением конфликтов (`planMemorySnapshotRestore`, `executeMemorySnapshotRestore`):
     - Проверяет отсутствие блокировки `kosmora_owner_data_lifecycle` (`OWNER_DATA_FENCED`) и отсутствие активных запусков (`MEMORY_RUN_ACTIVE`).
     - Классифицирует каждую запись снимка относительно серверной БД: `unchanged`, `create`, `fast_forward` (когда `baseServerVersion === server.version` и `client.version > server.version`) или `conflict` (расхождение версий/хешей или коллизия ключа).
     - Требует явного решения владельца по каждому конфликту (`keep_server`, `replace_with_client` с проверкой `expectedServerVersion` или `fork_as_new_record` с созданием новой записи без затирания серверной версии) и применяет изменения в одной транзакции `BEGIN IMMEDIATE ... COMMIT`.

3. **Устранение падений CI в `PR #420` (`Windows desktop`) и `PR #424` (`Browser acceptance`) (`scripts/remediate-memory-and-vault-ci.mjs`)**:
   - Для `PR #420` (`codex/koswork-local-vault-20261031`, [CI Run #41222374249](https://github.com/RLM-Company/Nexus-OS/actions/runs/41222374249)): автоматическая регистрация модулей Local Vault (`local-vault.cjs`, `vault-document-extractor.cjs` и UI-файлов хранилища) в `desktop/windows/package.json` (`build.files` и `scripts.check`).
   - Для `PR #424` (`codex/koswork-memory-usage-20261031`, [CI Run #41320783916](https://github.com/RLM-Company/Nexus-OS/actions/runs/41320783916)): очистка остаточных записей памяти между последовательными тестами и ретраями Playwright на общей фикстуре порта `3226` в `apps/web/e2e/context-memory.spec.ts` (`resetOwnerMemoryFixture` в `test.beforeEach`), устраняющая ложный `HTTP 409 Conflict` на строках `174` и `238` без ослабления серверных проверок `MEMORY_RUN_ACTIVE` и `expected_version`.

## 2. Что проверено

- `node --test desktop/windows/test/vault-document-extractor.test.cjs` — проверены локальное извлечение `.docx`, `.xlsx`, `.pptx`, `.pdf`, адресуемое чтение документа > 32 000 символов порциями до 12 000 символов без потери текста, блокировка zip-bomb (> 16 МиБ), traversal внутри ZIP и некорректных PDF.
- `node scripts/integration-vault-memory-smoke.mjs` — проверены лимиты снимка (`1000` записей, `1000` настроек, `4 МиБ`, запрет токенов), пагинация `readAddressableSnapshotSlice`, блокировка `MEMORY_RUN_ACTIVE`, обнаружение конфликтов и атомарное разрешение через `keep_server`, `replace_with_client` и `fork_as_new_record`, а также авто-патчер CI для `PR #420` и `PR #424`.
