# Рабочие документы Koswork — поставка

Владелец реализации: Разработчик + GPT. Репозиторий: RLM-Company/Nexus-OS.
Фактическая база актуального main: `338536ee5946f96dcd18768143cc41af998c476a`.
Ветка: `developer/koswork-office-workspace`. Merge/deploy не выполнялись.

Опубликованные коммиты реализации:

- `75b23dec986dbfc6b04426ec0cbe26a2e2985d73` — ZIP/XML primitives, адресуемые правки и планы.
- `559afd5134098110dea1fb20cba46c3ab51c1227` — завершённый engine, web API/editor, сценарии и тесты.
- `847fce72dfeadc5858cab667bebae9ebfe8c6f1b` — отдельная минимальная интеграция общих файлов.

Финальный SHA с этим документом доступен через `git rev-parse HEAD` в ветке PR.
Публикация выполнена GitHub connector: SHA каждого дерева сравнен с локальным,
затем ветка скачана с настоящего `https://github.com/RLM-Company/Nexus-OS.git`;
`git diff HEAD FETCH_HEAD` подтвердил совпадение исходников. Локальный mirror push
не использовался и за публикацию не выдавался.

## Что было и что работает теперь

До изменений существовали генераторы всех трёх форматов, безопасное извлечение
текста, версии/хеши, workspace grants, Work cycle и подтверждение новых файлов.
Редактирования существующих документов с preview не было. Эти механизмы сохранены.

Теперь пользователь может открыть выбранный Office-файл, увидеть адреса объектов,
подготовить конкретные правки, проверить «Было/Будет», отдельно подтвердить копию,
получить новую версию, SHA256 и readback реальных выходных байтов.

- DOCX: уникальная точечная замена в абзаце, таблице или физической ячейке таблицы.
  Замена может пересекать соседние текстовые runs одного абзаца; стили/runs,
  нетронутые элементы и остальные ZIP-части сохраняются. Через границу абзацев
  текст не склеивается для замены.
- XLSX: существующие листы/ячейки, добавление листа, типизированные значения
  string/number/boolean/null, ограниченные явные формулы и диапазоны до 10×10.
  Строка `00123` остаётся строкой. Формулы не вычисляются, отсутствующий кеш
  не выдаётся за результат. Существующие кеши обозначены как сохранённые значения.
- PPTX: точечная замена текста существующего shape/placeholder выбранного слайда
  в порядке presentation relationships; нетронутые слайды, relationships и медиа
  сохраняются. Создание новых графических объектов не поддерживается.

Ошибочный/неподдержанный план отклоняется целиком до записи; частичного применения
нет. Успешный receipt содержит source_version, новую version/sha256,
executed_changes/diff, rejected_changes (пустой при полном успехе), representation
и readback. Повтор native commit с использованным plan_id отклоняется.

## Реальный пользовательский путь и хранение

**Work:** существующая выбранная обычная рабочая папка → `workspace_office_inspect`
→ `workspace_office_preview` → нативное подтверждение проверенного diff →
`workspace_office_commit` → новая копия через существующий createDataFile → readback.
expected_version проверяется при preview, commit и непосредственно перед записью
после ожидания блокировки выходного пути. Конфликт не перезаписывает исходник.
Существующий выходной файл также не перезаписывается. Планы одноразовые, живут
не более 10 минут, максимум 8; отмена, конец задачи и отзыв доступа очищают их.
Production-обёртка createVaultWorkspace передаёт capability/подтверждение и очистку
в основной workspace. Виртуальные `.kosmora-vault` не превращены в writable paths.

**Панель файлов:** существующий `/?surface=files`, блок «Рабочие документы Koswork».
Выбрать DOCX/XLSX/PPTX → просмотреть содержимое/адреса → добавить правки в план →
«Посмотреть изменения» → «Подтвердить подготовку новой копии» → «Скачать новую копию».
Выбранные пользователем байты отправляются authenticated API. API stateless:
не создаёт вторую библиотеку/хранилище/исполнитель, не получает путь к диску.
HMAC preview связывает owner, исходные байты/version, имя, операции и срок действия.
Изменение плана, источника либо истечение preview требует нового preview.
Файл остаётся выбранным снимком; изменения оригинала на диске после выбора веб-
редактор не наблюдает. Экспорт сохраняет копию через загрузку браузера, не пишет
в локальную папку и не объявляет файл сохранённым до действия пользователя.
Живой конфликт исходного файла на диске проверяет native Work-путь.

