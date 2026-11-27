# OpenCode 4 — сценарии (реальные проверки)

База: `main` `3af92583ccc8ceb49f44c0b8633955f40feaf59f`

## Срез 1 — CSV: адресная правка, проверка, версии, экспорт

1. **Inspect**: `POST /api/v1/document-workspace/inspect` с `prices.csv` →
   `version sha256:…`, `representation.kind = office_csv`, цели `table:1`,
   ячейки с адресами A1, кавычки/запятые, Unicode, CRLF сохранены.
2. **Preview**: план `set_cell` (A2 → `"00456"` как текст, C3 → формула
   `SUM(C1:C2)`) → diff из двух изменений, HMAC-токен владельца, версия.
3. **Commit**: Tokens/version совпали → новые байты, `source_version`,
   новая версия, readback. Неизменённые ячейки (`"Company, A"`,
   `кроме доставки`, `Ünïcode`) побайтово равны исходнику.
4. **Independent readback**: повторный `inspect` экспортированных байт
   даёт ту же версию и содержимое.
5. **Инъекция формул**: строковое значение `=1+1` экспортируется как
   `'=1+1`; `{formula: "SUM(C1:C2)"}` — как `=SUM(C1:C2)`;
   `WEBSERVICE("https://x")` отклонён whitelist.
6. **Конфликт версии/владельца**: stale version → 409 VERSION_CONFLICT;
   commit с токеном другого owner → 409 PREVIEW_EXPIRED.
7. **Отмена/порча**: незакрытая кавычка, бинарные байты, битой CRC,
   рваный range → отказ без результата; исходные байты не мутируют.
8. **Разделители/BOM**: `,`/`;`/`\t`/`|` и UTF-8 BOM сохраняются
   при экспорте; ведущие нули остаются текстом.

## Срез 2 — DOCX: замена ячейки таблицы целиком

1. DOCX с таблицей → `inspect` показывает цели `table:1/row:1/cell:1`.
2. План `set_docx_cell` (ячейка → «Новая цена») → preview → commit →
   readback; соседняя ячейка `00123` и стиль `<w:rPr><w:b/></w:rPr>`
   сохранены, все остальные части пакета побайтово равны.
3. Отказ: неверный target, перенос строки, объект-формула, отсутствующее
   значение; сложные объекты (field/revision/drawing) не трогаются.

## Срез 3 — независимый reader и полная цепочка

`desktop/windows/test/fixtures/independent-office-reader.cjs` читает ZIP
через собственный сканер локальных заголовков и zlib, извлекает текст
своим обходом XML — **не использует engine**. Тесты
`office-independent-readback.test.cjs` проходят цепочку
исходник → план → адресная правка → readback → экспорт → независимое
открытие для DOCX, XLSX (два листа, формулы, boolean), PPTX и CSV.

## Срез 4 — черновики планов

Черновики (`OfficePlanDraft`) сохраняют планы CSV (`table:1`) и DOCX
(`set_docx_cell`); кросс-форматные операции при восстановлении отклоняются.
Ранее черновик для `.csv` и ячеек DOCX отвергался и терялся при переключении.

## Запуск

```
node --test desktop/windows/test/office-independent-readback.test.cjs
node --test desktop/windows/test/office-docx-cell.test.cjs
node --test desktop/windows/test/office-csv.test.cjs
pnpm --filter @cosmora/api exec vitest run test/document-workspace-docx-cell.test.ts test/document-workspace-csv.test.ts test/document-workspace-api.test.ts
pnpm --filter @cosmora/web exec vitest run src/app/office-draft-storage.test.ts
pnpm --filter @cosmora/web exec vitest run
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/api build   # проверяет копирование engine в dist
```

## Статус

- Engine: 65/65 desktop Office тестов (10 CSV + 3 DOCX-cell + 4 independent).
- API: 9/9 targeted тестов (DOCX/XLSX/PPTX + CSV + DOCX-cell).
- Web: 464/464 unit-тестов, typecheck зелёный.
- E2E Playwright (браузер) и живая приёмка Windows — **не запускались**
  (нет назначенного доступа к device/браузеру; отдельный срез).
