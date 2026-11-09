# Совместная поставка Office, composer и Work reliability

9 ноября 2026, Москва. Ветка: `developer/koswork-office-workspace`, PR #466.
Предыдущий Office head: `65d714be439ba1fea93ff92b9947123975e80781`.
Сохранённый main: `08f865f6362d3045438d6ca7f93be8e9e56e1e6c`.

## Состав и действующий путь

Office и composer уже проверялись вместе, а последние startup/usage исправления
Work находились в отдельном PR #479. Теперь его проверенный head
`0a26359969086eaae30cf28a3b040eca8efdc003` входит в Office-ветку.
Git совместил все девять пришедших файлов автоматически, без ручных конфликтов.

- DOCX/XLSX/PPTX используют прежний путь открытия, адресуемых правок, preview,
  отдельного подтверждения, новой копии, SHA256/version/readback. Оригинал сохраняется;
  неподдержанные объекты, stale version, отмена и отзыв доступа отклоняются.
- Composer сохраняет текст/вложения и защищает новый черновик от поздних ответов.
- Work регистрирует занятый слот до startup callbacks; privacy/shutdown ожидают
  settlement. Предел остаётся 1 Work на процесс.
- Принятый provider completion учитывается до отказа в пустом содержимом.
  Work остаётся failed без файла/автоповтора. Null usage сохраняет консервативный
  учёт; тарифы, лимиты и права прежние.

Это совмещение существующих реализаций. Нового чата, исполнителя, API, хранилища,
маршрутов, миграций или зависимостей нет. Дизайн/контролы не менялись.
Коммиты PR #478 и #479 уже входят в этот head: повторно накладывать их файлы не нужно.
Оба отдельных PR остаются для обзора своих изменений; main исполнителем не изменялся.

## Интеграционные файлы и коммиты

