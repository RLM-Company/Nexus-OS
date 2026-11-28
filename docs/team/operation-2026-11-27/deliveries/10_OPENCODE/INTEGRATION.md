# OpenCode 4 — INTEGRATION.md

## Срез 1 — CSV в Office workbench

**Base SHA:** `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (actual `origin/main`,
проверен `git fetch` перед началом; совпадает с назначенной базой).
**Branch:** `feature/oc4-office-workbench-20261127`
**Worktree:** `C:/Users/Александр/Documents/Codex/2026-11-27/kosmora-oc4-office`

### Минимальные Integration-изменения (общие файлы)

| Файл                                         | Изменение                                                     | Причина                                                                          |
| -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/contracts/src/office-workspace.ts` | `target` в `set_cell`/`set_range` теперь `(sheet:N\|table:1)` | Добавляет CSV-адрес к существующему DTO; обратная совместимость с XLSX сохранена |
| `apps/api/src/document-workspace-routes.ts`  | regex имени расширен `.csv`                                   | Разрешить stateless API принимать CSV                                            |
| `scripts/copy-office-engine.mjs`             | + `office-csv` в список копируемых                            | Engine должен присутствовать в `apps/api/dist/document-workspace/`               |
| `desktop/windows/package.json`               | + `workspace/office-csv.cjs` в `build.files`                  | Упакованный desktop runtime требует модуль (проверено packaging-тестом)          |

Другие общие файлы (`app.ts`, `server.ts`, контракты index, корневые
exports/config/lockfile) **не изменены**. Нового хранилища, миграций,
сетевых вызовов и прав доступа нет.

### Внутренние изменения (зона владения)

- `desktop/windows/workspace/office-csv.cjs` (новый) — memory-only CSV engine.
- `desktop/windows/workspace/office-edit.cjs` — тонкий dispatch на `.csv`.
- `desktop/windows/workspace/office-text.cjs` — экспорт `text` (fatal UTF-8 decode).
- `apps/web/src/app/office-document-workspace.tsx` — file picker `.csv`,
  error-copy, скрытие «добавить лист», адреса ячеек, замена ячейки DOCX.
- `apps/web/src/app/office-plan.ts` — разрешены `table:1` и `table:N/row:R/cell:C`.
- `apps/web/src/app/office-plan-editor.tsx` — отображение и редактирование `set_docx_cell`.

### Проверено

- contracts build, api build (engine в dist), web typecheck — exit 0.
- 58 desktop Office тестов, 8 API, 463 web unit — pass.

### Зависимости от других исполнителей

- Native filesystem/владельческие разрешения остаются у OpenCode 1;
  web-путь stateless и не требует новых грантов.
- Общий интегратор: только вышеперечисленные 4 общих файла; conflicts
  маловероятны, но при необходимости можно вынести контракт в отдельный файл.
