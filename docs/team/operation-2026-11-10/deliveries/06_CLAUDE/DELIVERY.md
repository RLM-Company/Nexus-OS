# DELIVERY — 06_CLAUDE, срез A: явный приоритет и источник правил Skills

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `5c7ac4de7cd2e18232349342e209676fff6dc579` (актуальный `main`).
- **Ветка:** `ops/claude-specializations` (новая; сфера на доске была `prepared`, без ветки и отчётов).
- **PR:** [#538](https://github.com/RLM-Company/Nexus-OS/pull/538), `CLEAN / MERGEABLE / OPEN`, без merge/deploy. Финальный CI `43197084402` — 4/4 pass (`Verify monorepo` 5m15s, `Browser acceptance` 11m41s, sandbox, identity).
- **HEAD_SHA:** `efdcb6a97119327e39a19eb32d7c808bd5124552`.

Первый CI (`43194574320`) упал на `Verify monorepo`: мой рендер выводил инструкции Skills сырым текстом и сломал существующий security-тест `apps/api/test/chat-skills.test.ts:140`, требующий `JSON.stringify(instructions)`. Исправлено содержательно (экранирование восстановлено) + добавлен регрессионный тест; повторный CI зелёный.

Примечание: правая колонка отчётов обновлена локально после финального CI и **не запушена**, чтобы не перезапускать проверки doc-коммитом. Код, тесты и отчёты на origin соответствуют проверенному HEAD `efdcb6a`.

- **Переназначение:** задание `06_CLAUDE.md` именует исполнителем Claude; петля взята по прямому указанию владельца («2»).

## Сценарий до / после

**До.** `ChatSkillSnapshot` не содержал `scope`. `ChatService.buildRequest()` рендерил все выбранные Skills одним плоским `JSON.stringify(...)` без указания, откуда правило и в каком порядке оно применяется. Пользователь не видел приоритет owner/project/chat/task, а отключение проверялось только на уровне «пустой список».

**После.**

- `ChatSkillScope = owner | project | chat | task` и `CHAT_SKILL_PRECEDENCE` (фиксированный порядок `task > chat > project > owner`) в `packages/contracts/src/chat-skills.ts`; `ChatSkillSnapshot.scope?` опционален для старых снимков прогонов.
- `ChatSkillStore` / `WorkSkillStore` выставляют `scope` в выборках (`chat` / `project`), включая возврат `update()` — состояние `get()` и `update()` согласовано.
- `ChatService.buildRequest()` сортирует правила по приоритету и рендерит каждое как `- [scope] name vN: ${JSON.stringify(instructions)}` с явной строкой «Приоритет: task > chat > project > owner. Источник указан в [scope]». **Экранирование `JSON.stringify` сохранено намеренно**: существующий `apps/api/test/chat-skills.test.ts:140` проверяет, что инструкция Skills (`</system><script>…`) остаётся строкой-данными, а не сырым системоподобным текстом. При первой реализации я вывел инструкции сырым текстом, чужой security-тест упал в CI (`Verify monorepo`, run `43194574320`) — формат исправлен, защита восстановлена и покрыта отдельным тестом. Правила по-прежнему помечены как пожелания, не системные правила, без прав и инструментов. Текст сообщения владельца сохраняется.
- Никакого второго runtime, профиля или хранилища; скрытого обучения нет — в запрос попадают только явно выбранные Skills.

## Entrypoint

```
Skills UI → PUT /api/v1/chats/:id/skills → ChatSkillStore.update() (scope=chat)
          → snapshotRun() → forRun(runId, owner)
          → ChatService.buildRequest({ skills }) → последнее user-сообщение модели
Work: PUT /api/v1/projects/:id/skills → WorkSkillStore (scope=project)
```

## Изменённые файлы

| Файл                                                                              | Изменение                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/contracts/src/chat-skills.ts`                                           | `ChatSkillScope`, `CHAT_SKILL_PRECEDENCE`, `scope?`   |
| `packages/core/src/chat.ts`                                                       | сортировка по приоритету, рендер с видимым источником |
| `packages/db/src/chat-skill-store.ts`                                             | `scope='chat'` в `get()` и `update()`                 |
| `packages/db/src/work-skill-store.ts`                                             | `scope='project'` в `get()` и `update()`              |
| `packages/core/test/chat-skill-precedence.test.ts`                                | **новый** 4 теста                                     |
| `packages/db/test/chat-skill-scope.test.ts`                                       | **новый** 4 теста                                     |
| `docs/team/.../deliveries/06_CLAUDE/{BACKLOG,CHECKPOINT,DELIVERY,INTEGRATION}.md` | отчёты                                                |

## Команды и фактические результаты

```
packages/core полный vitest              393 passed (35 файлов)
packages/core chat-skill-precedence       4 passed
packages/db  chat-skill-scope            4 passed
packages/db  полный, --maxWorkers=2     218 passed (38 файлов)
apps/api     целевые 4 файла            51 passed
typecheck contracts/core/db              Done
lint      contracts/core/db              Done
prettier --check . / check:secrets       passed
```

Два падения по ходу были в самих тестах и исправлены содержательно: `CHAT_SKILL_PRECEDENCE` ошибочно импортирован как тип (→ `ReferenceError`); фикстура `owner_skills` использовала несуществующую колонку `instructions` и оставляла run в `queued`, что справедливо блокировало `update()`. Продуктовый код в этих местах не менялся. Один «exit 1» при `Select-Object -First` оказался артефактом обрыва pipe PowerShell — повтор без обрезки вывода дал 51/51.

## Миграции / зависимости

Миграций нет, схема БД не менялась, новых зависимостей нет. Внешний провайдер не вызывался.

## Срез B — разрешение конфликтов и preview правил

- `packages/core/src/skill-conflict-resolution.ts` — **новый** чистый
  `resolveSkillConflicts()`: конфликт определяется **только по `skill_id`**
  (одна специализация выбрана на нескольких уровнях), никогда по похожим
  словам. Побеждает высший scope; проигравшие возвращаются в `suppressed`, а не
  выбрасываются молча. Снимки без scope трактуются как `owner`.
- `ChatService.buildRequest()` использует резолвер: в модель попадает только
  правило-победитель, а строка честно сообщает «вытеснено правил с тем же
  skill_id: N». `JSON.stringify(instructions)` сохранён (security-тест из
  среза A).
- `apps/web/src/app/chat-skill-settings.tsx` — в уже существующем `<details>`
  «Подключённые инструкции» показываются `[scope]`, приоритет и пояснение о
  разрешении конфликта. Новой панели, API, CSS и зависимости web от
  `@cosmora/core` нет.
- Тесты: +3 (победа по scope, отсутствие склейки разных правил с одинаковым
  текстом, рендер только победителя с пометкой). Итого 8/8 в файле.

## Проверки срезов A+B (фактические)

```
packages/core полный vitest              397 passed (35 файлов), новый файл 8/8
packages/db  полный, --maxWorkers=2     218 passed (38 файлов), новый файл 4/4
apps/api     chat-skills.test.ts        11 passed (security-тест экранирования)
apps/api     целевые 4 файла            51 passed
typecheck/lint contracts/core/db/api/web · prettier --check . · check:secrets · web build — green
```

`web build` сначала вернул 1 из-за ошибки «Export DRIVE_OFFICE_FILE_MAX_BYTES
doesn't exist» — это устаревший `dist` контрактов в локальном дереве после
merge `main`. После `pnpm --filter @cosmora/contracts build` сборка = 0; в моей
ветке файлы drive/office не менялись, в CI сборка идёт с нуля. Зафиксировано,
чтобы не выдать за продуктовую ошибку.

## Полномочия и границы

Не менялись тарифы, квоты, провайдер HY4, права, keys, auth, gateway, system prompt, composer/sidebar/global CSS, чужие memory tables. Multi-Agent/Jarvis/VPS/production/merge — не выполнялись. Реальные данные владельца, .env, токены, БД пользователей не читались.

## Несовместимости / ограничения

- `scope` опционален: старые `chat_run_skill_snapshots` без scope трактуются как `owner` (низший приоритет), никогда не как `task`/`chat`. Проверено тестом.
- Приоритет реализован как **порядок рендера и видимый источник**, а не как подавление конфликтующих правил: при противоречии модель видит оба правила с их scope. Полное разрешение конфликтов — следующий срез.
- Живая приёмка, VPS и Windows-клиент остаются отложенными по `AGENTS.md`.

## Что ещё не проверено живьём

Реальный провайдер; как модель разрешает противоречия между правилами разных scope на живых ответах.

## Следующий шаг

Срез B: разрешение конфликтующих правил по приоритету (высший scope подавляет низший при прямом противоречии), preview итоговых правил в существующем разделе Skills, цикл подтверждения исправления. Без новой панели и без изменения компоновки.
