# Карта покрытия: PR #330, #380, #390 → владельцы → актуальный код

**BASE_SHA:** `51ce52a9`. Использованы только проверяемые ссылки на репозиторий.
«Отсутствует» означает «не найдено указанными поисками», а не доказательство
отсутствия во всём коде. Полный аудит всех 160 позиций #380 и 498 позиций APEX
не проводился — выборка репрезентативная по группам.

## Владельцы (источник: [README операции 10.11](../../operation-2026-11-10/README.md))

| Область                                                                       | Владелец                         |
| ----------------------------------------------------------------------------- | -------------------------------- |
| Чат Kosmora, Work, контракты/DB/entrypoints, интеграция выпуска, Office/Drive | 01_CODEX                         |
| Память, контекст, извлечение, индекс и ранжирование                           | 04_DEEPSEEK                      |
| Браузер и Deep Research                                                       | 05_GEMINI                        |
| Навыки, специализации, стиль, обучение на обратной связи                      | 06_CLAUDE                        |
| Coscode / code-agent                                                          | 02_DEVELOPER                     |
| Windows-хост и локальная платформа                                            | 03_OPENCODE                      |
| Медиа / сайты и игры Studio                                                   | 07_FREE_MEDIA / 08_FREE_BUILDERS |

Правило распределения: `docs/team/operation-2026-11-10/README.md:36-40`.
Ограничения адаптации: [AGENTS.md](../../../../AGENTS.md):15-18 — сохранять
лицензионные уведомления и закреплять исходник;
[GEMINI_NOVEMBER_ADOPTION_RU.md](../../../product/GEMINI_NOVEMBER_ADOPTION_RU.md):3-7 —
разрешение внутри Kosmora/Koswork без расширения прав устройств/данных/дизайна.

## PR #330 — GEMINI-CHAT-330 (открыт, не слит)

Источник каталога: [pr-330-source.json](../../../roadmap/gemini-packages/pr-330-source.json):9,
[PACKAGES](../../../roadmap/GEMINI_PACKAGES.md):20-41; аудит
[KOSMORA_GEMINI_REVIEW](../../../handoff/KOSMORA_GEMINI_REVIEW_2026-10-14.md):5-28.
Слияние: `feature/kosmora-updates` head `ab5e5591` не является предком `main`;
`git log --all --grep=#330` содержит только документальные правки.

| Функция                           | Владелец               | Статус в `main`     | Доказательство                                                                                                                                       | Решение                                                 |
| --------------------------------- | ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Fork сообщений, ветвление, regen  | 01_CODEX               | Есть                | `packages/db/migrations/0043_chat_branches.sql`; `apps/api/test/chat-branches.test.ts:106-147`; `apps/web/src/app/chat-branches.tsx:78`              | Не переносить                                           |
| Поле `version_index`              | 01_CODEX               | Не найдено          | Только в `pr-330-source.json:9`; сейчас `chat_branches` + `request_digest`                                                                           | Не переносить: эквивалент не доказан                    |
| Папки, закрепления, поиск истории | 01_CODEX               | Есть                | `apps/api/src/chat-workspace-routes.ts:41-107`; `apps/api/src/chat-history-search-routes.ts`; `packages/db/migrations/0034_chat_history_search.sql`  | Не переносить                                           |
| Исключение сообщений, summary     | 01_CODEX / 04_DEEPSEEK | Есть, другая схема  | `apps/api/src/chat-workspace-routes.ts:108-130`; `packages/db/src/chat-workspace-store.ts:273-297` (summary в последний user-turn, не system prompt) | Не переносить: поведение согласовано в продукте         |
| Заметки памяти чата               | 04_DEEPSEEK            | Есть (ручной режим) | `apps/api/src/general-chat-routes.ts:345`; `apps/api/test/chat-memory.test.ts`; `packages/db/migrations/0042_chat_memory_notes.sql`                  | Не переносить                                           |
| Индикатор бюджета контекста       | 01_CODEX               | Не найдено          | Поиск `estimateTokens/tokenBudget` в `apps/web/src` — 0 совпадений                                                                                   | Кандидат, нужен объём владельца (UI)                    |
| Артефакты чата + версии 409       | 01_CODEX               | Частично            | `apps/api/src/canvas/canvas-routes.ts`; CAS в `apps/api/src/app.ts:1883,1997,2160`; отдельной таблицы `0035_canvas_artifacts` нет                    | Не дублировать Canvas                                   |
| Перенос ответа чата в Canvas      | 01_CODEX               | Есть                | `apps/web/src/app/chat-workspace.tsx:482-498`; `apps/api/src/canvas/canvas-routes.ts:40-60`                                                          | Не переносить; статус в `GEMINI_PACKAGES.md:33` устарел |
| Экспорт `.md/.txt/.html/.json`    | 01_CODEX               | Частично            | `apps/web/src/app/chat-export.ts:14` — только `markdown/json`; text/html есть в `apps/api/src/canvas/canvas-routes.ts:65`                            | **ОДОБРЕНО: `.txt`/`.html`** → пакет ниже               |
| Welcome/starter cards             | 01_CODEX (UI)          | Нет                 | Нет файла `welcome-starters`; `apps/web/src/app/page.tsx:3442-3446` содержит только приветствие                                                      | Кандидат; нужен точечный запрос на начальный экран      |

