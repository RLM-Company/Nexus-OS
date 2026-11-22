# Анализ файлов: карта проходов (этап 3)

Раздел взят по команде владельца «делаем все, что не делают другие» 20 ноября
2026: параллельные ветки ведут Koscode (#609), MCP (#610), Koswork (#611), а
чат/проекты (#612), интеграции-реестр (#603) и Koswork-сценарий (#606) уже
слиты мной. Блок «Анализ файлов» из «Инструкции 3 этапа» оставался не закрытым
никем — взят первым срезом.

Формат — по `STAGE_TWO_WORKFLOW_RU.md`. Границы `apps/web/UI_RULES.md`: сайдбар,
стартовый экран чата, логотип и стили не меняются без точечного запроса. Next.js
16.3.1 — гайд client components прочитан. Живые/plated вызовы, новые права и
MCP не вводились.

## Критерий инструкции

«Итог ссылается на файлы и страницы. Отчёт показывает покрытие, пропуски и
ошибки, включая частично обработанные пакеты».

## Что уже реализовано и покрыто (сверка, без изменения кода)

- ZIP с вложенными **путями** (папки → метки `a › report.txt`), 4 формата
  (pdf/docx/csv/txt), жёсткие лимиты и защита парсера `BoundedZip` (ZIP64,
  шифрование, symlinks, overlap, CRC, ratio) — `library-archive-import.ts`,
  `bounded-zip.ts`; тесты `library-archive-import.test.ts`, `library-upload-queue.test.ts`.
- OCR скан-PDF: пустой текстовый слой → lazy Tesseract (rus/eng), abort/watchdog,
  прогресс по страницам — `studio-files-library-client.ts:64-115`, `library-scan-ocr.ts`;
  e2e `document-library.spec.ts:75-148` (растровый PDF в ZIP, citation `scan.pdf, стр. 1`).
- Chunked-индексация до 3 000 страниц / 2 млн символов / 5 000 chunks, page+line
  fidelity, paged reads — `document-library.ts`, `document-library-store.ts`;
  API-тест 3 000-страничного PDF с последней citation `report.pdf, стр. 3000`
  (`document-library-api.test.ts:80-108`).
- Deep-анализ: 3-worker in-process fan-out, батчи 12 000 симв., map-reduce synthesis,
  строгая проверка citation — `document-answer-service.ts:98,360-498`;
  тест смешанного пакета из 3 файлов с coverage (`document-answer-http.test.ts:166-195`).
- Coverage/отчёт: `DocumentAnalysisCoverage` в `coverage_json` (per-file
  total/indexed/analyzed/failed), линии отчёта `answerCoverageLines`/`answerReportLines`
  (`studio-files-report.ts:59-145`, UI `studio-files-library.tsx:871-917`).
- Cancel/quiesce, неопределённый расход, нет авто-редиспатча после crash, in-place retry
  переиндексации — `document-answer-service.ts:500-519,207-214,348-357`.

## Срез 1 (реализован): вложенные ZIP и честный пропуск

Был разрыв: вложенный `.zip` внутри архива попадал под общий `skipped++` и
**молча** считался «пропущенным файлом» без явного сообщения; рекурсивного
раскрытия не было.

Изменено `apps/web/src/app/library-archive-import.ts`:

- рекурсивное раскрытие **ровно одного вложенного уровня** (`MAX_ARCHIVE_DEPTH=2`
  — внешний архив + вложенный), лимит `MAX_NESTED_ARCHIVES=8` против бомб;
- метка сохраняет breadcrumb: `outer › inner.zip › note.txt`;
- вложенный архив, превышающий глубину/лимит или повреждённый, **увеличивает
  `skipped`** и попадает в существующую UI-строку «Пропущено файлов в ZIP: N»
  — то есть пропуск честно виден владельцу, а не теряется молча;
- все исходные проверки `BoundedZip` (CRC, ratio, symlinks, ZIP64, overlap) сохранены.

Тесты `library-archive-import.test.ts`: 3 исходных + 2 новых (раскрытие вложенного
уровня с breadcrumb; третий уровень и битый архив честно считаются skipped).
Проверка: 5/5 ✅, eslint/tsc(apps/web)/Prettier ✅.

## Срез 2 (реализован): unit-покрытие отчёта о покрытии

`apps/web/src/app/studio-files-report.test.ts`: добавлены 3 теста на
`answerCoverageLines`/`answerReportLines` — отчёт показывает разобранные/ошибочные/
необработанные фрагменты, страницы с текстом из индекса (и явное «Всего страниц
неизвестно» вместо выдуманного числа), а также только процитированные источники
с страницей и строками. Это ровно критерий «отчёт показывает покрытие, пропуски
и ошибки, включая частично обработанные пакеты». Исходный DOCX-тест сохранён.
Проверка: 4/4 ✅, eslint/tsc(apps/web)/Prettier ✅.

## Срез 3 (реализован): явный повтор deep-запуска

Был разрыв: отменённый/failed deep-run терминален, `POST /answers/:id/retry`
отсутствовал, «повтор» означал только переиндексацию файла.

Изменено:

- `apps/api/src/document-answer-service.ts` — `retry(projectId, ownerId, id)`:
  только для deep-run (`coverage !== null`) в статусе `cancelled`/`failed`,
  owner/project boundary через `store.get`, отказ при активном deep-запуске
  владельца (`CONFLICT`), QUIESCED-ограничение. Создаёт **новый** run с тем же
  вопросом/файлами и fresh coverage (`phase: "reading"`, счётчики обнулены);
  старый run остаётся историей. Idempotency — через нативный `store.create`;
  неопределённый расход старого run не освобождается и не удваивается молча
  (бюджет ключуется по `run_id`).
- `apps/api/src/document-answer-routes.ts` — `POST /answers/:id/retry` → 202;
  ошибки маппятся существующим `err()` (404/409/422/423).
- `apps/api/test/document-answer-http.test.ts` — тест: gateway падает на первом
  вызове → run `failed` → retry → новый id, question/files сохранены, старый
  остаётся `failed`, новый завершается `done` с coverage `complete`;
  поисковый (не-deep) run отклоняется 422.

Проверка: document-answer HTTP+service 2 файла / **5 тестов** ✅,
eslint/tsc/Prettier ✅. Фикстура, без платных вызовов.

## Остальные разрывы (не тронуты, требуют отдельного объёма)

1. **Повтор deep-запуска** — закрыт срезом 3 (новый run). Осталось: явного UI
   кнопки повтора нет (endpoint есть); подтверждение расхода владельцем на
   повтор — отдельное продуктовое решение.
2. **Автораспределение работы** — фиксированный пул из 3 воркеров, без
   резюмируемого чекпоинта coverage и без DAG/очереди (Multi-Agent последним).
3. **Детальный отчёт** — coverage есть, но нет отдельного артефакта
   «coverage/gaps/errors»; ordinal-дыры прерывают отчёт `INCOMPLETE_COVERAGE`.
4. **Тестовые пробелы** — нет e2e на кнопку «Подробный анализ» и deep-отчёт,
   deep-cancel/quiesce, > 1 000-page deep run, abort OCR (unit coverage-отчёта
   закрыт срезом 2).

## Следующий открытый шаг

Согласовать со владельцем следующий срез — e2e на кнопку «Подробный анализ» и
видимый deep-отчёт либо отдельный артефакт coverage/gaps/errors: ordinal-дыры
сегодня прерывают отчёт `INCOMPLETE_COVERAGE` — перед кодом. Живые/plated
вызовы и выкладка остаются отдельными поручениями. UI-кнопка повтора deep-run
(endpoint уже есть) — тоже по отдельному точечному запросу.
