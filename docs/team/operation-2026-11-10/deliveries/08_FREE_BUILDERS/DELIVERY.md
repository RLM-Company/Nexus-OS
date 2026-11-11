# DELIVERY — 08_FREE_BUILDERS / game-source-diff

**Исторический статус PR #501:** интегрирован в main; живая приёмка и выпуск отдельно.

- BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
- CODE_HEAD_SHA (проверенный code/test commit): `606ed1eb876073745cad941d688bf067b3de7e9f`.
- Ветка: `ops/free-studio-builders`.
- PR: https://github.com/RLM-Company/Nexus-OS/pull/501 (draft).
- Entrypoints: `/?surface=games&project=<id>` → `GamesWorkbench` → `SitesWorkbench(kind=game_project)` → `CanvasEditor` → `GameSourceEditor` / `GameSourcePreview`. Backend: существующие `/api/v1/projects/:id/work` и `/canvas`; не менялись.
- Назначение: полноценный редактируемый браузерный source-project, не каталог игр.

## Конкретное до → после

До: сравнение сохранённых Canvas версий показывало изменения всего JSON; для `game.js` и `styles.css` не было diff выбранного файла. Возврат исходников к точному запущенному содержимому мог вновь показать прежнюю preview-сессию, так как сравнивался `session.source === content`.
После: отдельная команда «Сравнить файл» показывает построчный ограниченный diff только выбранного исходника против `loaded.revision.content` (для несохранённого проекта — against Work seed), без изменений других файлов. При любой смене контента предыдущая сессия аннулируется; запуск повторно требует явного Play. Сохранение, optimistic version conflict и recovery выполняет существующий Canvas.

## Второй готовый в коде срез (ожидает CI)

До: повторный `setSeed` того же Work результата создавал новый объект `initialDraft` и мог заново исполнить init-effect Canvas, подменяя несохранённый текст. При смене проекта и другого результата не было уведомления о несохранённых правках.
После: повторное открытие того же источника no-op; Canvas сообщает builders dirty-state, а переход в другой проект / к другому seed требует подтверждения. Отказ не меняет редактор; при согласованном переходе черновик остаётся в owner/project-scoped browser storage (если доступно). Добавлены сценарии Playwright.

## Изменённые файлы

1. `apps/web/src/app/games/game-source-editor.tsx` — diff выбранного файла, bounded comparator.
2. `apps/web/src/app/games/game-source-preview.tsx` — инвалидация запуска при редактировании.
3. `apps/web/e2e/game-development.spec.ts` — real UI regression (не fake unit example): edit/revert, diff sibling, v2, ZIP, reload.
4. `apps/web/src/app/canvas-editor/canvas-editor.tsx` — два узких integration commits: передача сохранённой базы для Games и dirty-state callback для Sites/Games.
5. `apps/web/src/app/sites/sites-workbench.tsx` — безопасное переключение seed и project, защита повторного открытия, guard на отсутствие draft.
6. `apps/web/e2e/sites-workbench.spec.ts` — regression re-open текущего результата и проектное переключение с сохранением черновика.

## Проверки и фактические результаты

