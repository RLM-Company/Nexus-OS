# Текущее дополнение: восстановление Office-плана после перезагрузки

10 ноября 2026. Явное сохранение/восстановление/удаление локального черновика
подключено к прежнему Office editor. Тот же исходник и SHA256-версия обязательны;
preview и подтверждение не сохраняются. Устаревшие действия вкладок отклоняются,
байты документа/права на папку не сохраняются и не расширяются. Полная поставка,
реальные выходы, проверки, ограничения и откат:
[TEAM_KOSWORK_OFFICE_DRAFT_DELIVERY_RU.md](TEAM_KOSWORK_OFFICE_DRAFT_DELIVERY_RU.md).

История предыдущих поставок ниже сохранена; её результаты относятся к своим SHA.

# Итоговая интеграция рабочих документов Koswork

Продолжение 10 ноября: изменение/удаление отдельной правки, смешанные типы ячеек
при правке диапазона, зависимости новых листов, изолированный черновик и сброс
прежнего preview/download после правок. Сохранён main
`5e14b6bb761c4903b49471b75f5eb7e138befb52`. Итоговые локальные проверки:
70/70 browser без retry, native 395 PASS / 1 Windows-only SKIP,
`pnpm check:core` exit 0 (281 web PASS, API 952 PASS из cache).
Реальные входы/выходы DOCX/XLSX/PPTX, PDF, команды и откат —
[Office plan editor handoff](TEAM_KOSWORK_OFFICE_PLAN_EDITOR_DELIVERY_RU.md).

Продолжение 10 ноября: редактирование и удаление отдельных операций Office,
изолированный черновик, dependency-safe удаление новых листов и сброс старого
preview/download. Сохранён main `5e14b6bb761c4903b49471b75f5eb7e138befb52`.
Итоговые локальные проверки: 70/70 browser без retry, 395 native PASS +
1 Windows-only SKIP, `pnpm check:core` exit 0 (281 web, API 952 из cache).
Входы/выходы трёх форматов, PDF, команды и границы —
[Office plan editor handoff](TEAM_KOSWORK_OFFICE_PLAN_EDITOR_DELIVERY_RU.md).

Продолжение 10 ноября: диапазоны XLSX подключены к существующей панели файлов —
вставка таблицы, явные типы столбцов, общий план, preview, подтверждение и
проверенная новая копия. Реальные XLSX/PDF/readback и история проверок —
[XLSX ranges handoff](TEAM_KOSWORK_XLSX_RANGES_DELIVERY_RU.md).
Нет нового хранилища, исполнителя, API/tools или глобального дизайна.
Итоговые локальные проверки этого продолжения: 64/64 browser без retry,
Work fixture stress 10/10, native 386 PASS / 1 Windows-only SKIP,
`pnpm check:core` exit 0 (275 web PASS, API 952 PASS из cache).

Продолжение 10 ноября: устранён aliasing внутреннего native Office-плана с
возвращённым preview и вложенными объектами входных операций. До исправления
четыре реальные проверки упали; после него сохраняются согласованные путь,
diff и формула. Новый main `9a7ffec6846b1a02f041f2c69ea9a726fdff49fd`
сохранён. Итоговые локальные проверки: 59/59 browser без retry, native
386 PASS / 1 Windows-only SKIP, scoped typecheck и `pnpm check:core` exit 0.
Входы, выходы, red-log и команды —
[Office plan isolation handoff](TEAM_KOSWORK_OFFICE_PLAN_ISOLATION_DELIVERY_RU.md).
Ниже сохранена история предыдущих проверенных снимков.

Продолжение 9 ноября: сохранён main `8da32e0507bcf8a8030f59b02dba5f86e4797995`
после PR #486 (включая #484), усилена E2E-инъекция потери ответа загрузки. Общий production
набор расширен до **52/52 PASS без retry**, сохранены реальные скачанные байты
и проверка восстановления того же ID без повторного upload POST.
Отдельные принятые Work progress сценарии: 5/5 PASS; финальный
`pnpm check:core` exit 0 (270 web PASS; API 952 PASS из Turbo cache).
Подробности, команды и границы —
[upload recovery handoff](TEAM_KOSWORK_UPLOAD_RECOVERY_DELIVERY_RU.md).
Описанные ниже 48 тестов и e6a844 относятся к предыдущему проверенному снимку;
его результаты и история ошибок сохранены.

