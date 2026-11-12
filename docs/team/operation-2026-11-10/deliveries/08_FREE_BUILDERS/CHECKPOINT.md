# 08_FREE_BUILDERS — точка продолжения

## Актуальная точка — 2026-11-12

**Статус:** в работе, PR #556; не сливать и не выкатывать самостоятельно.

- Репозиторий: `RLM-Company/Nexus-OS`.
- BASE_SHA: `00ceac8b47f220cd798e3f4cbd0596af14b3443d`.
- CODE_HEAD_SHA: `cfc0df4540d993a117698354a6d4f91f61eb2f2d`.
- Ветка: `ops/free-studio-builders`.
- PR: https://github.com/RLM-Company/Nexus-OS/pull/556
- Предыдущие PR #501 и #518: уже интегрированы в main.

### Новое в этой ветке

1. Sites: локальная диагностика ограничений HTML/preview с явной проверкой,
   устареванием отчёта и запретом исполнения исходника.
2. Sites: PNG/JPEG/WebP до 64 КиБ можно встроить в код без внешних запросов;
   ресурс сохраняется в одном HTML-файле и проходит обычный Canvas lifecycle.
3. Узкий Canvas adapter добавляет компонент импорта только для Site HTML.
4. E2E и unit тесты добавлены, но полный текущий CI ещё требуется подтвердить.

### Продолжение

- Проверить актуальные main, PR #556 и CI run на CODE_HEAD.
- Проверить lint, typecheck, unit, build, Chromium и sandbox, исправлять только
  ошибки своей области; не заменять живую приёмку тестовыми fixtures.
- `site-source-diagnostics.ts` содержит временный `// prettier-ignore`
  для диагностики prettier-расхождения. Перед merge убрать исключение
  и привести исходник к каноническому формату.
- Не расширять Canvas/Work/DB API: typed patch/version контракт остаётся за Codex.
- Никаких платных API, деплоя, авто-публикации, пользовательского ПК и merge.

## Историческая точка — 2026-11-11

## Актуальная точка — 2026-11-11

Статус: **в работе, код и браузер проверены; внешний core gate заблокирован**.
PR #501 уже в main. Новый PR: https://github.com/RLM-Company/Nexus-OS/pull/518
Branch: `ops/free-studio-builders`.
BASE_SHA: `c47fed43a20e49a7ea27495f5551e7cfc082fcb5`.
CODE_HEAD_SHA: `af140067aaaff2ad6c0517d7e10e653400643a11`.
После этого CODE_HEAD следует только отчётный коммит.

Новое: per-file Undo/Redo; импорт валидированного ZIP напрямую в редактор.
Canvas integration: один key из selected artifact ID и server version.
Backend, DB, contracts, sandbox и общий executor не менялись.

CI #42982669501 на CODE_HEAD:

- Browser acceptance: SUCCESS, Chromium 445/445 и дополнительные 3/3, 5/5, 4/4.
- Code sandbox isolation: SUCCESS.
- Verify monorepo: FAILED на Prettier чужого
  `docs/research/experience-llm-distill-2026-11-10.json` из main.
- Ни один файл Builders не указан в списке ошибок форматирования.
- Полные unit/lint/typecheck gates не дошли до исполнения в этом job.
- Browser job отдельно собрал web и успешно выполнил реальные UI fixtures.

Продолжение: сверить свежий main, PR #518 и CI, дождаться устранения
внешнего форматирования Codex и повторить полный quality gate.
Не править чужой research JSON ради зелёного CI.
Далее согласовать typed patch/version adapter с Codex.
Никакого merge, деплоя, платного API или публикации не выполнять.

## Исторический checkpoint 2026-11-10

Дата: 2026-11-10. Статус: **готово к интеграции** (два ограниченных среза, не вся сфера), PR #501; не merge, не live, не production.
Репозиторий: `RLM-Company/Nexus-OS`.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
CODE_HEAD_SHA: `606ed1eb876073745cad941d688bf067b3de7e9f` (полностью проверенный code+test SHA; следующий коммит только с отчётами).
Branch: `ops/free-studio-builders`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/501

## Что изменено

- `43d929ab002eea11291afa5797dfb922d5162c39`: файловый diff и управление жизненным циклом игрового preview + браузерный regression.
- `c711591bc280128e951332510a225a8ebd4d0abf`: отдельный узкий Canvas integration adapter (передача saved baseline).
- `78db7d5c2170a65471679f8ab08dc08581d14800`: форматирование browser assertion после сбоя Prettier.
- `99330d7ebb0cb0f548c5f25fb3b4e6d73051a525`: Sites/Games guarded switch + browser regressions.
- `854274ef6847a261f7a42f3608069ba0e26d6d4e`: отдельный узкий Canvas adapter `onDirtyChange`.
- `82c2135a0adf82493c52b79e88c7c36df7615723`: JSX closure и Prettier-форматирование отчётов.
- `bc6e1b47bbea9895fb1632d5888d47a56d1b0e36`: exact optional props TypeScript adapter fix.
- `606ed1eb876073745cad941d688bf067b3de7e9f`: исправлена регистрозависимая Playwright проверка подписи «удалено строк».
- Документация в этом каталоге сохраняет границы, результаты и следующую задачу.

## Запуск следующего сеанса

1. Перечитать этот checkpoint, затем `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/UI_RULES.md`, `docs/product/STAGE_TWO_WORKFLOW_RU.md` и Next docs установленной версии перед веб-кодом.
2. Сверить `main`, ветку и PR #501. На момент создания PR `main` уже сместился с `9d972e8` на `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`; сравнение показало только документы операции и stage-two scope. При следующем изменении main повторить compare, не выбирать ours/theirs автоматически.
3. Проверка `CI run 42879624872` на `606ed1e`: **SUCCESS** (`Verify monorepo`, `Code sandbox isolation`, `Browser acceptance`). В Chromium 424/424 основных теста, затем 3/3 + 5/5 + 4/4 дополнительных. Предыдущие сбои были локальными тестовыми/JSX/TS ошибками, исправлены; живой paid-provider не проверен.
4. Перед любым новым кодовым изменением перепроверить `main` и CI на актуальном head; не merge в этом исполнителе. Повторить ручную live-приёмку у владельца (preview, редактирование, reload и ZIP) без платных API, если будет отдельное разрешение.
5. Следующая независимая задача: обсудить с Codex typed patch/version precondition для AI-итераций по одному файлу, сохранить существующие Canvas/Work/Coscode contracts; не копировать executor и не переписывать соседние файлы.

Нет платных запросов, публикации, миграций, секретов и установки на ПК. Ветка предназначена только для интеграционной проверки Codex; не выполнять merge.
