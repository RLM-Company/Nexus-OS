# Восстановление загрузки: проверяемая потеря ответа

9 ноября 2026. Ветка `developer/koswork-office-workspace`,
[PR #466](https://github.com/RLM-Company/Nexus-OS/pull/466).
Начальный Office SHA: `e6a844f7052213c6d4f3c5f6a1e0ac23c39bca9a`.
Актуальный main при начале продолжения:
`e4464eac543038da02541aff90ec1b130e986f25` (после PR #484).
Перед публикацией main продвинулся до
`8da32e0507bcf8a8030f59b02dba5f86e4797995` (PR #486); сохранены также
видимые GET polling и отмена чтений. Оба main-изменения сохранены merge-коммитом
ветки; PR в main не сливался, deploy не выполнялся.

## Что было и что изменено

В прошлой CI-проверке #1670 у сценария потерянного ответа загрузки был
`route.fetch: socket hang up`, после чего браузер не увидел ожидаемый uncertain.
Прежняя fixture вызывала `route.fetch()` через Next rewrite и лишь затем
`route.abort()`: исключение forwarding оставляло исходный route незавершённым.
Она также не проверяла сохранение оригинала до потери ответа. Исходный socket
hang up здесь не воспроизведён: базовый прогон старого сценария прошёл 20/20.
Причина исходного сетевого сбоя остаётся неподтверждённой.

Изменена именно E2E-инъекция сбоя. Она отправляет перехваченный POST один раз
в настоящий fixture API на loopback, требует 201, проверяет сохранённые байты
оригинала и затем теряет браузерный ответ. `finally` завершает route даже при
ошибке forwarding; ошибка не подавляется. POST не повторяется, redirects и
transport retries выключены. Второй файл идёт обычным браузерным путём через
Next → API. Подготовка использует существующее создание пустого проекта без
модельного запроса. UI, production proxy, upload queue, storage, права, HY4,
тарифы и квоты этим изменением не меняются.

Пользовательский путь: область файлов → выбрать два файла → первая загрузка
показывает uncertain, следующая завершается → вручную повторить обработку
сохранённого оригинала → оба файла ready. Проверяются прежние ID, ровно два
upload POST на два файла, отсутствие модельных POST/сообщений проекта,
реальные characters/chunks и повторное скачивание обоих оригиналов.

## Входы и полученный результат

[input.json](fixtures/koswork-upload-recovery/input.json) содержит синтетические
входы. [result.json](fixtures/koswork-upload-recovery/result.json) получен из
общего production E2E-прогона 52 сценариев. Файлы в
[output](fixtures/koswork-upload-recovery/output/) скачаны настоящим API после
ручной повторной индексации; это сохранённые байты тестового результата.

| Файл                | Bytes / characters / chunks | SHA256                                                             |
| ------------------- | --------------------------- | ------------------------------------------------------------------ |
| ответ-потерялся.txt | 133 / 84 / 1                | `8f3b7007e6a3bb75fe3b6e24e1c5197a9f08f0614854c86bc6f06a41d78271b9` |
| следующий.txt       | 80 / 43 / 1                 | `00766b02bfed9574a3509034f3dcd0c64bf110d4581f595767a0ae0545384e57` |

Содержимое с `19 700`, `00123`, `07.11.2026`, `кроме доставки` и обязательным
условием совпало с входом по байтам и hash. Первый ID до потери ответа и после
индексации совпадает; точное значение записано в `stored_before_response_loss`
результата. Модель не вызывалась.
Это реальные чтение, сохранение и индексация fixture-файлов существующим API.

## Файлы и воспроизведение

- `apps/web/e2e/document-upload-queue.spec.ts`: завершение route, проверка commit,
  сохранённых байтов, ID, статусов, числа POST; вложения результата Playwright.
- `apps/web/playwright.document-upload.config.ts`: отдельный набор без retry.
- `apps/web/playwright.office-composer.config.ts`: четыре upload-сценария включены
  в общий набор Office/composer/CSV/Studio, теперь 52 теста.
- `apps/web/tsconfig.office-e2e.json`: новые E2E-файлы включены в typecheck.
- Этот handoff, ссылка в общем handoff и каталог fixtures с входами/выходами.

Из корня репозитория, с уже установленными зависимостями и Chromium:

```sh
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  KOSWORK_UPLOAD_REPORT_DIR=/tmp/koswork-upload-result \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.document-upload.config.ts

KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test --config=playwright.document-upload.config.ts \
  --grep 'a lost POST response' --repeat-each=20 --workers=2

KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web test:e2e:office-composer
pnpm --filter @cosmora/web exec tsc -p tsconfig.office-e2e.json
pnpm check:core
git diff --check
```

Для нового capture нужен новый пустой `KOSWORK_UPLOAD_REPORT_DIR`: `result.json`
создаётся с `wx`, чтобы случайно не затереть доказательство. При повторениях
эту переменную не задавать. Playwright сам запускает fixture API и web server.
Не запускать Next build одновременно с браузерным сервером на той же `.next`.

## Фактические проверки

- Прежний lost-response сценарий: 20/20 PASS, workers=2, retries=0;
  `/tmp/koswork-upload-before.log`. Это baseline, а не воспроизведение старого сбоя.
- После изменения fixture: 4/4 PASS, затем lost-upload 20/20 PASS,
  workers=2, retries=0; `/tmp/koswork-upload-after.log`,
  `/tmp/koswork-upload-stress.log`.
- Окончательный общий production набор: 52/52 PASS, workers=1, retries=0,
  `/tmp/koswork-upload-joint-browser.log`. Включены Office, черновики, CSV,
  Studio и загрузки (ошибка PDF, отмена, ручное восстановление).
- Scoped E2E typecheck PASS. Общий gate завершил проверки, build, lint и
  финальный profile fixture smoke; исходный лог `/tmp/koswork-upload-core.log`.
  API tests использовали Turbo cache: 952 PASS в сохранённом результате;
  web tests выполнялись заново: 266 PASS. DB 173 PASS, contracts 206,
  core 386, gateway 151, policy 43, config 17; tool runtime 64 PASS,
  4 локальных OCI проверки SKIP. Для явной фиксации кода выхода gate после
  потери process handle выполнен повтор: exit 0,
  `/tmp/koswork-upload-core-final.log`. После этого включён main #486;
  его окончательные проверки приводятся ниже и в PR.
- После включения main #486 общий набор повторён: 52/52 PASS, retries=0,
  `/tmp/koswork-upload-main-final-browser.log`; именно этот capture сохранён
  в `result.json` и `output/`.
- Отдельный первый запуск Work progress не дошёл до браузера: production
  server ожидался на 3347 при default-порте 3000. Запуск с локальным adapter
  сначала остановился из-за ещё занятого fixture-порта 3346. Оба завершились
  exit 1 и сохранены в `/tmp/koswork-upload-work-progress.log` и
  `/tmp/koswork-upload-work-progress-final.log`. После остановки только своих
  fixture-процессов и проверки свободных портов запущен последовательный
  прогон с `PORT=3347` и `/usr/bin/chromium`; исходная общая конфигурация
  не менялась. Последовательный production прогон: **5/5 PASS**, retries=0,
  `/tmp/koswork-upload-work-progress-serial.log`, exit 0. Проверки скрытой
  вкладки входят в эти сценарии принятого main.
- Окончательный `pnpm check:core` после включения main #486: **exit 0**,
  `/tmp/koswork-upload-main-final-core.log`. Web tests выполнены заново:
  **270 PASS** (включая 4 visible-read-poller); API cache: **952 PASS**,
  DB 173 и остальные перечисленные package checks сохранены.
  Format/secrets/lint/typecheck/build/root guards/privacy/profile PASS.
- Diff и независимое сравнение входов/скачанных выходов PASS перед публикацией. Деревья GitHub source-коммитов
  совпадают с локальным проверенным staged tree.
  Новых native изменений нет; прежние Linux 382+1 Windows-only skip и Windows
  383 PASS относятся к Office e6a844, новый native прогон здесь не заявляется.

## Интеграция, откат и границы

Миграций, новых production contracts/маршрутов нет. Регистрация тестов вынесена
в отдельный интеграционный коммит. Применять последовательность коммитов PR;
принятый main Work progress оставлять. Для отката только этого продолжения
отменить fixture/регистрацию/документацию, не удаляя пользовательские документы
и не откатывая принятый main. Точное дерево и итоговый SHA публикуются в PR.

Инъекция доказывает восстановление после подтверждённого backend commit и
потери ответа. Она не доказывает устранение причины прежнего socket hang up
в production proxy. Настоящий HY4, владелец/его файлы и production не использованы.
Первый format check нового handoff нашёл расхождение Markdown; файл
отформатирован Prettier, этот сбой не скрывается. Новое открытие Office в MS Office/на ПК владельца не проверялось; прежний
отдельный Linux DOCX render остаётся описан в общем handoff.
