# DELIVERY — stage3/projects-memory

- **Статус:** готово к интеграции.
- **BASE_SHA:** `500f1beec12e282828eb96a611c307bb4a93ed95` (актуальный `main`).
- **Ветка:** `stage3/projects-memory`.
- **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **PR #589** (`fix/chat-review-20261114`, OpenCode): блок поля ввода/диктовки/навигации Studio; работал от `main`, его ветку не трогал. Пересечение по `page.tsx` / `globals.css` — при слиянии интегратору сверить `page.tsx` (оба меняют).

## Сценарий «проект = папка» (до / после)

**До.** Две несвязанные системы: старые `projects`+`chats`+`messages` и новые
`general_chats`. Чат Kosmora не имел `project_id`; меню чата умело только
pin/open/rename/archive/delete/export; новый чат проекта не видел договорённости
других чатов; проектная память (`project_memory`) и материалы
(`project_materials`) жили отдельно от обычных чатов.

**После.**

1. **Схема/API переноса.** Миграция `0069_general_chat_project.sql` добавляет
   `general_chats.project_id` (FK → projects, ON DELETE SET NULL) и
   `general_chats.confidential`. `PATCH /api/v1/chats/:chatId` принимает
   `project_id` (строка = папка, `null` = общий список) и `confidential`;
   `GET /api/v1/chats?project_id=` фильтрует папку; по умолчанию список
   возвращает **все** чаты владельца, чтобы навигация/поиск не теряли перенесённые.
   `POST /api/v1/chats` принимает `project_id` — новый чат рождается сразу в проекте.
   Перенос во время активного ответа → `409`; чужой/несуществующий проект → `404`.
   Ветвление чата наследует `project_id` и `confidential` родителя.
2. **Меню чата** (`ChatItemMenu`): «В проект / переместить» (выбор проекта),
   «Вернуть в общий список», перенос в другой проект. История, вложения и ссылка
   на чат сохраняются: меняется только `project_id`. Копирование ссылки уже было.
3. **Экран проекта / навигация** (`page.tsx`, `chat-item-menu.module.css`,
   `globals.css`): проект разворачивается как папка со списком своих чатов,
   каждый открывается со своей историей; кнопка «Новый чат в проекте» создаёт чат
   с `project_id`. Общие файлы и инструкции — существующий
   `/api/v1/projects/:id/materials` (`ProjectContextPanel`).
4. **Память проекта с источником.** `projectChatContext()` собирает для нового
   чата проекта: инструкции/файлы материалов, явные записи `project_memory`
   (закреплённые первыми) и последние пользовательские сообщения **других**
   неконфиденциальных чатов проекта. Каждый пункт несёт `[источник]`.
   `ChatService.buildRequest()` рендерит это как **пользовательские данные, не
   системные правила**, сохраняя исходное сообщение и экранирование.
   Изоляция: чаты без `project_id` и конфиденциальные чаты не получают и не
   отдают проектный контекст; память.project A не видна проекту B.

## Entrypoint

```
Создать проект (POST /projects/empty, уже было)
  → «Новый чат в проекте» (POST /api/v1/chats с project_id)
  → меню чата: PATCH /api/v1/chats/:id { project_id }
  → GET /api/v1/chats?project_id=... → папка
  → buildRequest → projectChatContext → модель видит [источник]
  → /api/v1/projects/:id/materials → общие файлы/инструкции
```

## Шаги проверки (фактические результаты)

```
packages/db   новый test/general-chat-project.test.ts      5 passed
              полный набор                               241 passed (42 файла)
packages/core новый test/chat-project-context.test.ts     3 passed
              полный набор                               428 passed (41 файл)
apps/api      новый test/project-chat-context.test.ts     5 passed
              новый test/project-folder-scenario.test.ts  2 passed
              целевые 3 файла                            19 passed
              полный набор                               1096 passed / 1 skipped,
                1.fail office-build-cache.test.ts — НЕ регрессия:
                падает и на чистом main (Windows %TEMP% + turbo, os error 5)
apps/web      typecheck Done; build 0
typecheck/lint contracts/core/db/api/web · prettier --check . · check:secrets — green
```

