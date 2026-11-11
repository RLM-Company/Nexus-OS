# DELIVERY — 04_DEEPSEEK, срез D: честный expiry + restart-долговечность

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `d047ce125f623c64d2615a6235dfdcd1c8e70a55` (база ветки); перед
  открытием PR влит актуальный `main` `931cc0c` (+11 коммитов), конфликтов нет.
- **Ветка:** `ops/deepseek-memory-restart` (новая, не продолжает `ops/deepseek-memory`).
- **PR:** открывается в `main`, без merge/deploy.
- **HEAD_SHA:** см. `git log -1` ветки (фиксируется в CHECKPOINT_RESTART.md).
- **ID отчётов:** `04_DEEPSEEK` (файлы с суффиксом `_RESTART`, чтобы не затирать A/B/C).

## Сценарий до / после

**До.** Истёкшая запись (`expires_at` в прошлом) корректно не попадала в recall,
но `GET /api/v1/memory` / `GET /api/v1/memory/:id` / `localSnapshot()` отдавали её
как обычную, без признака. Владелец в настройках видел запись «Актуально до …»
и не знал, что она уже исключена из ответов. Отдельного restart-сценария для
памяти (переоткрытие SQLite с диска) не было.

**После.**

- `ContextMemoryEntry.expired?: boolean` — новый опциональный признак.
- `ContextMemoryStore.decode()` вычисляет его по `expires_at` и `this.now()`;
  он появляется во всех путях, использующих `decode()` (`get`, `list`,
  `localSnapshot`, `profileCandidates`, `forgetScope`).
- В `context-memory-settings.tsx` рядом с «Актуально до» показывается
  «Срок истёк, запись не попадает в ответы». Без нового экрана/CSS/компоновки.
- Recall-поведение **не менялось**: оно уже было корректным (проверено тестом).
  Это осознанное «повторить сильное поведение, а не строить второй механизм».

## Entrypoint

```
GET /api/v1/memory → ContextMemoryStore.list() → decode() → expired
GET /api/v1/memory/:id → ContextMemoryStore.get() → decode() → expired
GET /api/v1/memory/local-snapshot → localSnapshot() → decode() → expired
apps/web/context-memory-settings.tsx → строка статуса
POST /api/v1/chats/:id/messages → recallForRunAsync() → resolve() (expiry уже отсекает)
```

## Изменённые файлы

| Файл                                             | Изменение                             |
| ------------------------------------------------ | ------------------------------------- |
| `packages/contracts/src/context-memory.ts`       | `ContextMemoryEntry.expired?`         |
| `packages/db/src/context-memory-store.ts`        | `decode()` вычисляет `expired`        |
| `apps/web/src/app/context-memory-settings.tsx`   | честная пометка в существующем списке |
| `packages/db/test/memory-restart-expiry.test.ts` | **новый** 3 сценария                  |
| `docs/team/.../04_DEEPSEEK/*_RESTART.md`         | отчёты петли                          |

Примечание: `docs/research/experience-llm-distill-2026-11-10.json` форматировался
отдельным коммитом, но после вливания `main` `931cc0c` стал идентичен `main` и не
входит в итоговый diff; `INTEGRATION_RESTART.md` сохраняет запись о намерении.

## Команды и фактические результаты

```
packages/db  memory-restart-expiry.test.ts        3 passed
             (expired в list/get/snapshot, restart с диска,
              забытое не воскресает из индекса после restart)
packages/db  полный, --maxWorkers=2              217 passed (38 файлов)
apps/api    полный, --maxWorkers=2              1000 passed (102 файла)
apps/web    полный vitest                       290 passed (55 файлов)
typecheck contracts/db/api/web                   Done
lint      contracts/db/api/web                   Done
prettier --check . / check:secrets / web build   passed
```

Первый прогон нового теста упал дважды по причинам самого теста (повторная
вставка чата при restart; пропущенный `await runMigrations` в синхронном тесте) —
исправлено содержательно, код продукта в этих местах не менялся.

## Миграции / зависимости

Миграций нет, схема БД не менялась, новых зависимостей нет. Внешний провайдер и
E5 не вызывались: все тесты на in-memory/файловом SQLite.

## Полномочия и границы

Не менялись тарифы, квоты, провайдер HY4, права, keys, auth, gateway, memory OFF,
chat/sidebar/logo/global CSS. Multi-Agent/Jarvis/VPS/production/merge — не
выполнялись. Реальные данные владельца, .env, токены, БД пользователей не читались.
Физическое удаление истёкших записей **не** вводилось (продуктовое решение).

## Несовместимости / ограничения

- Поле `expired` опциональное: сторонний код, собирающий `ContextMemoryEntry`
  вручную, получит `undefined`. Активный store заполняет всегда.
- `expired` — статус на момент чтения (`this.now()`), а не сохранённый флаг:
  при изменении часов он пересчитывается. Это соответствует существующей логике
  `allowed()`.
- Живая приёмка, VPS и Windows-клиент остаются отложенными по `AGENTS.md`.

## Что ещё не проверено живьём

Реальный E5/провайдер, живая модель, задержка на живом корпусе.

## Следующий шаг

Критерии `04_DEEPSEEK.md`, доступные без живой модели, закрыты срезами A–D.
Дальнейшее — живая приёмка и выпуск за Codex. Новую петлю внутри сферы начинать
только по указанию владельца.
