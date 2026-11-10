# 08_FREE_BUILDERS — точка продолжения

Дата: 2026-11-10. Статус: **в работе**, PR draft (не merge, не production).
Репозиторий: `RLM-Company/Nexus-OS`.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
CODE_HEAD_SHA: `c711591bc280128e951332510a225a8ebd4d0abf` (до документационного коммита).
Branch: `ops/free-studio-builders`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/501

## Что изменено

- `43d929ab002eea11291afa5797dfb922d5162c39`: файловый diff и управление жизненным циклом игрового preview + браузерный regression.
- `c711591bc280128e951332510a225a8ebd4d0abf`: отдельный узкий Canvas integration adapter (передача saved baseline).
- Документация в этом каталоге сохраняет границы, результаты и следующую задачу.

## Запуск следующего сеанса

1. Перечитать этот checkpoint, затем `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/UI_RULES.md`, `docs/product/STAGE_TWO_WORKFLOW_RU.md` и Next docs установленной версии перед веб-кодом.
2. Сверить `main`, ветку и PR #501. На момент создания PR `main` уже сместился с `9d972e8` на `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`; сравнение показало только документы операции и stage-two scope. При следующем изменении main повторить compare, не выбирать ours/theirs автоматически.
3. Посмотреть GitHub Actions CI #1734 (на момент сдачи `in_progress`); разобраться с тестовыми/TS/линт регрессиями. Локального checkout с node_modules у этого чата нет; GitHub API подключён, контейнер DNS github.com недоступен.
4. Запустить/подтвердить e2e `game-development.spec.ts`, `sites-workbench.spec.ts`, `games-workbench.spec.ts`, затем сделать ручную проверку preview и стабильности ZIP. Если CI падает, сначала устранить конкретную причину; не имитировать «всё зелёное».
5. Проверить risky scenario переключения seed при несохранённой правке; исправить без рефакторинга общего Canvas. Затем перейти к targeted update contract вместе с Codex.

Нет платных запросов, публикации, миграций, секретов и установки на ПК. Ветка предназначена только для интеграционной проверки Codex; не выполнять merge.