API: POST `/api/v1/document-workspace/{inspect,preview,commit}` с name/bytes(base64),
а для правок — expected_version/operations; commit также требует preview_token/expires.
Авторизация — существующий onRequest/identityFor, новые grants не введены.
Все ответы private, no-store; пути и URL ресурсов от модели не исполняются.
Контракт операций: `packages/contracts/src/office-workspace.ts`.
Новые Work-команды предлагаются только при `supports_workspace_office_edits` +
локальной поддержке и `observation.workspace.edit_office=true`; legacy API/client
проверены на отказ. Реальный HY4, тарифы, квоты и модель прав не менялись.

## Запуск и входы/выходы

Из корня чистого checkout:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cosmora/api... build
pnpm --filter @cosmora/web build
node desktop/windows/test/fixtures/run-office-edit-brief.cjs work/office-acceptance
```

Последняя команда требует нового каталога результата и создаёт родительский
каталог при необходимости. Это настоящий service I/O по отдельной выбранной
fixture-папке: исходники, preview, сохранённые копии и повторное чтение.
Провайдер/настоящая модель не вызываются. Work-тест использует fixture planner;
API-тесты используют test/mock environment, не HY4.

Поставленные входы и выходы: `docs/handoff/fixtures/koswork-office/`.
`offer.{docx,xlsx,pptx}` — входы; `offer.updated.*` — сохранённые результаты.
`results.json` — исходные/новые версии, SHA, реальные diff и список изменённых
ZIP-частей; `*.readback.json` — чтение выходов. Сохраняются `19 700`, `00123`,
`07.11.2026`, «кроме доставки»; числовое XLSX значение хранится как 19700.
Повторный запуск на итоговых исходниках воспроизвёл идентичные выходные байты.
Есть также регрессия на уже имевшихся независимых python Office-фикстурах
`desktop/windows/test/fixtures/office-import.json`, включая абсолютные внутренние
relationships XLSX и фактический порядок слайдов PPTX.

## Фактически запущенные проверки

```sh
node --test desktop/windows/test/office-edit*.test.cjs \
  desktop/windows/test/office-text.test.cjs desktop/windows/test/office-document.test.cjs \
  desktop/windows/test/work-document-cycle.test.cjs desktop/windows/test/computer-workspace.test.cjs \
  desktop/windows/test/vault-workspace.test.cjs desktop/windows/test/work-cycle.test.cjs
