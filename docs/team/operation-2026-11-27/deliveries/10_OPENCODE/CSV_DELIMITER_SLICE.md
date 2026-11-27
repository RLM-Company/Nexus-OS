# OpenCode 4 — CSV export delimiter quoting (slice 2026-11-27, additional agent)

Этот срез выполнен в отдельном изолированном worktree, чтобы не трогать
незакоммиченные изменения основного чата OpenCode 4.

- Base SHA: `2b9a606cfa311ef8072903aa4b800eb44d57af20`
- Head SHA: `64c7f383c91c96f58a5d09a60b3c60e8002a3a34`
- Branch: `feature/oc4-office-workbench-20261127`
- Worktree: `C:/Users/Александр/.local/share/opencode/worktree/9ff80c/oc4-office-xlsx-slice`
- Commit: `fix(office): quote active delimiter in CSV export and verify reopen`
- PR: тот же PR #696 (ветка уже обновлена push)

## Дефект

`office-csv.cjs` квотировал поле только при наличии `,`, `"` или перевода строки.
Если исходный CSV использовал другой разделитель (`;`, `\t`, `|`), то значение,
содержащее этот разделитель, экспортировалось без кавычек. Повторное чтение
разбивало строку на лишние колонки и `editCsv` падал с `WORKSPACE_OFFICE_READBACK`.
То есть адресная правка реально работала только для части значений.

## Исправление

`csvField` теперь квотирует поле, если оно содержит любой поддерживаемый
разделитель (`,`, `;`, `\t`, `|`), кавычку или перевод строки. Это сохраняет
прежнее поведение для comma-файлов и защищает повторное определение разделителя.
Кавычки внутри значения удваиваются как раньше.

## Проверки (реальные)

- `node --test test/office-*.test.cjs` (desktop/windows) — 66/66 pass
  ( Including new regression for all four delimiters and independent reader tests).
- `node --test test/office-csv-native.test.cjs` — 2/2 pass.
- `pnpm --filter @cosmora/api exec vitest run test/document-workspace-csv.test.ts
  test/document-workspace-api.test.ts test/document-workspace-docx-cell.test.ts` — 10/10 pass.
- Новый API-тест проходит полный путь inspect → preview → commit → inspect
  для `;`-файла со значением `Company; A` и проверяет, что ячейка B2 осталась
  одной ячейкой, а соседние значения не сдвинулись.

## Источники

- `desktop/windows/workspace/office-csv.cjs` — `needsQuoting`, `csvField`, `serialize`.
- `desktop/windows/test/office-csv.test.cjs` — regression test.
- `apps/api/test/document-workspace-csv.test.ts` — production-path regression test.

## Остаток

- Живой браузерный/E2E проход не запускался (нет назначенного доступа).
- Изменения в чужих зонах (computer-policy, browser/driver, ingestion) не вносились.
