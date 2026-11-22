# Объединённый кандидат поверх PR #617 — 22 ноября 2026

## Точные SHA

- Исходная ветка владельца: `stage3/scheduling-clean` @ `d2ea5f1a`.
- Актуальный head PR #617: `172bba88c202b5992abd5305c8876fd2cd0bc789`.
- Merge-base на момент начала: `d860baf3cad3b16251a9bfda5f09e7da5f31f0a1`.
- Кандидат: `integration/pr617-candidate` @ **`4d7a5218e6c9b607c83f6d72279f02c7387c289f`**.
- Отдельный worktree: `C:\Users\Александр\Documents\deepseek-harness\default-workspace\pr617-integration`.
- Исходная ветка и worktree `scheduling-wt` других агентов не изменялись.

## Перенесённые изменения

Из `d2ea5f1a` в кандидат перенесено 58 файлов (три crossing-конфликта разрешены вручную, PR #617 сохранён):

- **Koswork + карточка вопроса:** `clarification-card*`, `chat-task-plan*`, `use-chat-task-plan`, emit из SSE-обработчиков `page.tsx`, e2e `chat-task-plan`/`clarification-card`.
- **Анализ файлов и Studio:** `studio-music`, `studio-files-report` coverage-тесты, `bounded-zip`/импорт, `media-workbench`, `integrations-catalog`, `http-connector` (HTTP/MCP-совместимый), `koswork-acceptance-package` и `studio-document-package` с самопроверками и симуляторами.
- **Интеграции и Koscode:** `koscode-navigation` (grouping/active tasks), `connector-routes/status`, personal-settings catalog, e2e-спецы.
- **Документы/отчёты:** все STAGE3-отчёты и карточки раздела.

Конфликты:

- `apps/api/src/app.ts` — сохранена правка PR #617 (`works` в scheduled dispatch).
- `packages/core/src/index.ts` — сохранён `work-admission-snapshot` PR #617.
- `apps/web/src/app/page.tsx` — объединены `greetingByAssistantGender` (PR #617), `pendingProjectId`-специализация composer draft (PR #617) и clarification/task-plan хуки (наша ветка).

## Сравнение пересекающихся реализаций (один сценарий)

**Сценарий:** импорт `extended.zip` синтетического пакета A.

- Наша версия ожидала, что `nested.zip` пропускается (`nested_archive_not_expanded`) — тест `studio-fixture-import` **падал** после merge с PR #617.
- Версия PR #617 (`library-archive-import.ts`) разворачивает один уровень вложенного архива с breadcrumb `nested.zip › nested › brief.txt` и честно считает неподдерживаемые/`__MACOSX` как `skipped` — тест **проходит целиком**.

**Решение:** оставлена реализация PR #617. Наш фикстурный пакет адаптирован: manifest (`skipped:2`, `nested_expanded:2`, ожидаемые имена), generator, self-check, simulator, API/e2e-assertions, README. Коммит адаптации `4d7a5218`.

## Пройденные проверки (на кандидате `4d7a5218`)

| Проверка                                                                                                      | Результат                                                         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| web typecheck (4 tsconfig)                                                                                    | exit 0                                                            |
| web unit (chat-task-plan, clarification, import, report, library importer)                                    | 19 passed                                                         |
| API deep fixture                                                                                              | 1 passed                                                          |
| API сценарии (work-dag, workflows, document-answer-http, connector-status, koswork scenario, second scenario) | 57 passed (2 таймаута 5с прошли повторно с `--testTimeout=30000`) |
| tool-runtime http connector                                                                                   | 4 passed                                                          |
| self-check пакета A / verify пакета B                                                                         | passed                                                            |
| `first-gemini-run.mjs` / `first-deepseek-run.mjs`                                                             | local-simulation, passed                                          |
| prettier / check-secrets                                                                                      | green                                                             |

## Блокеры браузерных сценариев (реальные, не придуманные)

1. **Память хоста:** свободно ~0.5 GB из 7.73 GB. `next build` и Playwright webServer не завершаются (таймауты 180с/60с) без ошибки кода. Чужие процессы не прерывались.
2. **Порт 3000:** занят чужим `next dev` (PID 4684, HTTP 500), не мой worktree. Свой dev поднят на 3001.
3. **Resolve workspace-пакетов в新模式:** Next/Local dev не находит `.js`-exports из `packages/contracts/src/index.ts` в новом worktree, даже после сборки dist и `NODE_ENV=production`. Это среда/harness, не код (#617 и моя ветка в исходном worktree проходили те же e2e).

Поэтому три пользовательских сценария **проверены на API/unit уровне** (Koswork journey, deep document analysis, connector registry), а браузерный прогон на кандидате заблокирован памятью/resolve. Живая приёмка VPS и платные прогоны не выполнялись.

## Результат

- Один Draft PR поверх `172bba88` с кандидатом `4d7a5218` (если GitHub доступен).
- Если PR не создаётся — Git bundle с веткой `integration/pr617-candidate` и путь к нему указывается ниже в сообщении владельцу.
- Без слияния в main, без выкладки на VPS, без платных вызовов.

## Следующий шаг

После освобождения памяти/стабильного resolve — повторить три e2e-сценария в браузере на кандидате; затем принять решение о выкладке. Multi-Agent не трогать.