pnpm --filter @cosmora/api exec vitest run test/document-workspace-api.test.ts test/computer-control.test.ts --maxWorkers=2
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.office.config.ts
pnpm --filter @cosmora/api... build
pnpm --filter @cosmora/api typecheck
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/contracts typecheck
pnpm --filter @cosmora/web build
pnpm --filter @cosmora/api lint
pnpm --filter @cosmora/web lint
pnpm --filter @cosmora/contracts lint
node scripts/check-secrets.mjs
git diff --check
```

Результат: 81 native тест, 80 API-тестов, 3 Chromium e2e — PASS.
Сборки, typecheck и package lint выше — PASS; secret scan и diff check — PASS.
Изменённые файлы проверены Prettier без переформатирования общих файлов целиком.
Полный корневой `pnpm check` и Windows/production acceptance не запускались.

Проверены успешная запись/receipt/readback, неизвестный объект/unsafe formula,
устаревшая версия, повтор commit, отказ владельца, отмена, отзыв папки, смена owner,
неподдержанный клиент, readonly vault, источники с неверным CRC/ZIP-slip/symlink,
макросы и DTD. Отдельно source mutation/отмена/отзыв во время ожидания write-lock
не оставляют выходной файл. Макросы, ссылки и внешние ресурсы модуль не исполняет.

История найденных проблем не скрыта повторным запуском:

- Первая установка зависимостей не смогла создать pnpm home. Установка прошла с
  PNPM_HOME/XDG_DATA_HOME/store-dir внутри `/workspace/work`, без install scripts.
- Первый typecheck нового API-теста выявил пропущенный database и unknown payload;
  исправлена тестовая фикстура/типы, последующие typecheck и package lint прошли.
- Первый Chromium тест не находил label «Адрес»; добавлены явные aria-label для
  select. После исправления все три сценария прошли, retries=0.
- Прямой ESLint над e2e-файлом отказал: e2e исключены существующим web tsconfig.
  Стандартный web lint (src) прошёл; e2e скомпилирован и выполнен Playwright.
- Range formatter не разобрал отдельный await-фрагмент. Добавленные участки общих
  файлов выровнены локально; последующий формат/diff check прошёл.
- Один запуск web build остановлен с exit 130, чтобы не пересекаться с dev/e2e
  в одной .next. Последующая отдельная production build успешно завершилась.
- Обзор независимого XLSX выявил абсолютные внутренние targets; исправлен resolver,
  добавлен и пройден соответствующий тест. Доступа к внешней сети не добавлено.
- Diff check обнаружил буквальные trailing tabs в текстовом readback DOCX.
  Артефакты переведены в lossless JSON: text содержит полный вывод, включая табы
  и окончания строк; содержимое не обрезано. После этого diff check прошёл.
- Первый PDF export использовал одинаковое имя для трёх форматов и перезаписал PDF.
  Повторная проверка сохранила отдельные каталоги; все три PDF существуют.

## Проверка открытия/рендера

В отдельном облачном fixture-стенде использован уже установленный
LibreOfficeDev 26.8.0.0.alpha0 (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`).
Никакие программы на ПК владельца не устанавливались/не запускались.

```sh
# Повторить для docx, xlsx, pptx с отдельным каталогом каждого формата:
soffice -env:UserInstallation=file:///tmp/koswork-office-render-profile \
  --headless --convert-to pdf --outdir work/render-docx \
  docs/handoff/fixtures/koswork-office/offer.updated.docx
```

`render/{docx,xlsx,pptx}/offer.updated.pdf`, `rendered.txt` и `render/results.json`
содержат фактические результаты, команды, exit codes и stderr. Во всех случаях
exit 0, PDF создан, pdftotext exit 0; исходные выходные Office-байты после открытия
сверены с receipt SHA и не изменились. Были предупреждения Fontconfig о cache dir;
они сохранены в results.json. Первые страницы DOCX/PPTX просмотрены как изображения.
У XLSX исходная ширина C не помещает «кроме доставки» на печати: PDF показывает
«кроме дос». В сохранённых XML/readback условие полное; ширина не менялась.
Не заявляется полная визуальная приёмка, проверка Microsoft Office или Windows.
Calc при открытии может вычислить формулу; это отдельный renderer, не engine.
`results.json.visual_render_verified=false` относится к автоматическому engine,
который сам рендер не выполняет; результаты отдельного рендера лежат рядом.
`ui/` содержит реальные снимки preview/готовой копии браузерного сценария.

## Границы поддерживаемого редактирования

Default native/web source — до 2 МиБ; native write — существующий лимит 2 МиБ.
ZIP: прежние ограничения 1000 записей, 8 МиБ на часть, 16 МиБ expanded, CRC,
отказ symlink/traversal/duplicate names/encryption. XML: без DTD, внешних сущностей и сетевых запросов,
ограничения глубины/числа событий. Никакого ослабления file grants.

Адресный viewer — до 300 targets и 10000 байт JSON; на листе показаны первые 100
ячеек с явным cells_excerpt_only/total_cells. План — до 40 операций/16000 байт,
до 100 раскрытых ячеек диапазонов, diff до 10000 байт. Больший план отклоняется,
не обрезается. Текстовая замена требует единственного совпадения и не принимает
переносы строк/табуляцию в замене. Редактируемые XML-части — UTF-8; существующий
текстовый readback продолжает поддерживать UTF-16.

