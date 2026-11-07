# Блок памяти Kosmora/Koswork — поставка

- **Ветка:** `deepseek/context-memory-completion`
- **База:** `338536ee5946f96dcd18768143cc41af998c476a` (_main после PR №463 от 7 ноября 2026_)
- **Владелец реализации:** DeepSeek
- **PR:** без самостоятельного merge/deploy

## Что было

Модуль памяти уже существовал и был рабочим: `ContextMemoryStore` (записи со
ссылками на первоисточник, версии, настройки области, профиль-кандидаты, usage),
лексический recall через FTS, `SemanticHistoryIndex` (E5-энкодер, инкрементальный
скоуп-индекс, RRF-слияние), извлекающее сжатие истории
`compactChatHistory` с проверкой `verifyHistoryCompaction`, адаптер приватности
`SemanticMemoryPrivacy`, а также подключение к реальным сборщикам запросов
(`packages/core/src/chat.ts`, `general-chat-store`, `manager-work-coordinator`,
`computer-control/service`).

Проверено прогоном: 116 существующих тестов модуля проходили до изменений.

**Фактический пробел:** у владельца не было операции «забыть весь чат/проект».
`forget` удалял только одну запись по `id` + `version`. Массового удаления по
области не существовало ни в хранилище, ни в HTTP-маршрутах.

## Что работает теперь

1. **`ContextMemoryStore.forgetScope(target, owner)`** — удаляет все записи
   владельца, привязанные к чату или проекту, в одной транзакции.
   Возвращает `forgotten_entries`, `removed_versions`, `removed_memory_index_chunks`,
   `original_messages_deleted: false`, `settings_retained: true`.
   - Каноничные сообщения и настройки области остаются: забывается память, а не
     переписка.
   - Производные векторные строки удаляются существующими триггерами схемы 0063
     (`semantic_notes_delete` → `DELETE FROM semantic_index_sources`), каскад
     снимает чанки и повышает `generation` индекса.
   - Операция подчиняется тем же инвариантам, что и остальные записи:
     `OWNER_DATA_FENCED` при незавершённом жизненном цикле владельца,
     `MEMORY_RUN_ACTIVE` при активном прогоне, `MEMORY_TARGET_NOT_FOUND` для
     чужой/несуществующей области.
2. **`DELETE /api/v1/memory/targets/:kind/:targetId/entries`** — маршрут в
   существующем `registerContextMemoryRoutes`, который вызывается из `apps/api/src/app.ts`.
   Тот же обработчик ошибок `ContextMemoryError`, `Cache-Control: private, no-store`,
   та же граница владельца через `identityFor`.
3. **Сквозной приёмочный сценарий** `apps/api/test/memory-acceptance.test.ts`:
   длинная переписка (17 сообщений, 11 280 байт источника), несколько версий
   требований, даты, сумма «19 700 ₽», код «00123», отрицание «Кроме доставки»,
   конфликтующая ассистентская оценка «21 000 ₽», отдельный проект.
   Проверяется: сжатие сохраняет числа/исключение/код и ссылки на источники;
   recall находит исправленное значение и происхождение; устаревшее значение не
   подменяется молча; отзыв гранта и забывание области убирают данные из recall
   и из индекса.
4. **`scripts/measure-memory-acceptance.mjs`** — воспроизводимые измерения на
   фикстурном корпусе (см. ниже).

## Изменённые файлы

| Файл                                      | Изменение                               |
| ----------------------------------------- | --------------------------------------- |
| `packages/db/src/context-memory-store.ts` | +`forgetScope` (34 строки)              |
| `packages/db/test/context-memory.test.ts` | +3 теста: области, индекс, блокировки   |
| `apps/api/src/context-memory-routes.ts`   | +маршрут `DELETE .../entries` (6 строк) |
| `apps/api/test/context-memory.test.ts`    | +1 тест маршрута через `app.inject`     |
| `apps/api/test/memory-acceptance.test.ts` | новый сквозной сценарий, 5 тестов       |
| `scripts/measure-memory-acceptance.mjs`   | новый скрипт измерений                  |

Миграции не добавлялись: новых таблиц нет, использована существующая схема 0056/0063.

## Команды и результаты

Все команды выполнены в этом checkout (Windows, Node v24.21.0, pnpm 11.19.0).
Сторонние модели и провайдер не вызывались.

```powershell
# зависимости и сборка зависимостей
node <pnpm.mjs> install --frozen-lockfile
node <pnpm.mjs> --filter "@cosmora/api..." build

# тесты модуля
cd packages/db && node .../vitest.mjs run test/context-memory.test.ts
# → 22 passed (было 19)

cd apps/api && node .../vitest.mjs run test/context-memory.test.ts test/memory-acceptance.test.ts test/semantic-history-index.test.ts
# → 10 + 5 + 14 passed

cd packages/core && node .../vitest.mjs run test/context-memory.test.ts test/context-memory-packing.test.ts test/history-compaction.test.ts test/context-evidence-selection.test.ts
# → 36 passed

# статические проверки
node <pnpm.mjs> --filter @cosmora/db --filter @cosmora/api typecheck   # Done
node <pnpm.mjs> --filter @cosmora/db --filter @cosmora/api lint        # Done

# измерения
node scripts/measure-memory-acceptance.mjs
```

