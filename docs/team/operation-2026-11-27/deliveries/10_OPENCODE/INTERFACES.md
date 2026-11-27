# OpenCode 4 — Office DOCX/XLSX/CSV — интерфейсы

База: `main` `3af92583ccc8ceb49f44c0b8633955f40feaf59f`
Ветка: `feature/oc4-office-workbench-20261127`

## Фактические входы/выходы существующего Office-пути

- `POST /api/v1/document-workspace/{inspect,preview,commit}` — байты выбранного
  файла (base64, до 2 МиБ), имя, `expected_version`, план операций.
- Engine: `desktop/windows/workspace/office-{text,document,edit,view}.cjs`;
  общий для native workspace и web API (копируется в dist скриптом
  `scripts/copy-office-engine.mjs`). Никаких внешних ZIP/XML-зависимостей,
  Office automation и вычисления формул.
- План: `OfficeOperationSchema` — `replace_text` (DOCX/PPTX), `set_cell`,
  `set_range`, `add_sheet` (XLSX), до 40 операций / 100 ячеек / 16 КБ.
- Версия: `sha256:<hex>` исходных байт. Preview выдаёт HMAC-токен владельца
  (10 минут), commit проверяет версию, токен и владельца, возвращает новые
  байты, diff, readback и новую версию.

## Срез 1 — CSV (добавление без переписывания engine)

Новый модуль `desktop/windows/workspace/office-csv.cjs` повторяет контракт
`inspectOffice`/`editOffice` для `.csv`:

- `inspectCsv(name, bytes, { cursor, expectedVersion })` → версия, цели
  `table:1/row:N` и `table:1/row:N/col:M` (через общий `pageOfficeView`),
  представление `kind: "office_csv"`.
- `editCsv(name, bytes, operations)` → операции `set_cell`/`set_range`
  с адресами A1, booleans, null, строки и **только явно объявленные** формулы
  `{formula}`. Формулы не вычисляются.
- Парсер/сериализатор: UTF-8 (fatal), BOM, кавычки `""`, `,`/`;`/`\t`/`|`
  разделители (детекция по консистентности), CRLF/LF, Unicode, пустые поля;
  несовместимые строки отклоняются.
- Защита CSV-инъекций: строковое значение, начинающееся с `= + - @` (включая
  whitespace/invisible prefix), сохраняется с префиксом `'`. Значения типа
  `number`/`boolean`/`null`/`{formula}` записываются как есть без кавычек.
- Ограничения: 2 МиБ на файл, 250 столбцов, 100 000 строк, 10×10 на range,
  100 изменённых ячеек, 16 КБ на план. Readback сравнивает изменённые ячейки
  с заявлением и проверяет, что остальные ячейки побайтово равны исходнику.
- Конфликт версии: `WORKSPACE_OFFICE_VERSION_CONFLICT`, как и в XLSX.
- Поддержка включается в `office-edit.cjs` через тонкий delegating-слой:
  `inspectOffice`/`editOffice`/`validateEdits` распознают `.csv` и вызывают
  `office-csv.cjs`. Существующие DOCX/XLSX/PPTX пути не меняются.
- Build: `scripts/copy-office-engine.mjs` копирует новый модуль; API-engine
  path уже в dist. Web UI принимает `.csv` в file picker и отображает адреса
  ячеек так же, как XLSX.

## Владение данными

Файл остаётся у пользователя; сервер работает с копией байт в памяти и
возвращает экспорт. Права и filesystem доступ остаются у native workspace
(OpenCode 1); web path — stateless, без нового хранилища.