## PR #380 — 160 master architecture (ветка не в `main`)

Свидетельство: `docs/operations/chat-studio-demo-20261025.md:20` — каталог из
160 пунктов не является доказательством 160 реализованных функций и не входит
в выпуск. Ветка `feat/kosmora-160-master-architecture` head `1bdb6dca` не является
предком `main`; документ ветки (git) называет пакет черновиком.

| Группа                                 | Владелец                         | Статус в `main`         | Доказательство                                                                                                                    | Решение                                       |
| -------------------------------------- | -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| F001–032 DAG/планировщик/роутинг/откат | 01_CODEX                         | Есть продукт-эквивалент | `apps/api/src/work-dag-coordinator.ts:100-101,444,512`; `packages/model-gateway` в `apps/api/src/model-runtime.ts:13,62`          | Не переносить                                 |
| F033–064 Canvas                        | 01_CODEX                         | Есть продукт-эквивалент | `apps/api/src/canvas/*`; прототипы APEX требуют адаптера                                                                          | Не переносить                                 |
| F065–096 skills/GitHub/код/поиск/OCR   | 06_CLAUDE, 01_CODEX, 05_GEMINI   | В основном есть         | `apps/api/src/chat-skill-routes.ts`; `apps/api/src/github-issue-routes.ts`; `packages/tool-runtime`; `apps/api/src/web-search.ts` | Не переносить                                 |
| F076 Telegram-шлюз                     | 01_CODEX                         | Не найдено              | Только текст в `apps/web/src/app/workspace-capabilities.ts:117`                                                                   | Кандидат; внешние секреты — решение владельца |
| F097–128 граф/память/поиск             | 04_DEEPSEEK, 05_GEMINI, 01_CODEX | Частично; UI отложен    | `apps/api/src/intelligence-graph-*routes.ts`; `docs/design/VISUAL_WAITLIST.md`                                                    | Не переносить без запроса дизайна             |
| F127 глобальный Cmd/Ctrl+K             | 01_CODEX (UI)                    | Не найдено              | Поиск `commandPalette/globalSearch/cmd+k` в `apps` — 0 совпадений                                                                 | Кандидат; нужен объём владельца               |
| F129–160 enterprise RLS/RBAC/vault     | 01_CODEX, 03_OPENCODE            | В основном не найдено   | Поиск `row level security/rbac` — 0; есть только owner/project gates                                                              | Существенный компромисс — владелец            |

## PR #390 — APEX-512

Источники: [remediation](../../../reviews/2026-10-26-apex-remediation.md):1-19,
[readiness](../../../reviews/APEX_FEATURE_READINESS.md):1-4,
[provenance](../../../../packages/core/src/apex/provenance.json):1-8.

| Что                                                                            | Владелец             | Статус                   | Доказательство                                                                                                                                                      | Решение                                          |
| ------------------------------------------------------------------------------ | -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 14 input-bound алгоритмов (F193–198, F417, F481–482, F489–490, F497–498, F505) | 01_CODEX             | Есть и подключены        | `apps/api/src/apex-routes.ts:20-31,33-60` (`source: "PR390"`, `claimed_product_functions: 0`, 501 при отсутствии адаптера); `packages/core/src/apex/index.ts:10-33` | Не переносить повторно                           |
| Остальные 498 дескрипторов                                                     | владельцы по модулям | Прототипы, không продукт | `APEX_FEATURE_READINESS.md:3-4`; `packages/core/src/apex/catalog.ts`                                                                                                | Не считать functions; новые адаптеры — по одному |
| UI каталога/результатов                                                        | владелец дизайна     | Отложено                 | `docs/design/VISUAL_WAITLIST.md:21-23`                                                                                                                              | Не внедрять без запроса                          |

## Итог

- Повторений в `main` нет: ветвление, папки/закрепления, поиск, память,
  Canvas, перенос в Canvas, DAG, skills, граф и 14 APEX-алгоритмов уже
  реализованы и покрыты тестами.
- Один одобренный самостоятельный кусок: **экспорт чата `.txt`/`.html`** —
  [патч и план](CANDIDATE_CHAT_EXPORT/ADAPTATION_PLAN.md).
- Очередь следующих кандидатов (нужно решение владельца):
  [QUEUE.md](QUEUE.md). Пока одобрен только один пункт, дальше по одним
  согласованным кандидатам работа не продолжается.