9 ноября 2026, Москва. Ветка `developer/koswork-office-workspace`, PR #466.
Предыдущий проверенный Office head: `c3431b31621025d39af9bd055b3d1a6c9b0531b9`.
Актуальный main при начале этой интеграции:
`7bb246bef2ed8e9f47ae93260384e560a9d6065c` (после PR #483).
Контрольная база исходного плана: `338536ee5946f96dcd18768143cc41af998c476a`.

## Что объединено и действующий пользовательский путь

Office уже открывал DOCX/XLSX/PPTX, применял адресуемые операции через preview и
отдельное подтверждение, сохранял новую копию с версиями/SHA256/readback.
В composer уже были исправления сохранения текста/вложений и поздних ответов.
Последние Work accounting и отмена CSV transfer оставались в отдельном PR #479.
Теперь их точный проверенный head `9d2b1f3692034a3c0132fbf7a54bf5d58c813803`
входит в эту Office-поставку вместе с composer head
`c69fc86efb360960c971e2357577641b3ed2b1f6` и указанным новым main.

- Область файлов → открыть разрешённый Office → прочитать адресуемое содержимое →
  подготовить правки → увидеть diff → отдельно подтвердить → новая копия →
  скачать и повторно прочитать. Источник сохранён, bytes/version/hash проверяются.
- DOCX: абзацы, таблицы/ячейки и точная замена между runs; XLSX: листы,
  типизированные ячейки/диапазоны и формулы без вычисления; PPTX: существующий
  текст выбранного слайда/placeholder. Нетронутые элементы/медиа сохраняются.
- Stale version, отмена/отзыв папки и неподдержанные объекты останавливают запись.
  ZIP/XML/CRC, ограничения размеров и file grants сохранены. Новые агентские
  Office tools доступны только после capability negotiation.
- Возврат в composer/reload сохраняет точный текст и attachment bytes. Pending
  CSV transfer связан с destination epoch; второй «Новый чат» отменяет его,
  поздняя hydration не заполняет следующий чат прежним материалом.
- Work занимает существующий слот до startup callbacks; privacy/shutdown ждут
  settlement. Проверенный completion usage учитывается до закрытия транспорта,
  включая пустой ответ и последующую ошибку. Work при ошибке остаётся failed,
  файл не публикуется, автоповтора нет. Null usage не превращается в ноль.
- Из main сохранены принятые фильтр очереди, byte-verified индивидуальные
  скачивания Work и проверка полноты export sets. Их не заменяем старым store.

В этой интеграции нет нового чата, исполнителя, журнала денег, хранилища,
миграций, модельных маршрутов или прав. UI layout, sidebar, branding, typography
и styles не менялись. Устройство модуля и полный первоначальный перечень файлов —
[Office handoff](TEAM_KOSWORK_OFFICE_WORKSPACE_DELIVERY_RU.md).

## Коммиты и разрешение коллизий

- `4c9c9a01b997f12e226f86419b0ebfa63e0b1e03`: branch integration Office +
  проверенный Work/CSV head 9d2b1f3. Единственный конфликт — соседние ref types
  в page.tsx. Сохранены **оба** изменения: pending epoch и accepted revision/files.
- `736a04fa1cff396b4f76c75aee18cddaf436227a`: branch integration нового main.
  В model-runtime test принят более строгий вариант main: expiry и expiry+1
  отклоняются до вызова secret resolver. Production registry/expiry не менялись.
- `ca8f23d5b226e43bdf371f704023f6e5857e36ae`: отдельная минимальная регистрация
  CSV и Studio-files в `apps/web/playwright.office-composer.config.ts`.

Это коммиты рабочей ветки; PR в main исполнителем не сливались, deploy не было.
Коммиты точных heads PR #478 и #479 уже входят в эту цепочку. Не нужно повторно
копировать их файлы или накладывать поверх неё старые snapshots.

Основные пришедшие файлы: `manager-work-coordinator.ts`, его tests и Work/CSV
handoff/fixtures; минимальный scope fix page.tsx; отдельные CSV Playwright config,
scoped tsconfig и e2e. Из main пришли `manager-work-routes.ts`, `work-dag-routes.ts`,
`work-runtime-routes.ts`, `work-results-archive.ts`, `manager-work-store.ts`,
`work-runtime-store.ts`, их tests и handoff. Новая конфликтная логика поверх них
не добавлялась. Полный diff для обзора:

```sh
git diff --stat c3431b31621025d39af9bd055b3d1a6c9b0531b9...HEAD
git diff c3431b31621025d39af9bd055b3d1a6c9b0531b9...HEAD -- apps/web/src/app/page.tsx
```

## Сквозная приёмка и реальные артефакты

В одной browser context: текст с точными пробелами/переносом + brief.txt → область
файлов → исходный DOCX → «Компания А» на «Компания Б» по paragraph:3 → preview →
отдельное подтверждение → настоящий download → bytes/receipt/source/new version/SHA
→ возврат к composer → reload → точный текст/вложение и его SHA. Model POST = 0.
Отдельные сценарии проверяют XLSX/PPTX, cancel, несовпадение bytes/version,
пагинацию, CSV transfer, delayed native hydration и отмену переходом в новый чат.

Входы/выходы прежних независимых Office briefs сохраняются в
`fixtures/koswork-office` и `fixtures/koswork-office-expanded`.
Последний общий прогон **снова скачал** DOCX и записал JSON в Playwright test-results.
Они совпали с сохранёнными файлами в `fixtures/koswork-full-integration`:

- `offer.koswork.docx`: SHA256
  `dec2527a43b56061ff2a39909bae34564b66c9eec4ec38da27ac43af2e81891b`;
- `result.json`: настоящие source/result version, Office readback, восстановленные
  draft/file и hash, source_preserved=true, real_model_called=false;
- `joint-verification.json`: результаты сопоставления новых артефактов, hashes,
  source heads, tested tree, фактические package/test counts и ограничения.

«Компания Б», `19 700`, `00123`, `07.11.2026`, «кроме доставки» проверены по
настоящему XML/readback. Исходник не изменился. CSV report и выбранные байты
также совпали с `fixtures/kosmora-csv-transfer`; selected SHA256:
`3196cdfc942753d8f3896420374b03d479297c9ee91c1bae0b4857c6bd6b6594`.
Полная CSV-строка, включая multiline cell и leading zeros, проверяется до/после reload.

## Выполненные проверки и команды

```sh
KOSMORA_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @cosmora/web test:e2e:office-composer
pnpm --filter @cosmora/web exec tsc -p tsconfig.office-e2e.json
pnpm --filter @cosmora/web exec tsc -p tsconfig.csv-e2e.json
pnpm --dir desktop/windows check
pnpm check:core
```

Для установленного Playwright Chromium executable path можно не задавать.
Production browser suite и следующий полный gate запускались последовательно;
next build не пересекался с сервером, использующим ту же .next. API стенда —
отдельная temporary SQLite и MODEL_PROVIDER=mock, старый сервер не переиспользуется.

- Production browser: **48/48 PASS**, retries=0, workers=1, 2,5 мин.
  25 composer, 9 Office, 1 общий Office/composer, 3 CSV transfer и 10 Studio-files.
- Оба scoped e2e typecheck — **exit 0**.
- Native Linux: **382 PASS / 1 Windows-only skipped / 0 FAIL**, 383 всего.
- Полный `pnpm check:core` — **exit 0**: **952 API PASS** (86 Manager Work,
  14 model-runtime); web 266, DB 173, contracts 206, core 386, gateway 151,
  policy 43, config 17, tool-runtime 64 PASS / 4 OCI skipped локально.
  Format, secrets, lint/typecheck, package tests, root guards, builds и
  privacy/profile fixture smoke прошли. Skipped не называются PASS.
- API build — cache miss; все семь runtime CJS assets в dist побайтно совпали
  с canonical desktop workspace sources.
- Новый DOCX/JSON и CSV report совпали с сохранёнными readback/bytes.
- Финальные format, diff и secret scan выполнены перед публикацией.

Локальные логи этой интеграции: `/tmp/koswork-office-joint-browser.log`,
`/tmp/koswork-office-joint-desktop.log`, `/tmp/koswork-office-joint-core.log`.
Внешние checks точного опубликованного SHA фиксируются в PR; статусы прежних
голов не приписываются новому head.

## Открытие/рендер и честные границы

Сохранённый `render/offer.koswork.pdf` получен из **этих же DOCX-байтов** отдельным
облачным LibreOfficeDev 26.8.0.0.alpha0, commit
`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`. PDF SHA256:
`44f3310793311fda463dfbf41fc8592cc02cc3ac3cfd78148ca6626e5a1fbed7`.
Export/pdftotext exit 0, единственная страница просмотрена, обязательные литералы
читаемы без обнаруженного обрезания. Команда, stderr и Fontconfig cache warnings
сохранены в render/result.json; page-1.png сохранена рядом. Новый renderer в этой
интеграции не вызывался: byte comparison доказывает совпадение с прежним источником
рендера. Engine по-прежнему не делает visual acceptance, поэтому его raw report
содержит visual_render_verified=false. Microsoft Office не проверялся.

Настоящий HY4/другая платная модель не вызывались. Native bridge в CSV browser
сценариях — fixture; это не новая Windows IPC/disk acceptance или тест ПК владельца.
В native suite реальные временные файлы/версии/отказы проверяются CJS-модулем.
Формулы engine не вычисляет; WYSIWYG и неподдержанные объекты не добавлялись.
Предел Work process-local; защита composer между вкладками не является distributed CAS.

## История ошибок, интеграция и откат

В этой совместной интеграции тесты не падали. Две текстовые коллизии при
объединении разрешены явно выше; ни одна работающая защита не удалена.
История прежних ошибок не скрывается:

- первоначальный temporary capture-run не стартовал из-за cwd /api (ENOENT);
  после явного cwd прошёл; он не считается прошедшим тестом;
- Windows #226 получил HTTP 504 в двух попытках упаковки; на более позднем
  c3431b3 Windows #227 build/installer lifecycle прошли. Новый installer head
  проверяется отдельным новым CI, старый EXE не называется новым;
- CSV до scope fix: controlled cancel — 1 FAIL/2 PASS. До fix обычная серия
  30/30 прошла, поэтому причина исходного intermittent CSV-timeout не доказана;
- один CSV repeat ошибочно пересёкся с build: 29 PASS/1 FAIL, 16 asset HTTP 500;
  затем последовательная серия 30/30. Логовые выдержки сохранены, полный trace
  был очищен Playwright, что отмечено в failure-evidence;
- e31b509 имел 381 browser PASS + 1 flaky upload-response fixture (socket hang up);
  следующий 9d2b1f3 имел 382 PASS без flaky. Это не доказательство исправления
  всех причин intermittent отказов. Work/registry lint/test история — в их handoff.

[Work transport handoff](TEAM_KOSWORK_TRANSPORT_SETTLEMENT_DELIVERY_RU.md),
[CSV handoff](TEAM_KOSMORA_CSV_TRANSFER_DELIVERY_RU.md),
[первоначальный Office handoff](TEAM_KOSWORK_OFFICE_WORKSPACE_DELIVERY_RU.md)
содержат отдельные fixtures, команды, ошибки и ограничения.

Для общей интеграции использовать итоговый head PR #466; PR #478/#479 остаются
отдельными историями обзора и не сливались/не закрывались исполнителем.
Откат не требует удаления документов/черновиков/ledger rows или схемных миграций.
Не откатывать весь merge вместе с уже принятыми main #477/#481/#483.
Точечный revert owned source changes 4359fa2 (CSV scope) или 5b13f29 (transport
settlement) требует сохранить accepted revision/files composer и проверки нового
main. Office feature rollback описан в исходном handoff. Сравнение с прежним c3431b3
делать в отдельном checkout, без force-push общей ветки и без удаления данных.
Самостоятельных merge PR/deploy или управления ПК владельца не было.
