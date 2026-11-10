# 08_FREE_BUILDERS — точка продолжения

Дата: 2026-11-10. Статус: **в работе**, PR draft (не merge, не production).
Репозиторий: `RLM-Company/Nexus-OS`.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
CODE_HEAD_SHA: `854274ef6847a261f7a42f3608069ba0e26d6d4e` (последний кодовый коммит до обновления отчётов).
Branch: `ops/free-studio-builders`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/501

## Что изменено
- `43d929ab002eea11291afa5797dfb922d5162c39`: файловый diff и управление жизненным циклом игрового preview + браузерный regression.
- `c711591bc280128e951332510a225a8ebd4d0abf`: отдельный узкий Canvas integration adapter (передача saved baseline).
- `78db7d5c2170a65471679f8ab08dc08581d14800`: форматирование browser assertion после сбоя Prettier.
- `99330d7ebb0cb0f548c5f25fb3b4e6d73051a525`: Sites/Games guarded switch + browser regressions.
- `854274ef6847a261f7a42f3608069ba0e26d6d4e`: отдельный узкий Canvas adapter `onDirtyChange`.
- Документация в этом каталоге сохраняет границы, результаты и следующую задачу.

## Запуск следующего сеанса
1. Перечитать этот checkpoint, затем `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/UI_RULES.md`, `docs/product/STAGE_TWO_WORKFLOW_RU.md` и Next docs установленной версии перед веб-кодом.
2. Сверить `main`, ветку и PR #501. На момент создания PR `main` уже сместился с `9d972e8` на `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`; сравнение показало только документы операции и stage-two scope. При следующем изменении main повторить compare, не выбирать ours/theirs автоматически.
3. Посмотреть CI по текущей ветке PR #501 (на момент обновления run `42876235421` queued). Первый запуск `42874502490` провалил Prettier для нового e2e; коммит `78db7d5` исправил длинный assertion. Локального checkout с node_modules у этого чата нет; GitHub API подключён, контейнер DNS github.com недоступен.
4. Запустить/подтвердить e2e `game-development.spec.ts`, `sites-workbench.spec.ts`, `games-workbench.spec.ts`, включая новые проверки guarded switch, затем сделать ручную проверку preview и стабильности ZIP. Если CI падает, сначала устранить конкретную причину; не имитировать «всё зелёное».
5. Проверить в браузере dirty callback, повторное открытие Work seed, отказ от перехода и восстановление черновика с реальным `localStorage`. После подтверждения перейти к targeted update contract вместе с Codex.

Нет платных запросов, публикации, миграций, секретов и установки на ПК. Ветка предназначена только для интеграционной проверки Codex; не выполнять merge.
