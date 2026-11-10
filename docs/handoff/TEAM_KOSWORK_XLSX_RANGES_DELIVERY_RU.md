# Koswork: типизированные диапазоны XLSX в панели файлов

10 ноября 2026, Москва. Ветка `developer/koswork-office-workspace`, PR #466.
BASE_SHA этого продолжения: `85b6bd977726418f3651eecabb42d2477344bf05`;
актуальный main при начале: `9a7ffec6846b1a02f041f2c69ea9a726fdff49fd`,
уже включён в ancestry. Предыдущие реализации Office/Work/composer сохранены.

## Действующий пользовательский путь

Ранее `set_range` уже работал в engine/API/tools, но панель Office позволяла
добавлять только отдельные ячейки. Теперь: «Анализ файлов» → «Рабочие документы
Koswork» → открыть выбранный XLSX → выбрать существующий лист либо добавить
новый в план → «Диапазон ячеек XLSX» → вставить таблицу из Excel → разобрать →
выбрать тип каждого столбца → добавить диапазон в план → preview diff → отдельно
подтвердить новую копию → скачать → версия/SHA256/повторное чтение.

Первая строка — данные, а не заголовки. По умолчанию все ячейки — текст:
пробелы, единицы, ведущие нули, условия и строки с `=` не интерпретируются.
Число, true/false, формула и очистка выбираются явно для столбца; исключения
можно добавить существующей правкой отдельной ячейки после диапазона в том же
плане. Очистка применяется только после показа diff и подтверждения.

Числовой ввод допускает десятичную точку/экспоненту, до 15 значащих цифр,
проверяет представление JSON number, отказывает при округлении/underflow,
отрицательном нуле и неподдерживаемых значениях. Длинный реквизит можно сохранить
текстом. Это же преобразование подключено к существующей одиночной ячейке.
Формулы передаются декларацией; whitelist проверяет прежний engine при preview,
вычисления и произвольная загрузка внешних ресурсов не добавлены.
Прежний whitelist: SUM/AVERAGE/MIN/MAX/COUNT с локальными адресами.
Для clipboard выбран существующий raw parseWithDelimiter: parseCsv строит
заголовки с trim и не подходит для сохранения первой строки как данных.
CSV export escaping с добавлением апострофа не применяется: XLSX текст
пишется существующим engine как inlineStr, включая буквальную строку с «=».

Исходник сохраняется. Прежние HMAC preview/expected_version, client digest,
отдельное подтверждение, cancel/generation fence и readback используются без
нового store/исполнителя/маршрута. Native capabilities/file grants не расширены.
Старым клиентам новых tools не выдаётся: это существующая операция/контракт.
Миграции, общие contracts и app.ts не менялись. HY4, тарифы и квоты прежние.

## Реальные fixtures и результат

[input.json](fixtures/koswork-xlsx-range/input.json) задаёт независимую таблицу
2 × 5: реквизиты `00123`/`00456`, число 19700 и -12.5, true/false,
SUM/MIN и обязательные условия. [source.xlsx](fixtures/koswork-xlsx-range/source.xlsx)
— настоящий выбранный источник, [range.koswork.xlsx](fixtures/koswork-xlsx-range/range.koswork.xlsx)
скачан браузером после явного подтверждения. [result.json](fixtures/koswork-xlsx-range/result.json)
содержит source/new version, hash, 11 выполненных изменений, rejected_changes,
повторное чтение и список изменённых ZIP-частей. Модель не вызывалась.

- Source SHA256: `7018baf8963ea45fef2c021a1909e324dfd685737749d79e945856bcec0acb15`.
- Result SHA256: `e5adf0075ade775a7406ade4c5e0ad5456de28380d231de86967809b7c994fbb`.
- Изменены workbook.xml, workbook.xml.rels, Content_Types и новый sheet2.xml.
  Все остальные исходные ZIP-части сохранены по байтам, в том числе sheet1.xml.
- Проверены `00123`, дата, числа, «кроме доставки», «условие обязательно» и
  «не включать доставку». Формулы имеют `<f>` без вычисленного `<v>`.
- Отдельный сценарий скачивает текст `=SUM(A1:A1)` как inlineStr без `<f>`.
  Изменение вставленного текста отменяет старый разбор, не применяя устаревшую
  таблицу. Ошибки формы/адреса/точности не отправляют preview.