- `56418cba035c54fe28ea61d5462113e1d3c46cfa`: merge Work reliability в Office,
  родители — прежний Office и проверенный PR #479. Общая логика скопирована из
  уже проверенной ветки без переписывания; Windows main/installer/browser/** сохранены.
- `87f25efa484dcca413f05b2ce9ff427851f50858`:
  `apps/web/e2e/office-composer-integration.spec.ts` — общий пользовательский сценарий.
- `3fc161ba342af8be10724902662e72651f3f2778`: минимальная регистрация сценария в
  `playwright.office-composer.config.ts` и `tsconfig.office-e2e.json`.
- `c39917f2d5cbf72643c895e819c1c09246d0c342`: сохранение настоящего browser download
  и readback в `docs/handoff/fixtures/koswork-full-integration`.

## Новый сквозной сценарий и артефакты

В одной browser context: набрать сообщение с точными пробелами/переносом, приложить
brief.txt → открыть область файлов → выбрать исходный DOCX → заменить «Компания А»
на «Компания Б» по paragraph:3 → preview → отдельное подтверждение → скачать копию
→ сравнить bytes/receipt SHA256 и обе версии → вернуться к composer → reload →
проверить точный текст/вложение и его SHA256. Наблюдаемых browser model POST — 0.

Входы остаются прежними:

- `docs/handoff/fixtures/koswork-office/offer.docx`;
- `docs/handoff/fixtures/kosmora-composer/input.json`.

Выходы этого прогона:

- `docs/handoff/fixtures/koswork-full-integration/offer.koswork.docx` — **скачанный
  браузером файл**, не пересозданная позднее имитация;
- `docs/handoff/fixtures/koswork-full-integration/result.json` — реальные source/new
  version, SHA256, извлечённый Office-текст, восстановленные message/file и счётчик POST.

SHA256 новой копии:
`dec2527a43b56061ff2a39909bae34564b66c9eec4ec38da27ac43af2e81891b`.
Байты совпали с backend receipt и его base64; source version соответствует
исходным байтам, а сам исходник не изменился. Отдельная проверка ZIP CRC прошла.
По реальному XML и readback проверены «Компания Б», `19 700`, `00123`,
`07.11.2026` и «кроме доставки». Текст черновика и файл совпали со входом побайтно
в их UTF-8 представлении. Preview tokens и внутренние пути в report не сохранялись.

## Выполненные проверки и команды

```sh
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web test:e2e:office-composer
pnpm --filter @cosmora/web typecheck
pnpm --dir desktop/windows check
pnpm check:core
```

Сценарий сам сохраняет JSON и DOCX в Playwright test-results. Для установленного
Playwright browser переменную executable path можно не задавать. Backend стенда
использует временную SQLite и MODEL_PROVIDER=mock, существующий сервер не переиспользуется.

- Совместный production web + API fixture набор: **35/35 PASS**, retries=0,
  1 worker, 3,0 минуты: 25 composer, 9 Office, 1 общий сценарий.
- После добавления сохранения бинарного артефакта общий сценарий отдельно прошёл
  **1/1 PASS**, 7,4 секунды, на production-сборке полного gate; его assertions
  сохранены. Scoped E2E typecheck после добавления artifact attach: exit 0.
- Полный `pnpm check:core`: **exit 0**. API: **938 PASS**, включая 78 Manager Work;
  web: 266; contracts: 206; core: 386; db: 160; model-gateway: 151;
  policy-engine: 43; config: 17; tool-runtime: 64 PASS/4 OCI skipped.
  Format, secrets, lint/typecheck, package tests, корневые guards, builds и
  privacy/profile fixture smoke прошли. Локальные OCI skipped не называются PASS.
- Native desktop check: **382 PASS, 1 Windows-only skipped, 0 FAIL** в Linux.
- API build выполнялся заново, cache miss; скомпилированный coordinator содержит
  оба Work исправления. Все семь Office runtime assets в dist побайтно совпали
  с canonical workspace sources.
- Report и бинарник отдельно перепроверены: версии/хеши, source preservation,
  ZIP CRC, точный draft/file, нулевые browser model POST — PASS.

Один дополнительный capture-run первоначально не стартовал: временная конфигурация
в /tmp оставляла неявный cwd, и pnpm искал /api (ENOENT). Тесты в нём не исполнялись.
После явного cwd обоих webServer capture-run прошёл; исходный failed log сохранён.
Основной 35-сценарный прогон не повторялся для скрытия ошибок и прошёл с первого раза.
Временная capture-конфигурация не является исходником продукта и в поставку не входит;
обычная команда выше собирает и запускает весь набор в корректном repo cwd.

## Границы, интеграция и откат

Настоящий HY4/другая модель не вызывались, provider заменён локальными fixtures.
Новая копия проверена по bytes/ZIP/XML/readback и отдельно открыта/отрендерена
на облачном LibreOffice-стенде, как описано ниже. `visual_render_verified=false`
в исходном browser result остаётся историческим результатом того прогона:
сам engine рендер не выполняет. Microsoft Office, ПК владельца и production
не использовались. Формулы engine не вычисляет, WYSIWYG не добавлялся;
сложные объекты/подписанные пакеты сохраняют прежний отказ до записи.

Для интеграции достаточно текущего PR #466; его точный опубликованный SHA и внешние
checks зафиксированы в описании PR. Самостоятельного merge PR/deploy не было.
При откате feature-интеграции до принятия можно использовать прежний Office head
65d714b; после принятия нельзя слепо откатывать весь merge вместе с уже принятыми
исправлениями соседних пакетов. Точечный откат Office/Work описан в их handoff:
он не требует удаления документов или accounting rows и не меняет схему данных.

## Дополнительная проверка открытия итоговой DOCX-копии

9 ноября 2026 года на отдельном облачном fixture-стенде уже установленный
LibreOfficeDev 26.8.0.0.alpha0 (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`)
открыл именно `offer.koswork.docx`, скачанный общим browser-сценарием на source
commit `92179395ecb4598171eb49da0edbdf6c90a633c2`. Новые программы не устанавливались.

```sh
# Из корня checkout; использовать новый отдельный профиль и каталог вывода:
mkdir -p /tmp/koswork-final-render
soffice -env:UserInstallation=file:///tmp/koswork-final-render-profile \
  --headless --convert-to pdf --outdir /tmp/koswork-final-render \
  docs/handoff/fixtures/koswork-full-integration/offer.koswork.docx
pdftotext -layout /tmp/koswork-final-render/offer.koswork.pdf -
pdftoppm -f 1 -singlefile -scale-to 1400 -png \
  /tmp/koswork-final-render/offer.koswork.pdf /tmp/koswork-final-render/page-1
```

В `fixtures/koswork-full-integration/render/` сохранены настоящий PDF,
изображение единственной страницы и `result.json` с командой, версией renderer,
выводом, хешами до/после и извлечённым PDF-текстом. Export и pdftotext — exit 0.
Предупреждения `Fontconfig error: No writable cache directories` сохранены в JSON;
PDF при этом создан. SHA256 DOCX до/после совпал с receipt:
`dec2527a43b56061ff2a39909bae34564b66c9eec4ec38da27ac43af2e81891b`.
SHA256 PDF: `44f3310793311fda463dfbf41fc8592cc02cc3ac3cfd78148ca6626e5a1fbed7`.

«Компания Б», `19 700`, `00123`, `07.11.2026`, «кроме доставки» присутствуют
в PDF-тексте и видимы на просмотренной странице. Реквизиты и строка таблицы
читаемы, обрезания в этом документе не обнаружены. Это проверка конкретной
копии в LibreOffice, а не гарантия полной совместимости всех Office-документов.

Результаты внешних checks source commit 9217939: CI #1667 и API identity #91 —
success, browser — 401 PASS. Windows #226: две попытки завершились HTTP 504
при упаковке; в каждой native tests 383 PASS, 0 FAIL/skipped. В логе отсутствует
URL неудачного запроса, поэтому точный недоступный ресурс не установлен.
Installer lifecycle не подтверждён. Исходники Windows main/installer/CI не
менялись ради обхода сбоя; слепых повторов после второй ошибки не выполнялось.
Актуальные checks следующего документационного коммита смотреть отдельно в PR;
результаты source commit не выдаются за проверки нового SHA.

Этот дополнительный коммит содержит только handoff и render artifacts.
Логика приложения, тестовые assertions и исходный DOCX не меняются; откат
дополнения не затрагивает файлы пользователя, схему или provider accounting.
