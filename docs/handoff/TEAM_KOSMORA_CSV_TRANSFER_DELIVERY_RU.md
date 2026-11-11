# Перенос CSV-выборки в целевой composer

9 ноября 2026, Москва. Ветка `developer/koswork-admission-reliability`, существующий
PR #479. Продолжение после Work head `e5b0aec4fc79a32222757f10752831a6d390a7b5`.
Main на старте пакета: `08f865f6362d3045438d6ca7f93be8e9e56e1e6c`.

## Что было и что работает

Существующий путь: область файлов → локальный CSV parser/filter →
«Подготовить выборку в чате» → onCompose → newChat → восстановление черновика →
pending effect → обычные draft/files и прежнее сохранение localStorage/native bridge.
Выборка не отправляет запрос модели автоматически.

Pending transfer содержал только prompt/files. Если native draft hydration задержать,
а затем ещё раз выбрать «Новый чат», старый transfer применялся к последующему чату:
вместо пустого composer появлялись прежние CSV prompt и attachment. Это воспроизведено
на production-сборке настоящего React-приложения, с fixture только на native bridge.

Теперь transfer создаётся после newChat и содержит destination epoch. Эффект
принимает его только при совпадении текущего epoch, scope и завершённой hydration.
Явная смена чата сбрасывает pending transfer. Старый render effect не может
забрать материал, предназначенный следующему scope. Это прежний ref, а не новое
хранилище/очередь. Парсер, лимиты, формат CSV, права и провайдер не меняются.
Компоновка чата, sidebar, стили и типографика не меняются.

## Источники, входы и реальные выходы

- `apps/web/src/app/page.tsx`: минимальная интеграция, отдельный коммит.
- `apps/web/e2e/csv-composer-transfer.spec.ts`: настоящий web transfer/reload,
  delayed native hydration и отмена вторым new chat. Model POST наблюдаются отдельно.
- `apps/web/playwright.csv-transfer.config.ts`: production-набор из 13 сценариев,
  workers=1/retries=0; исходные studio-files tests сохранены.
- `apps/web/tsconfig.csv-e2e.json`: явный typecheck новых e2e и конфигурации.
- `docs/handoff/fixtures/kosmora-csv-transfer/input.json`: синтетический CSV с
  двумя строками, multiline cell, `00123`, `19 700`, датой и «кроме доставки».
- `result.json` и `selection.csv` рядом: реальный сохранённый/restored материал,
  prompt, SHA256 выбранных байтов/источника, reload и отсутствие model POST.
- `failure-evidence.json`: фактическая ошибка до fix и выдержка невалидного
  прогона с пересечением сборки; ошибки не заменяются успешным повтором.

## Запуск

```sh
# Сборка и browser tests последовательно; отдельная temporary SQLite, mock provider:
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test -c playwright.csv-transfer.config.ts
pnpm --filter @cosmora/web exec tsc -p tsconfig.csv-e2e.json
pnpm check:core
```

Для получения JSON в отдельный каталог добавить `KOSMORA_CSV_REPORT_DIR=/tmp/csv-new`.
Каталог отчёта должен быть новым (`wx`). Playwright также прикладывает настоящие
CSV и JSON к результатам web-сценария. Для установленного Playwright Chromium
executable path можно не задавать. Не запускать next build параллельно с браузерным
стендом, использующим ту же .next. Обычная конфигурация сама собирает и запускает web.

## Фактические проверки и история

- Предыдущий CI #1669 имел CSV flaky: после prepare textarea осталась пустой,
  первая попытка истекла по timeout; встроенный retry прошёл. Это сохранено в PR.
- Локальный исходный CSV-тест до fix: **30/30 PASS**, retries=0. Тот CI-timeout
  не воспроизведён; его точная причина этим пакетом не доказана.
- Новый controlled-scope сценарий на исходной production-сборке:
  **1 FAIL / 2 PASS**, retries=0. Failed assertion: после второго new chat
  ожидался пустой composer, получен прежний CSV prompt. Нормальный browser transfer
  и delayed hydration в целевом scope уже проходили.
- После fix production-набор: **13/13 PASS**, retries=0, 45,1 с.
- Общий `pnpm check:core`: **exit 0**, API **934 PASS** (84 Manager Work),
  web 263 PASS; остальные package tests, lint/typecheck/build, root guards,
  privacy/profile — PASS. 4 OCI локально skipped; не называются PASS.
- Дополнительная повторная серия была ошибочно совмещена исполнителем с общей
  сборкой той же .next: **29 PASS / 1 FAIL**, retries=0. Последний тест не увидел
  даже форму загрузки CSV. В inspected trace — **16 HTTP 500** на Next JS/CSS assets.
  Этот прогон не считается изолированным доказательством поведения продукта.
  Логовая выдержка сохранена; исходный trace затем был удалён Playwright при
  повторном использовании output directory. `original_trace_retained=false`
  явно отмечено в failure-evidence; не заявляем сохранность полного trace.
- После завершения сборки та же серия выполнена последовательно:
  **30/30 PASS**, retries=0, 1,4 мин. Невалидный первый результат оставлен в истории.
