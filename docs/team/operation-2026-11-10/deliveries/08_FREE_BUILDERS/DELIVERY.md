# DELIVERY — 08_FREE_BUILDERS / game-source-diff

**Статус:** в работе, ожидает CI и браузерную приёмку; **не** объявлено «принято в выпуск».

- BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
- HEAD_SHA (кодовый срез до отчётного коммита): `c711591bc280128e951332510a225a8ebd4d0abf`.
- Ветка: `ops/free-studio-builders`.
- PR: https://github.com/RLM-Company/Nexus-OS/pull/501 (draft).
- Entrypoints: `/?surface=games&project=<id>` → `GamesWorkbench` → `SitesWorkbench(kind=game_project)` → `CanvasEditor` → `GameSourceEditor` / `GameSourcePreview`. Backend: существующие `/api/v1/projects/:id/work` и `/canvas`; не менялись.
- Назначение: полноценный редактируемый браузерный source-project, не каталог игр.

## Конкретное до → после

До: сравнение сохранённых Canvas версий показывало изменения всего JSON; для `game.js` и `styles.css` не было diff выбранного файла. Возврат исходников к точному запущенному содержимому мог вновь показать прежнюю preview-сессию, так как сравнивался `session.source === content`.
После: отдельная команда «Сравнить файл» показывает построчный ограниченный diff только выбранного исходника против `loaded.revision.content` (для несохранённого проекта — against Work seed), без изменений других файлов. При любой смене контента предыдущая сессия аннулируется; запуск повторно требует явного Play. Сохранение, optimistic version conflict и recovery выполняет существующий Canvas.

## Изменённые файлы

1. `apps/web/src/app/games/game-source-editor.tsx` — diff выбранного файла, bounded comparator.
2. `apps/web/src/app/games/game-source-preview.tsx` — инвалидация запуска при редактировании.
3. `apps/web/e2e/game-development.spec.ts` — real UI regression (не fake unit example): edit/revert, diff sibling, v2, ZIP, reload.
4. `apps/web/src/app/canvas-editor/canvas-editor.tsx` — отдельный integration commit, только передача сохранённой базы из Canvas в Games.

## Проверки и фактические результаты

- GitHub read API: найден и прочитан основной user path, runtime, sanitizer/CSP, тесты, contracts, AGENTS и UI rules. PASS (проверка статического кода).
- GitHub `compare_commits(9d972e8..main)`: ahead 2, общие source/contracts без изменений на момент PR; diff содержит только `docs/product/STAGE_TWO_WORKFLOW_RU.md` и docs/team/operation files. PASS.
- Создание ветки/двух коммитов/PR через GitHub connector: PASS, SHA указаны выше.
- `pnpm --filter @cosmora/web exec playwright test e2e/game-development.spec.ts`: **НЕ ЗАПУЩЕНО локально** — нет checkout/node_modules и сети в контейнере. Новый сценарий добавлен, результат ожидает CI.
- `pnpm --filter @cosmora/web typecheck`, `pnpm --filter @cosmora/web lint`, `pnpm format:check`, `pnpm check:secrets`, full gates: **не запускались локально**; CI PR #501 требует отдельной оценки.
- CI run `42874502490`, https://github.com/RLM-Company/Nexus-OS/actions/runs/42874502490 : `in_progress` при подготовке отчёта. Не заявлять PASS без результата.
- Live providers / actual owner project / owner browser / external hosting: **не проверено, не выполнялось**.

Зависимости/миграции: **нет**. Оплата и side effects: **нет** (кроме кода, коммитов и PR). Источники private data/.env не открывались. Sandbox, CSP, owner isolation, existing Work accounting, policy gates, scope and cancel не менялись. Неподдерживаемые функции (Unity/Unreal, hosting, network/DOM game API, полноценные ассеты) не заявлены.

Риски/ограничения: срез не добавляет AI-targeted patch API, standalone browser support по-прежнему требует OffscreenCanvas; baseline diff — визуальное сравнение, не автоматический merge. Сохранение в Canvas и ZIP в текущем коде существует, но фактический e2e нового среза требует CI.

Следующее: подтвердить CI, проверить сценарий несохранённого Canvas seed switch, после этого согласовать с Codex patch/version precondition contract для AI-итерации по файлу, не копируя code-agent.