- GitHub read API: найден и прочитан основной user path, runtime, sanitizer/CSP, тесты, contracts, AGENTS и UI rules. PASS (проверка статического кода).
- GitHub `compare_commits(9d972e8..main)`: ahead 2, общие source/contracts без изменений на момент PR; diff содержит только `docs/product/STAGE_TWO_WORKFLOW_RU.md` и docs/team/operation files. PASS.
- Создание ветки, scoped code commits, отдельных Canvas integration commits и PR #501 через GitHub connector: PASS. Финальный PR head после отчётного коммита проверить отдельно.
- `pnpm test:e2e` GitHub Actions (Playwright Chromium): **PASS**, основной suite **424 passed**, дополнительные **3 + 5 + 4 passed**. Включены новые игровые и сайтовые сценарии, реальная браузерная фикстура без платной модели. Прямого локального запуска в чате не было.
- `pnpm check:core` GitHub Actions: **PASS** (в том числе Prettier, secrets gate, lint, typecheck, тесты и build). Запускался CI, не локальный контейнер этого чата.
- CI run `42874502490`: **FAIL** — Prettier нового Playwright теста, browser acceptance cancelled, sandbox isolation PASS. Длинный assertion переформатирован в `78db7d5`.
- Промежуточный CI `42877009866`: fail exact optional TypeScript callback, исправлено `bc6e1b4`.
- CI `42877907171`: monorepo + sandbox PASS; Chromium **423 passed / 1 failed** из-за регистра слова в новом assertion, исправлено `606ed1e`.
- **Финальный кодовый CI `42879624872`** (https://github.com/RLM-Company/Nexus-OS/actions/runs/42879624872): **SUCCESS** всех трёх jobs: Verify monorepo, Code sandbox isolation, Browser acceptance. Кодовый HEAD `606ed1e`.
- Коммит этой документации не меняет runtime, tests или contracts; если он запускает новый CI, проверять его отдельно.
- Live providers / actual owner project / owner browser / external hosting: **не проверено, не выполнялось**.

Зависимости/миграции: **нет**. Оплата и side effects: **нет** (кроме кода, коммитов и PR). Источники private data/.env не открывались. Sandbox, CSP, owner isolation, existing Work accounting, policy gates, scope and cancel не менялись. Неподдерживаемые функции (Unity/Unreal, hosting, network/DOM game API, полноценные ассеты) не заявлены.

Риски/ограничения: срез не добавляет AI-targeted patch API, standalone browser support по-прежнему требует OffscreenCanvas; baseline diff — визуальное сравнение, не автоматический merge. Сохранение в Canvas и ZIP в текущем коде существует, но фактический e2e нового среза требует CI.

Следующее: Codex review отдельных Canvas integration commits; затем согласовать с Codex patch/version precondition contract для AI-итерации по файлу, не копируя code-agent.

## DELIVERY 2026-11-11 — PR #518

Статус: **в работе — code/browser подтверждены, core gate блокирован извне**.

- BASE_SHA: `c47fed43a20e49a7ea27495f5551e7cfc082fcb5`.
- CODE_HEAD_SHA: `af140067aaaff2ad6c0517d7e10e653400643a11`.
- Branch: `ops/free-studio-builders`.
- PR: https://github.com/RLM-Company/Nexus-OS/pull/518
- Entrypoint: Games → редактор исходников → файл / ZIP → Canvas version save.
- Сфера: существующий web Games и его e2e, один узкий Canvas integration adapter.

### Пользовательский сценарий до и после

До: откат внутри одного исходного файла был возможен лишь вручную;
возврат экспортированного ZIP требовал распаковать его и открыть project.json.

После: в редакторе есть независимые Undo/Redo выбранного файла.
Версии Canvas остаются опорными точками, локальная история не пересекает v1/v2.
Для ZIP есть локальный выбор файла, валидация без исполнения,
подтверждение замены, сохранение следующей версии через Canvas.

### Изменённые файлы

- `apps/web/src/app/games/game-source-editor.tsx` — UI локальной истории и ZIP import.
- `apps/web/src/app/games/game-project-archive.ts` — bounded inert ZIP validator.
- `apps/web/src/app/games/game-project-archive.test.ts` — invalid/valid archive tests.
- `apps/web/e2e/game-development.spec.ts` — Undo/Redo, ZIP, отказ, v2 и reload.
- `apps/web/src/app/canvas-editor/canvas-editor.tsx` — версия как Undo boundary.

### Проверки и ограничения

- GitHub Actions run `42982669501`: browser **SUCCESS** 445 + 3 + 5 + 4.
- В том же run: Code sandbox isolation **SUCCESS**.
- Verify monorepo **FAILED** до lint/typecheck/unit из-за
  `docs/research/experience-llm-distill-2026-11-10.json` в новом main.
- Список Prettier warnings не содержит файлов из Builders.
- Браузерный job собрал приложение и выполнил настоящий UI путь с fixtures.
- Человеческая live-проверка и paid model не выполнялись.
- Новых зависимостей/миграций нет; используется уже закреплённый fflate.
- Пользовательские данные, ключи, .env, внешние сайты и VPS не открывались.
- Imported ZIP ограничен исходной схемой трёх файлов; не импортирует ассеты.
- При конфликтующих файлах source/project.json импорт отклоняется.
- Только Codex решает общий quality blocker и будущий adapter контракт.

Следующая поставка: после устранения чужого format gate подтвердить весь CI,
передать Codex отдельный Canvas key commit и не выполнять merge самостоятельно.