Сценарный тест `project-folder-scenario.test.ts` покрывает: создание проекта →
чат в проекте → повтор запроса (идемпотентность) → перенос (409 при активном
ответе, 200 после завершения) → перемещение в другой проект → возврат в общий
список → сохранность истории/вложений/ссылки → перезагрузку store → новый чат
получает договорённость с `[источник]` → изоляцию между проектами →
конфиденциальный чат не получает и не отдаёт контекст.

Один локальный средовой тест `office-build-cache.test.ts` не проходит и на
чистом `main` (доказано через `git stash`), к изменениям отношения не имеет;
в CI на Linux turbo создаёт кэш штатно.

## Как обновляются существующие проекты и чаты

- **Миграция аддитивная**: `ALTER TABLE ... ADD COLUMN project_id TEXT ... DEFAULT NULL`
  и `confidential INTEGER NOT NULL DEFAULT 0`. Все существующие чаты остаются в
  **общем списке** (`project_id = NULL`), их история, вложения, runs, branches,
  memory notes и ссылки не изменяются. Отката данных не требуется.
- Старые проекты (`projects`, `chats`, `messages`, `project_materials`,
  `project_memory`) не переписываются: новые `general_chats` просто получают
  ссылку на уже существующий `projects.id`. `ON DELETE SET NULL` означает, что
  удаление проекта возвращает его чаты в общий список, а не удаляет их.
- Существующие `chat-skills-upgrade.test.ts` ожидал точную форму строки
  `general_chats`; обновлён под два новых столбца (`project_id: null`,
  `confidential: 0`). Другие тесты используют `objectContaining` и прошли без правок.
- UI: у уже существующих чатов поле отсутствует → трактуется как общий список;
  перенести их можно из меню чата в любой момент. Папка проекта разворачивается
  по клику и не зависит от активного экрана.
- Конфиденциальность по умолчанию `false`; для старых чатов проектный контекст
  подмешивается только если их явно перенести в проект.

## Изменённые файлы (основные)

| Файл                                                                     | Изменение                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| `packages/db/migrations/0069_general_chat_project.sql` + `_journal.json` | новая миграция                                     |
| `packages/db/src/general-chat-store.ts`                                  | project_id/confidential, list/update/create/branch |
| `packages/contracts/src/domain.ts`                                       | поля в GeneralChat/Create/PATCH-контрактах         |
| `apps/api/src/general-chat-routes.ts`                                    | query/body/создание/обработка 404                  |
| `apps/api/src/project-chat-context.ts`                                   | **новый** сборщик с источником и изоляцией         |
| `apps/api/src/app.ts`                                                    | передача projectStore/projectMemory в chat routes  |
| `packages/core/src/chat.ts`                                              | `ProjectContextItem`, рендер с `[источник]`        |
| `apps/web/src/app/chat-item-menu.tsx` + css                              | три действия переноса                              |
| `apps/web/src/app/page.tsx` + `globals.css`                              | папка проекта, новый чат в проекте                 |
| 4 новых test-файла + правка `chat-skills-upgrade.test.ts`                | проверки                                           |
| `docs/team/operation-2026-11-14/projects-memory/*`                       | отчёты                                             |

## Ограничения

- ProjectContext — структурная подборка явных записей/сообщений с источником, а
  не семантический вывод; модель не получает системных правил из проекта.
- «Конфиденциальный чат» введён как явный флаг чата; ранее у general_chats его
  не было. Приватность обеспечивается двусторонним исключением из проектного
  контекста, а не отдельным шифрованием.
- Живая приёмка на VPS и реальная модель не проводились; прогоны — in-memory
  SQLite и mock provider. Stage-one по `AGENTS.md` не объявляется завершённой.
- Поле ввода, настройки профиля и диктовка (OpenCode / PR #589) не менялись.

## Следующий шаг

Интегратору: слить PR, сверить `page.tsx`/`globals.css` с PR #589 при
одновременном мердже, затем применить миграцию 0068 на VPS и повторить
`GET /api/v1/chats?project_id=` на существующих данных.