## Открытие и визуальные границы

LibreOfficeDev 26.8.0.0.alpha0, commit
`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`, открыл именно эти выходные байты
в отдельном временном profile и создал [PDF](fixtures/koswork-xlsx-range/render/range.koswork.pdf).
Export exit 0, две страницы; обе просмотрены изображениями, проверен pdftotext.
[Render receipt](fixtures/koswork-xlsx-range/render/results.json) содержит команды,
версии, PDF hash и предупреждения Fontconfig о недоступном cache (export успешен).

Новый лист на странице 2 содержит все проверяемые числа и условия. На странице 1
исходная узкая колонка C по-прежнему печатает «кроме дос» вместо полного условия:
это прежняя верстка нетронутого листа, его XML побайтно сохранён. Само условие
полностью остаётся в XLSX/readback. Исправление исходного оформления не заявляется.
Calc вычислил формулы для PDF; это отдельный renderer, не расчёт в engine/API.
`visual_render_verified=false` в автоматическом engine receipt не подменён.
Microsoft Office/ПК владельца не проверялись, production не затрагивался.

## Проверки и история ошибок

- Unit range + существующий CSV parser: 13/13 PASS, два файла Vitest.
- Первый browser-прогон: **3 FAIL / 2 PASS**, exit 1. Точный getByLabel не находил
  селекты столбцов; добавлены явные aria-label в компонент, тесты не отключены.
  [Исходный лог](fixtures/koswork-xlsx-range/first-browser-failure.log), удалены
  только конечные пробелы строк при переносе. Traces/error-context сохранены в
  `/tmp/koswork-xlsx-range-first-failure`, исходный лог —
  `/tmp/koswork-range-first-browser.log`.
- После исправления: 5/5 PASS, retries=0, `/tmp/koswork-range-fixed-browser.log`.
- Первый общий набор: 64/64 PASS, retries=0, workers=1,
  `/tmp/koswork-range-final-browser.log`. Просмотр скриншота затем выявил растяжение
  панели широкой таблицей: локально ограничен fieldset, добавлена именованная
  прокрутка с клавиатуры. Новый тест проверяет границы viewport и доступность
  последнего столбца; после этого 5/5 PASS,
  `/tmp/koswork-range-layout-browser.log`.
- Окончательный общий production прогон после ограничения ширины:
  **64/64 PASS**, retries=0, workers=1, exit 0,
  `/tmp/koswork-range-delivery-browser.log`. Сохранённый result.json и XLSX
  получены именно этим прогоном; их байты совпадают с использованными в PDF.
- Первый `pnpm check:core` остановился на lint (exit 1): 6 unsafe-any
  в генераторах тестовых массивов и 1 preserve-caught-error в обработке ячейки.
  Массивы заменены на типизированный Array.from, исходный error добавлен как cause;
  правила не отключались. [Лог](fixtures/koswork-xlsx-range/first-core-failure.log),
  исходник `/tmp/koswork-range-core.log`.
- После lint-исправления `pnpm check:core` завершён **exit 0**,
  `/tmp/koswork-range-core-final.log`: web **275 PASS** заново, API **952 PASS**
  из Turbo cache, DB 173, contracts 206, core 386, gateway 151, policy 43,
  config 17, tool runtime 64 PASS / 4 local OCI SKIP. Format/secrets/lint,
  app/Office/composer typecheck, build, root guards/privacy/profile PASS.
- Следующий общий прогон на коде после lint-fix: **63 PASS / 1 FAIL**,
  `/tmp/koswork-range-publish-browser.log`. Все Office-сценарии прошли.
  В принятом из main Work lost-create-ack тесте route.fetch/json получил
  Response has been disposed: trace показывает завершённые business assertions,
  затем активный model-runtime GET, Close context и timeout teardown.
  [Лог](fixtures/koswork-xlsx-range/work-fixture-teardown-failure.log), полный
  trace/error-context сохранены в `/tmp/koswork-range-work-fixture-failure`.
  В E2E-файл добавлен afterEach unrouteAll с behavior=wait: ожидание активных
  обработчиков до закрытия контекста, без ignoreErrors и без повторов запросов.
  Production Work/model-runtime код не менялся. После cleanup-барьера
  целевой Work-сценарий прошёл **10/10**, workers=1, retries=0, exit 0,
  `/tmp/koswork-range-work-fixture-stress.log`. Это исправление lifetime тестового
  перехватчика, не заявление об устранении всех возможных сетевых сбоев.