- После добавления побайтного readback restored attachment и сохранения CSV
  все три новых сценария повторно прошли **3/3 PASS**, retries=0, 10,2 с,
  на уже собранной production-версии, без одновременного build. Новый report
  и CSV скопированы именно из этого прогона; исходные fixtures не менялись.
- Независимая проверка Python: SHA256 исходника и selection.csv совпали с report,
  полный CSV совпал с expected selection, включая multiline cell и все литералы.
- Scoped e2e typecheck: exit 0. Финальные format, secret scan и diff — PASS
  после добавления этого handoff.

Локальные логи: `/tmp/koswork-csv-transfer-before.log`,
`/tmp/koswork-csv-native-before.log`, `/tmp/koswork-csv-after.log`,
`/tmp/koswork-csv-check-core.log`, `/tmp/koswork-csv-repeat-after.log`,
`/tmp/koswork-csv-repeat-serial.log`, `/tmp/koswork-csv-verified.log`.
Точные SHA и внешние checks последнего head фиксируются в PR, без переноса
статуса старого head на новый.

## Коммиты

- `c4ad88ed564e480237750171ee91517c521f6dda`: regressions, input fixture,
  отдельная Playwright-конфигурация и scoped tsconfig.
- `4359fa252c5731ad075a6922145a47f1451c3276`: отдельный минимальный
  source integration commit page.tsx — 15 добавленных строк, 4 удалённых.

## Границы и интеграция

Реальный HY4 не вызывался. Native bridge в двух browser-сценариях — fixture;
это не Windows IPC/дисковая приёмка native draft store или ПК владельца.
Первый web-сценарий реально читает выбранный CSV, фильтрует, сохраняет text/files
в существующем localStorage и повторно читает их после reload. Числа, leading zeros,
дата, условие и multiline cell проверяются по полному CSV, не только имени вложения.

Точный исходный intermittent CI-timeout не воспроизведён в 30 исходных локальных
прогонах. Этот пакет закрывает доказанный дефект отменённого transfer; не объявляем
все причины CSV flakiness устранёнными. Новых модельных инструментов, маршрутов,
миграций, лимитов, provider routes или прав нет. Владельцем не выбирался новый
раздел продукта: это техническое исправление уже существующего переноса материалов.

PR #478 и Office #466 сохраняют свои отдельные проверенные heads. Этот новый
scope fix поставляется PR #479 поверх Work fix; перед общей интеграцией объединять
Git ancestry, не перетирать page.tsx из старой ветки. Все общие изменения минимальны.
При откате — вернуть только source integration diff этого transfer, сохранив
прежние Work accounting/admission исправления. Черновики/CSV/ledger rows не удалять:
схема хранения не менялась. Исполнитель не выполняет merge PR/deploy.

## Синхронизация после обновления main

После публикации head `e31b509b6b5466f2014988b178b71f0747d0afdb` main обновился
до `f3799c8a65f5b7ccab1e1d9e6a9440f95ea9632a` (принят PR #477). Прежний
предел очереди и все новые admission/usage/CSV исправления сохранены.
Синхронизация рабочей ветки — `faa25bc029ac5328da0835de0397ffd29f3fb727`,
с родителями e31b509 и f3799c8; это не merge PR в main и не deploy.

Исходники совместились автоматически. Единственный конфликт — добавленные
в конец `docs/product/RUFLO_ADOPTION_SCOPE_RU.md` разделы: оставлены оба блока.
SQL-фильтр очереди, DB tests и queue handoff побайтно совпадают с новым main;
upstream Manager Work regression сохранена в общем test file. Других
изменений реализации при синхронизации нет.

На совместном дереве повторно выполнено:

- `pnpm check:core` — **exit 0**, **935 API PASS** (85 Manager Work),
  **166 DB PASS**, web 263 и остальные package tests/lint/typecheck/build/
  root guards/privacy/profile — PASS; 4 OCI локально skipped.
- После завершения build production CSV/Studio-набор отдельно — **13/13 PASS**,
  retries=0, 26,0 с. Использована уже собранная production .next и отдельная
  temporary API SQLite. Одновременных сборок не было.
- Report после этой синхронизации побайтно совпал с сохранённым result.json;
  выбранный CSV совпал с selection.csv. Scope/cancel regressions прошли.

Внешний CI предшествующего e31b509: CI #1670 и API identity #94 — success,
но browser не чистый: **381 PASS + 1 flaky**. Новый CSV и прежний CSV-сценарий
прошли без retry; flaky был в `document-upload-queue.spec.ts:138` —
`route.fetch: socket hang up` при имитации потерянного POST response, затем
первичная проверка uncertain row не нашла запись. Автоматический retry прошёл.
Эта ошибка не объявляется исправленной CSV scope patch или синхронизацией main.
Workflow вручную не повторялся. Окончательные checks нового joint SHA — в PR.

Сырые новые логи: `/tmp/koswork-csv-main-sync-core.log`,
`/tmp/koswork-csv-main-sync-browser.log`. При откате не откатывать весь merge
с уже принятым исправлением #477: откат CSV относится только к source diff
4359fa2; данные/схема/правила quota и privacy остаются прежними.
