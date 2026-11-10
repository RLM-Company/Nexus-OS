# Гибридный поиск памяти, миграция заметок, временный режим и верификация скачивания браузера

Дата: `2026-11-01`
Ветка: `feature/kosmora-hybrid-memory-and-migration-20261101`
Связанные PR стека: `#417`, `#418`, `#419`, `#420`, `#421`, `#424`

## 1. Назначение блока

Этот блок закрывает оставшиеся пункты дорожной карты `docs/product/KOSMORA_MEMORY_2026-10-30_RU.md` (`## Следующие части согласованного блока`) и диагностированную в `#420`/`#421` гонку чтения `result.txt` в упакованном Windows-клиенте:

1. **Гибридный и семантический поиск (`packages/db/src/context-memory-hybrid-search.ts`, `apps/api/src/context-memory-hybrid-routes.ts`):**
   - Нормализация и морфологический стемминг запросов (русский + английский), двуязычное расширение технических синонимов (`бюджет`/`limit`/`cost`, `срок`/`deadline`, `сейф`/`vault`/`archive`, `память`/`memory`/`recall`).
   - Детерминированное (бесплатное, без вызовов платных LLM) обнаружение сущностей (`extractMemoryEntities`): даты (`YYYY-MM-DD`, `DD.MM.YYYY`, русские даты), суммы/лимиты токенов и байт, идентификаторы (`#422`, `PR #417`, миграции, пути репозитория, порты) и названия компонентов (`Kosmora`, `Koswork`, `CheapVibeCode`, `SQLite`).
   - Объединение лексического ранга и семантического сходства (символьные 3-граммы + пересечение стем и сущностей) через **Reciprocal Rank Fusion (RRF, `k = 60`)** с безусловным приоритетом закреплённых ограничений (`pinned = 1`, `kind = 'constraint'`) и строгой упаковкой в бюджет `<= 32` фрагментов и `<= 6000` (настраиваемо до `12000`) байт UTF-8 с флагом `priorityOmitted`.
   - Формирование клиентских ссылок из ответа модели на использованные воспоминания (`buildResponseMemoryCitations`) с точной цитатой, SHA-256 и ссылкой предпросмотра `/personal-settings?memoryPreview=<id>`.

2. **Согласованная миграция прежних заметок и проектной памяти + правила новых чатов и временный режим (`packages/db/src/context-memory-notes-migrator.ts`):**
   - Идемпотентная транзакционная (`BEGIN IMMEDIATE`) миграция активных записей `project_memory` в `context_memory_entries` и `context_memory_versions` по ключу `creation_key = "legacy-project-memory:<id>"` без удаления исходных строк.
   - Сохранение и проверка подлинности исходных источников (`sourceVerified` по таблицам `messages`, `work_artifact_versions`, `projects`) и автоматический пропуск записей с секретами/ключами (`skipped_sensitive`).
   - Общие настройки профиля для новых чатов (`context_memory_owner_defaults`: `defaultEnabled`, `defaultUsePersonal`, `defaultAutoExtract`, `defaultTemporaryMode`) и отдельный **временный режим чата (`temporary_mode = 1`)**, в котором чтение дополнительной памяти и автоматическое извлечение кандидатов строго отключены.

3. **Стабилизация проверки скачивания `result.txt` в упакованном Windows-браузере (`desktop/windows/browser/download-verifier.cjs`):**
   - Синхронный перехватчик `attachDeterministicDownloadHandler` для `session.on('will-download')`, фиксирующий `item.setSavePath(...)` до показа системного диалога.
   - Функция `waitForVerifiedDownload`, ожидающая завершения промежуточных файлов Chromium (`.crdownload`, `.tmp`, `.part`), стабилизации ненулевого размера на двух последовательных тиках и синхронизирующая `result.txt` из резервных каталогов (`Downloads`) в целевую папку фикстуры.

## 2. Проверенные сценарии

Запуск `node scripts/integration-hybrid-memory-and-download-smoke.mjs`:
- `desktop/windows/test/download-verifier.test.cjs` — `3/3 PASS` (ожидание финализации `.crdownload`, реконсиляция из fallback `Downloads`, синхронное выставление `savePath` на `will-download`).
- `apps/api/test/context-memory-hybrid-and-migration.test.ts` — `2/2 PASS` (извлечение сущностей, гибридный RRF-поиск с русско-английскими синонимами, изоляция владельцев, фильтрация секретов, генерация клиентских цитат, идемпотентная миграция `project_memory` с верификацией источника `pmsg-77`, временный режим чата).