- На окончательном объединённом дереве после cleanup: **64/64 PASS**,
  workers=1, retries=0, exit 0, `/tmp/koswork-range-final-proof-browser.log`.
  Именно этот capture скопирован в result.json/source.xlsx/range.koswork.xlsx;
  выход совпал с использованными при рендере байтами.
- Финальный gate на том же объединённом дереве после cleanup: **exit 0**,
  `/tmp/koswork-range-core-publish.log`, web 275 PASS заново; API 952 PASS
  из cache, DB 173 и остальные перечисленные checks PASS.
- Native check: **386 PASS / 1 Windows-only SKIP / 0 FAIL**, 387 всего,
  `/tmp/koswork-range-native.log`, exit 0. Права/cancel/revoke и старые форматы
  проверяются прежним настоящим native-набором.

## Воспроизведение

Из корня checkout, с уже установленными зависимостями/Chromium:

```sh
pnpm --filter @cosmora/web exec vitest run src/app/office-range.test.ts src/app/studio-csv.test.ts
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  KOSWORK_RANGE_REPORT_DIR=/tmp/koswork-new-range-proof \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.office-composer.config.ts office-range.spec.ts
pnpm --filter @cosmora/web test:e2e:office-composer
pnpm --filter @cosmora/web typecheck
pnpm --dir desktop/windows check
pnpm check:core
git diff --check
```

Для capture нужен новый каталог: writeFile с `wx` не затирает доказательства.
Без KOSWORK_RANGE_REPORT_DIR тест сохраняет download/JSON/screenshot в Playwright
test-results. Build/gate и browser не запускать одновременно в одной `.next`.
Полный 64-прогон с принятыми Work progress сценариями:

```sh
(
set -e
proof_config=apps/web/playwright.koswork-range-proof.tmp.ts
test ! -e "$proof_config"
trap 'rm -f "$proof_config"' EXIT
cat > "$proof_config" <<'TS'
import { defineConfig } from "@playwright/test";
import base from "./playwright.office-composer.config";
export default defineConfig({ ...base, testMatch: [...(base.testMatch as string[]), "**/work-progress-refresh.spec.ts"] });
TS
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.koswork-range-proof.tmp.ts
)
```

## Файлы, интеграция, откат и пределы

Новые: `office-range.ts` (проверяемое преобразование и границы),
`office-range-editor.tsx` (контролы в прежней области), `office-range.test.ts`,
`e2e/office-range.spec.ts`, этот handoff и fixture artifacts. Общий parser
`studio-csv.ts` получил только export существующего parseWithDelimiter — отдельной
копии parser нет. Минимальный интеграционный коммит подключает компонент и общий
value converter в `office-document-workspace.tsx`, регистрирует E2E в
`playwright.office-composer.config.ts` и `tsconfig.office-e2e.json`.
В `work-progress-refresh.spec.ts` добавлен только барьер завершения route handlers
перед teardown, как описано в истории проверки.
Сайдбар, чат, палитра, типографические tokens и глобальные стили не менялись.

Применять source и integration commits вместе; отдельно неподключённые новые
файлы поставкой не являются. Откат — revert integration, затем source и docs,
не откатывая принятый main/Office plan isolation, не удаляя скачанные документы.
Source commit `444348c61c52c1666be338cb203a5c3c19337636`; integration
`615542dafba14ff260f897edada2afb3ec90921a`. Проверялось их объединённое дерево
`1e34a5e7a8364252335da9cade1db773608b7ae9`. Итоговый docs/artifact SHA и
внешние checks фиксируются в PR, без нового изменения source после проверки. Merge PR/deploy нет.

Диапазон прямоугольный, максимум 10 × 10; общий прежний план — 40 операций,
100 раскрытых изменений и 16 000 сериализованных UTF-8 байт. Новый лист тоже
занимает изменение. Preview diff ограничен прежними 10 000 байтами.
Больше/непрямоугольное/слишком длинное отклоняется целиком, без записи и обрезания.
Тип задаётся столбцу, отдельные исключения — существующей правкой ячейки.
Clipboard переносит значения, а не оформление и не отсутствующие в буфере
Excel-формулы. WYSIWYG, автоматическая правка верстки и вычисление формул не добавлены.