Фактический вывод измерений (`fixture: true`, `provider_called: false`):

```json
{
  "corpus": {
    "messages": 17,
    "source_bytes": 11280,
    "capsule_bytes": 5443,
    "ratio": 48.3,
    "protected_spans": 8,
    "protected_kept": 8,
    "omitted_spans": 0,
    "duplicate_spans": 92,
    "compaction_ms": 6.99
  },
  "coverage": {
    "required_facts": 4,
    "extracted_facts": 4,
    "missing": [],
    "superseded_kept_in_capsule": 1
  },
  "recall": {
    "memory_hits": 1,
    "correct_entry": true,
    "stale_hits_user_role": 1,
    "retrieval": "lexical",
    "bundle_bytes": 2573
  },
  "index": {
    "builds": 21,
    "build_ms": 52.7,
    "indexed_sources": 18,
    "indexed_chunks": 32,
    "paraphrase_hybrid": true
  },
  "revocation": {
    "history_items_after_revoke": 0,
    "index_rows_left": 0,
    "forgotten_entries": 1,
    "items_after_forget": 0
  }
}
```

Как читать эти числа честно:

- `ratio: 48.3` — это _байты капсулы от байт сжатого префикса_, а не «экономия
  токенов» и не заявление о качестве. Токены не измерялись: токенизатора для
  этого маршрута в репозитории нет, байты — единственная честная граница.
- `extracted_facts: 4/4` — все четыре обязательных значения корпуса
  («19 700», «00123», «Кроме доставки», «17 350») присутствуют в капсуле.
- `superseded_kept_in_capsule: 1` и `stale_hits_user_role: 1` — устаревшая сумма
  «17 350» **намеренно** остаётся в истории как более ранняя версия с ролью
  пользователя. Она не выдаётся за текущую: актуальное значение приходит из
  `recent`-сообщений и из записи памяти, а `CONTEXT_MEMORY_RULES` прямо требует
  считать явное текущее исправление владельца важнее старой цитаты.
- `build_ms: 52.7`, `indexed_chunks: 32` — стоимость построения производного
  индекса для этого корпуса. **Энкодер заменён фикстурой** (one-hot), поэтому
  время не включает инференс E5 и ничего не говорит о качестве семантического
  поиска. Проверяется только конвейер: запись строк, чанков, скоупа и слияния.

## Ограничения

- Настоящий провайдер и E5-энкодер в этом прогоне **не вызывались**. Семантический
  путь проверен фикстурным энкодером; реальное качество paraphrase-recall этим
  не доказано.
- `forgetScope` забывает записи области `chat`/`project` и производный индекс, но
  **не** удаляет каноничные сообщения и не очищает `context_memory_usage`
  (журнал «что было отправлено» остаётся аудитом). Экспорт/удаление всего
  владельца по-прежнему идёт через `AccountCorePrivacyAdapter`, который уже
  охватывает `context_memory_entries`, `context_memory_versions`,
  `context_memory_usage`.
- UI-контрол «Забыть всё в этом чате» не добавлен: это отдельное продуктовое
  решение и визуальное изменение, требующее согласования по `apps/web/UI_RULES.md`.
- Новых миграций нет; при параллельных блоках номера не конфликтуют.
- Сквозная приёмка первого этапа, VPS, Windows-приёмка и Jarvis остаются
  незакрытыми, как и было предписано.

## Интеграция

Маршрут уже зарегистрирован существующим `registerContextMemoryRoutes` в
`apps/api/src/app.ts`; дополнительной регистрации не требуется.

```
DELETE /api/v1/memory/targets/chat/<chatId>/entries
DELETE /api/v1/memory/targets/project/<projectId>/entries
→ 200 {
    "target": { "kind": "chat", "id": "…" },
    "forgotten_entries": 3,
    "removed_versions": 5,
    "removed_memory_index_chunks": 12,
    "original_messages_deleted": false,
    "settings_retained": true
  }
```

Для прямого использования из кода:

```ts
store.forgetScope({ kind: "chat", id: chatId }, ownerId);
```

## Откат

Изменения аддитивные и не меняют формат данных.

- Код: `git revert <commit>` — удаляются метод, маршрут, тесты и скрипт.
- Данные: удалённые записи памяти восстановлению не подлежат (они удаляются
  каскадно вместе с версиями). Каноничные сообщения и настройки области не
  затрагивались, поэтому откат кода не требует миграции.
- Индекс: строки `semantic_index_sources` для забытых записей снимаются
  триггерами; при откате они будут перестроены из оставшихся источников.
