# DELIVERY — 06_CLAUDE, срез A: явный приоритет и источник правил Skills

- **Статус:** готово к интеграции (дальнейшие статусы подтверждает Codex).
- **BASE_SHA:** `5c7ac4de7cd2e18232349342e209676fff6dc579` (актуальный `main`).
- **Ветка:** `ops/claude-specializations` (новая; сфера на доске была `prepared`, без ветки и отчётов).
- **PR:** открывается в `main`, без merge/deploy.
- **HEAD_SHA:** см. `git log -1` ветки / CHECKPOINT.md.
- **Переназначение:** задание `06_CLAUDE.md` именует исполнителем Claude; петля взята по прямому указанию владельца («2»).

## Сценарий до / после

**До.** `ChatSkillSnapshot` не содержал `scope`. `ChatService.buildRequest()` рендерил все выбранные Skills одним плоским `JSON.stringify(...)` без указания, откуда правило и в каком порядке оно применяется. Пользователь не видел приоритет owner/project/chat/task, а отключение проверялось только на уровне «пустой список».

**После.**

- `ChatSkillScope = owner | project | chat | task` и `CHAT_SKILL_PRECEDENCE` (фиксированный порядок `task > chat > project > owner`) в `packages/contracts/src/chat-skills.ts`; `ChatSkillSnapshot.scope?` опционален для старых снимков прогонов.
- `ChatSkillStore` / `WorkSkillStore` выставляют `scope` в выборках (`chat` / `project`), включая возврат `update()` — состояние `get()` и `update()` согласовано.
- `ChatService.buildRequest()` сортирует правила по приоритету и рендерит каждое как `- [scope] name vN: instructions` с явной строкой «Приоритет: task > chat > project > owner. Источник указан в [scope]». Правила по-прежнему помечены как пожелания, не системные правила, без прав и инструментов. Текст сообщения владельца сохраняется.
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
