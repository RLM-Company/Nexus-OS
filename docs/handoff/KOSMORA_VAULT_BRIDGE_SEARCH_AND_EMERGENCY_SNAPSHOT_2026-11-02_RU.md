# Виртуальный мост `.kosmora-vault` для Office/PDF, пагинация и журнал поиска браузера Koswork и полный аварийный снимок аккаунта

Дата: `2026-11-02`
Ветка: `feature/kosmora-vault-bridge-search-and-emergency-snapshot-20261102`
Связанные PR стека: `#415`, `#421`, `#425`

## 1. Назначение блока

Этот блок закрывает ограничения, зафиксированные в `docs/handoff/KOSWORK_VAULT_AGENT_SEARCH_2026-10-31_RU.md` (`#421`), `docs/handoff/KOSWORK_OWN_SEARCH_2026-10-29_RU.md` / `KOSWORK_BROWSER_FINISH_2026-10-29_RU.md` (`#415`) и `docs/handoff/KOSMORA_DRIVE_BACKUP_RESTORE_2026-11-02_RU.md` (`#425`):

1. **Виртуальный мост `.kosmora-vault/<SHA256>/<offset>` с поддержкой бинарных Office/PDF и сохранением разрешений (`desktop/windows/vault-virtual-bridge.cjs`):**
   - **Безопасная нарезка UTF-16 (`sliceUtf16SurrogateSafe`):** выдаёт фрагменты до `6000` UTF-16 единиц, никогда не разрезая суррогатные пары (`0xD800..0xDBFF` / `0xDC00..0xDFFF`) ни на начальной, ни на конечной границе.
   - **Распознавание бинарных документов в `.kosmora-vault`:** индексирует как UTF-8 файлы без `NUL`, так и бинарные `.pdf`, `.docx`, `.xlsx`, `.pptx` через локальный экстрактор `vault-document-extractor.cjs`.
   - **Контроль размера сериализованного ответа:** при превышении `maxSerializedBytes` возвращает явную ошибку `VAULT_SERIALIZED_RESPONSE_TOO_LARGE` без невалидного обрезания JSON.
   - **Совместная работа с рабочей папкой (`connectRegularWorkspaceFolder`):** подключение или смена обычной рабочей папки сохраняет активный 30-минутный грант задачи `preserveAcrossWorkspaceSwitch` на чтение `.kosmora-vault`.

2. **Журнал поисковых выдач, пагинация, закладки и телеметрия 3 вкладок браузера Koswork (`desktop/windows/browser/search-pagination-and-bookmarks.cjs`):**
   - Детерминированная пагинация результатов `duckduckgo` (`page`, `pageSize <= 5`, `totalPages`, `hasNextPage`) и журнал до `100` последних поисковых выдач с навигационным адресом `koswork://search/srch-<hash>` без утечки текста запроса в историю URL Chromium.
   - Постоянное хранилище закладок (`addBookmark` / `listBookmarks`) и учёт потребления RAM/CPU/DOM-токенов (`registerWebViewUsage`) с автоматическим вытеснением самой старой вкладки при превышении лимита `3` загруженных `WebContentsView`.

3. **Полный аварийный снимок аккаунта в формате ZIP STORE (`apps/api/src/cloud-storage/full-account-emergency-snapshot.ts`):**
   - Экспорт и атомарное восстановление (`exportFullAccountEmergencyZip` / `restoreFullAccountEmergencyZip`) всех данных владельца (`general_chats`, `general_chat_messages`, опубликованные `work_artifact_versions` и `context_memory_entries`) в каноническом формате `ZIP STORE` (`manifest.json` + чанки `snapshot.partNNNN.json` по `2 МиБ` с проверкой `CRC32` и `SHA-256`) и автоматическим переводом прерванных `pending`/`streaming` сообщений в `cancelled`.

## 2. Проверенные сценарии

Запуск `node scripts/integration-vault-bridge-search-and-emergency-smoke.mjs`:
- `desktop/windows/test/vault-bridge-and-search-store.test.cjs` — `2/2 PASS` (защита суррогатных пар эмодзи `🚀`/`🪐`, чтение `.docx` через `.kosmora-vault/<SHA256>/0`, сохранение гранта при подключении рабочей папки, явный отказ `VAULT_SERIALIZED_RESPONSE_TOO_LARGE`, пагинация 12 результатов по 5 на страницу, вытеснение 4-й вкладки `WebContentsView`).
- `apps/api/test/full-account-emergency-snapshot.test.ts` — `1/1 PASS` (полный аварийный экспорт и идемпотентное восстановление чатов, сообщений, файлов Work и памяти с переводом `streaming -> cancelled`).