Сложные fields/revisions/content controls в выбранном DOCX-объекте, распознанные
макросы/ActiveX/embedded objects, подписанные пакеты и calcChain отклоняются. XLSX merged
cells/table parts/extensions/shared/array formulas отклоняются при изменении;
добавление ячейки за существующую dimension без её корректировки не поддержано.
Формулы — только прежний безопасный whitelist SUM/AVERAGE/MIN/MAX/COUNT с локальными
адресами; строка, начинающаяся с '=', остаётся строкой. Чтение не равно полному
рендеру: изображения/диаграммы/notes/headers не представлены текстом. Авто-исправления
верстки, обновления зависимых cached values и WYSIWYG здесь нет.

## Изменённые файлы, интеграция и откат

Новые engine/transaction modules: `desktop/windows/workspace/office-edit.cjs`,
`office-workspace.cjs`; сохранённые primitives дополнены в `office-document.cjs`
и `office-text.cjs`. Новые web/API/contract файлы: `apps/web/src/app/office-document-workspace.tsx`,
`apps/api/src/document-workspace-routes.ts`, `packages/contracts/src/office-workspace.ts`.
Production assets копирует `scripts/copy-office-engine.mjs` из единственных исходников,
а не из второй копии engine.

Общие интеграционные файлы: workspace-service, computer-workspace, computer-policy,
computer-session, computer-api-client, work-cycle-driver, vault-workspace;
`packages/contracts/src/{computer-control,index}.ts`, `apps/api/src/{app.ts,computer-control/service.ts}`,
`apps/api/package.json`, `apps/web/src/app/studio-files.tsx`. Их diff минимален и
содержится в отдельном коммите `847fce7`. Windows main/installer и browser/** не менялись.
Тесты: office-edit, office-edit-work-cycle, fixtures/office-edit-brief/run-office-edit-brief,
существующие vault-workspace/computer-control тесты, API document-workspace-api,
web office-workspace e2e и playwright.office.config.ts. Новый вид отложен в VISUAL_WAITLIST.md.

Миграций нет: новые постоянные таблицы/хранилища не создавались. Для интеграции
нужны все три коммита реализации; отдельно engine без integration не поставка.
API build должен копировать Office assets, web собирается после contracts.
Для отката сначала revert интеграционного коммита (скрывает контролы/capabilities/
маршруты и вызовы), затем коммитов реализации в обратном порядке. При откате всех
коммитов одновременно конфликтов промежуточной типизации не будет. Файлы пользователя
не удалять: источники не заменялись, новые копии — самостоятельные результаты.

## Продолжение: устранение отказа CI

Для `abb10017812cf882f2e69ab6f70985fdbf4183d6` фактический GitHub CI:

- API identity boundary — success, run `42413993689`.
- Browser acceptance и Code sandbox isolation — success в run `42413993866`.
- Verify monorepo — failure в run `42413993866`, job `128528007009`:
  `packages/tool-runtime/test/code-agent-workspace.test.ts:86`,
  `SyntaxError: Unexpected end of JSON input` в `calls()` при ожидании start.
- Windows desktop, run `42413993662` — cancelled во время fresh installer lifecycle.
  Syntax/policy checks и обе сборки installer завершились success. Лимит job —
  35 минут; журнал заканчивается `The operation was canceled`. Конкретный инициатор
  отмены из полученных данных не установлен. Windows lifecycle остаётся неподтверждённым.

Обнаружена гонка чтения тестового JSONL: файл уже создан, но очередная запись ещё
не завершена. Читатель разбирал пустую строку либо незавершённый JSON. Исправление
ограничено тестовой фикстурой: запись считается законченной только после `\n`.
Полностью записанный некорректный JSON продолжает вызывать ошибку. Регрессионный
тест воспроизводит пустой файл, незавершённую первую/следующую запись и повреждённую
завершённую строку. Проверки production timeout/cleanup не ослаблялись.

Запущено после изменения:

```sh
pnpm --filter @cosmora/tool-runtime test
pnpm --filter @cosmora/tool-runtime typecheck
pnpm --filter @cosmora/tool-runtime lint
pnpm exec prettier --check packages/tool-runtime/test/code-agent-workspace.test.ts
```

Результат: **64 passed, 4 skipped**; typecheck/lint/format — PASS.
Четыре локально пропущенных теста требуют отдельного OCI-стенда; их локальный
запуск не заявляется. Первое падение CI не выдаётся за успешный запуск и не
маскируется повтором прежнего SHA. Новый коммит должен пройти собственный CI.
