# 02_DEVELOPER: конфликт review и восстановление исправленного checkpoint

11 ноября 2026, Москва. Статус этого среза: **готово к интеграции**.
PR #507 уже merged интегратором в main576c9a6. Эта поставка — новый
[PR #519](https://github.com/RLM-Company/Nexus-OS/pull/519), branch ops/developer-coscode.
BASE_SHA `1b87dba9e85162fb49729038e0e072e2001609ce` сохранён без правок чужого кода.
Source `7367678bf86968c1a7308d37397b4314bd32b920`, recovery source HEAD
`d8290f689099ad86e9e4c1198a887dffc25d68ee`, code tree
`36115719b38a02fcdc74c0fd80020bf77ea6652d` совпал локально и на GitHub.
Финальный docs HEAD указывается в PR.

## До / после и путь вызова

Две вкладки одной задачи имеют одинаковый proposal_hash. Раньше старая вкладка
могла заменить новый review или стереть proof/token через invalidate-review.
Теперь существующие endpoints принимают expected_review_hash (null для первого
review). Web pins родителя редактируемого состояния; фоновые ответы его не меняют.
Сервер сверяет этот hash до изменения строки/remote reads. Stale review/invalidate
получает409 STALE_REVIEW, чужие свежие bytes и proof/token сохраняются.
Текущий внутренний CAS версии по-прежнему защищает от одновременных handler-ов.

Путь: `/code-agent` → selected edits/raw diff → invalidate-review(expected parent) →
review(expected parent) → существующий check/runner → proof → task checkpoint.
При конфликте local edits остаются в textarea. «Обновить состояние» не переигрывает
генерацию и не перебазирует их. Новый функциональный control «Загрузить сохранённые
правки» требует подтверждённого discard, затем GET и явное восстановление editor.
Отказ сохраняет local text. Подтверждение загружает актуальный review, также
перемонтирует raw-diff editor: старый неприменённый текст и preview не остаются
под сброшенным dirty-флагом. Старый proof не восстанавливается.

Legacy client без expected_review_hash может создать только первый review.
Замена/инвалидация сохранённого review без parent отклоняется; молчаливой совместимости
с потерей данных нет. API и web выкатывать согласованно (API поддерживает optional
поле; старый API отвергнет новый payload). Дизайн/sidebar/global CSS не менялись.

## Проверки

- Scoped API64PASS. Сценарий: failed fixture check(exit1) → точные repaired bytes →
  новый hash/proof(exit0) → stale write/invalidate отказ без mutation/remote reads →
  stop service → независимое подключение к реальной временной файловой SQLite →
  recover/read: exact edits, check, token сохранены; другой owner не видит run.
  Это persistence test через отдельное соединение, не выдаётся за перезапуск ОС.
- Полный `pnpm check:core` exit0: freshAPI1001/web290; неизменённые runtime86/DB205/
  config17/contracts206/policy43/gateway151/core387 — cache replay (см. полный лог).
  Lint/types/build/format/secrets и остальные core gates прошли.
- Production Chromium24/24 PASS, workers1/retries0, exit0: stale editor не стирает
  новый checkpoint; отмена/подтверждение загрузки; следующая правка нового review;
  raw diff очищается только после discard, proof не возвращается. Strict E2E types
  прошли отдельно. Код UI реально исполнялся, API/GitHub — явные route fixtures.
- Первый coreexit1: lint новой fixture (лишний async, matcher any), исправлено без
  отключения правил. Первый browser22/1: глобальный alert locator захватил служебный
  Next announcer; selector ограничен main. Failures сохранены рядом с итоговыми логами.
- Настоящая модель и live target publish не вызывались. Runner в API-сценарии —
  synthetic fixture с явными exit/cleanup/digest; старые Git/OCI результаты отдельно
  привязаны к SHA и не выдаются за этот API-прогон.

Изменены apps/api/src/code-agent/{service,routes}.ts, scoped code-agent.test.ts,
apps/web/src/app/code-agent/page.tsx и scoped E2E. Общих contracts/DB/migrations/
registration/dependencies нет. Откат — revert двух source commits; checkpoints не
удалять. Команды: pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts;
pnpm check:core; production playwright.acceptance.config.ts e2e/code-agent.spec.ts
с KOSMORA_E2E_PRODUCTION=1 и KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium.
В этой среде использовался pnpm_config_verify_deps_before_run='' при готовых deps.
Diff/format/secret scan и дополнительный scan .log проверяются перед docs commit.

## Следующий срез

Подготовлен bounded nonrecursive traversal для truncated tree текущего GitHub
adapter: pinned SHA,128поддеревьев/100kзаписей/8MB/30s, scopes перед каждым чтением.
Пока этот adapter patch не применён и не протестирован. Применить отдельным
integration commit + scoped service binding; не выдавать partial index за complete.
Затем modern-browser history guard и ограниченный repair feedback. Вся сфера ещё
не завершена. Merge/deploy/owner PC/live API и чужой target publish не выполнялись.

---

# 02_DEVELOPER: поиск в безопасном immutable индексе

11 ноября 2026, Москва. Исполнитель: Разработчик + GPT Plus.
Статус поставки: **готово к интеграции**.
Branch `ops/developer-coscode`, [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
BASE_SHA `b457cf9655d2c8001249c9c34e0180dcc58d97de`, включает сохранённый main
`4b74f2694d6281887cecdccddaeff994549ec8f0` (последнее продвижение main — только
канонические отчёты; они приняты без правок). Source HEAD
`4eb1b83ccd3f16aa79a4de6cfd8fa063b053fb81`, code tree
`f99c5cd4c85c3546cc21c1c6d4dfd6d1ba995b3e` совпали локально и на GitHub.
Финальный docs HEAD фиксируется в PR.

## Что изменилось и где вызывается

Entrypoint: существующий `/code-agent` → create route → `CodeAgentService.propose` →
`gateway.assertRoute` tool negotiation → текущий model/tool cycle → `search_files` →
`read_file` immutable blob → проверенный patch → сохранённый proposal/store.
Раньше list_files показывал лишь короткую выборку; модель не могла искать пути
по остальному индексу без знания точного имени. Теперь search_files принимает
буквальный case-insensitive query (1–160 символов; непустой после trim), возвращает
до32 безопасных путей и total_count/partial. Это поиск имён/путей, не содержимого.
Regex/произвольный shell/URL/папки ПК не принимаются и не исполняются.

Используется уже разрешённый индекс текущего repo/base SHA. Во время поиска нет
GitHub/network/blob reads. Дальнейшее read_file по-прежнему требует найденный
обычный blob, проходит прежние guards и сохраняет точные исходные bytes.
Секретные пути исключаются также самим search helper. Definition выдаётся только
в существующем toolMode после gateway negotiation; tools-free fallback сохранён.
Нового client/work runtime/capability/store нет. Общий лимит6 tool-turns и owner
budget остались прежними; следующая модельная итерация учитывается тем же gateway.
Поиск локальный, но это не обещание бесплатности всего модельного цикла.

Изменённые файлы: `apps/api/src/code-agent/{service,proposal-input}.ts`,
`apps/api/test/{code-agent,code-proposal-input}.test.ts`. UI/contracts/DB/migrations/
регистрация/зависимости/общий GitHub client не менялись. Откат — revert4eb1b83;
сохранённые задачи и чужой main не удалять. Прерванный run не переигрывается скрыто.

## Проверки и реальные границы

Scoped API+helper **71 PASS** (Code63 + input8), lint/types предварительно прошли.
Сквозная fixture: полное tree22 002 обычных путей +2 запрещённых; search ADD.TEST →
точный hit src/add.test.js → immutable read → durable proposal с before/content.
Всего3 model fixture turns,1tree и2blob reads; поиск не добавил GitHub запросов.
Unit проверяет32-hit bound/completeness, literal вместоregex, case/trim,
credential exclusion и отказ для пустых/oversize/control/лишних полей.
Существующие cancellation/policy/privacy/fallback/API сценарии повторены в scoped
наборе. Отдельный новый тест достижения6-turn budget не добавлялся; лимит кода
не менялся. Реальная модель/GitHub provider/executor в API fixtures не вызывались.

Первый scoped прогон:70PASS/1FAIL — тест ожидал proposal без сохранённого before.
Ожидание исправлено с проверкой точных preimage bytes. Первый core:exit1 на
no-control-regex; заменён способ проверки управляющих символов на charCodeAt,
правило lint не отключено. Прежние ошибки сохранены в fixtures/path-search.
После исправления scoped lint/types/API71PASS, exit0; полный gate — ниже.

```sh
pnpm --filter @cosmora/api exec vitest run test/code-proposal-input.test.ts test/code-agent.test.ts
pnpm --filter @cosmora/api typecheck
pnpm check:core
```

Для provider без tools используется прежний single-response путь, search_files ему
не передаётся. Живая model/GitHub target публикация не выполнялась. Предыдущий UI
receipt22PASS относится к source0591ed1; этот срез не меняет web и не объявляет его
за повторную browser-приёмку search tool. Настоящий tmp Git/OCI receipt — отдельно.

## Итоговый gate source4eb1b83

Полный `pnpm check:core` после charCodeAt исправления: **exit0**. Свежие API999
PASS (включая Code63/input8 и GitHub adapter23). Web290/runtime86/DB205 и
config17/contracts206/policy43/gateway151/core387 — Turbo cache replay, не новые
прогоны. Format/secrets/lint/types/build/deploy/connection/live guards/vector-scale/
media/privacy/profile прошли. Пять opt-in OCI пропущены в root test и отдельно
выполнены GitHub CI: **5/5 PASS**, run42971336480/job130360371529 на том же
source4eb1b83. API identity42971336594 success. Verify monorepo и общий Browser
acceptance ещё выполнялись при последнем чтении; не объявляются пройденными.

В текущей среде pnpm запускался с `pnpm_config_verify_deps_before_run=''` при уже
готовых pinned dependencies, чтобы избежать автоматического повторного install.
Никакие lint/types/tests/build не отключены. Diff/формат/secret scan проверены;
.log дополнительно просканированы по шаблонам ключей. Логи ошибок, успехов и
exit-файлы сохранены в fixtures/path-search; receipt содержит хеши артефактов.

## Следующая точка

Проверить существующий путь исправления после failed check: UI review/edit →
retryProposalCheck/check → сохранение proof. Сначала воспроизвести failure → точная
правка → новый review/check → восстановление checkpoint; не строить второй runtime
и не добавлять скрытый model retry. Затем закрыть конкретно найденные пробелы
bounded repair. Truncated tree, общая SPA-навигация и live target publish остаются
ограничениями из BACKLOG. Полная автономная сфера не объявляется завершённой.

---

# 02_DEVELOPER: безопасный контекст большого репозитория

11 ноября 2026, Москва. Исполнитель: Разработчик + GPT Plus.
Статус поставленного среза: **готово к интеграции**.
Branch `ops/developer-coscode`, [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
BASE_SHA продолжения `cd4c4ad4a1e1eaad3b9c6ad25c16114ba5fe9899`.
Новый main `5e01c4fddf2bfc87c7e60b82bae5259f154ce879` просмотрен и принят
merge `2bbb4aa9dde1665f830a832f0aa9df3e94777cec`, чужие правки сохранены.
Source `d467fdb08c2b45e0d84da17ffcb20541be7b84aa`; исправление fixture
`0591ed11e7a3e45dbd2ec199d6732c88a8b015fa`.
Code tree `a27ca3ea0521880ea6d9e75444ec3761f42d53b8` совпал локально и на GitHub.
Итоговый docs HEAD указывается в PR.

## Пользовательский путь до / после

Entrypoint `/code-agent` → выбор задачи/файлов → существующий create route →
`CodeAgentService.propose` → текущий GitHub adapter → выбранный immutable blob →
bounded model context → предложение → preview-diff → review → executor/checkpoint.
Раньше полное дерево22 002 путей останавливалось с TREE_LIMIT до чтения файла.
Теперь полные деревья допускаются до100 000 записей в пределах прежних8 MB
HTTP response adapter. Этот transport limit не увеличен. Читается выбранный
файл; полный индекс существования сохраняется для отказа при попытке выдать
непрочитанный существующий файл за новый. Вход модели остаётся <=128 путей/12 KB,
прочитанные файлы <=40/500 KB. Base SHA и snapshot digest сохраняются.

Усечённое дерево по-прежнему отклоняется до blob/model; неполный индекс не выдаётся
за доказательство отсутствия файла. Cancellation и отзыв policy во время tree
retrieval останавливают последующее чтение. Нового GitHub client/runtime/store нет.

Фильтр чтения и diff теперь также запрещает credential config paths (.npmrc,
.netrc, .pypirc, .envrc, .yarnrc/.yarnrc.yml), приватные директории .ssh/.aws/
.azure/.kube/.docker, обычные SSH private-key names и p12/pfx/jks/keystore.
Старые .env/.git/secret/credential/pem/key ограничения сохранены. Это фильтр путей,
не универсальное доказательство отсутствия секретов в произвольном исходнике.
Старый snapshot с запрещённым путём блокирует review/automatic check/check/publish,
но остаётся сохранённым владельцу. Его нельзя «исправить» молчаливым удалением
поддерживающих файлов и повторным использованием старого proof.

## Изменённые файлы и интеграция

- `apps/api/src/code-agent/service.ts`: лимит полного tree и safe-context fence.
- `apps/api/test/code-agent.test.ts`: large-tree/preview/check, truncated,
  cancel/revoke, forbidden tool-read и legacy checkpoint сценарии.
- `packages/tool-runtime/src/code-agent-diff.ts` и его scoped test: запрет путей.
- `apps/web/src/app/code-agent/patch-client.ts`: объяснения TREE_LIMIT и
  CONTEXT_PATH_FORBIDDEN в существующем разделе; дизайн не менялся.

Общих client/contracts/DB/registration/navigation/dependencies/migrations не меняли.
Нового integration commit кроме принятого main не требуется. Исторический CI
integrationfcc183d остаётся отдельным. Откат: revert source d467fdb и fixture0591ed1;
не откатывать принятый чужой main и не удалять checkpoints.

## Проверки и воспроизведение

Перед исправлением: runtime path baseline14 FAIL/25 PASS; large-tree baseline1 FAIL
с фактическим TREE_LIMIT. После: runtime diff39 PASS; API Coscode62 PASS.
Первый полный core остановился с exit2 на TS2379 нового теста: optional digest
назначался обязательному полю при exactOptionalPropertyTypes. Исправлен fixture,
без отключения типов; baseline и первый gate сохраняются в fixtures/safe-context.
Итог повторного gate приводится отдельно после завершения.

```sh
pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-diff.test.ts
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts
pnpm check:core
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts --workers=1 --retries=0
```

Fixtures задаются в scoped tests: `originals`, `changes`, extraTreePaths22000,
additionalTreePaths и truncatedTree. Gateway/GitHub transport и executor в API
сценариях заменены fixtures; service, parsing/diff, policy и SQLite store настоящие.
Настоящая модель и live target GitHub publish не вызывались. Проверки настоящего
Git/OCI из предыдущего среза остаются отдельно с указанными SHA, не подменяют
текущие synthetic executor результаты.

## Итоговые проверки source0591ed1

`pnpm check:core` после исправления fixture: **exit0**. Свежие API997/web290/
runtime86 PASS; DB205/config17/contracts206/policy43/gateway151/core387 — Turbo
cache replay. Format/secrets/lint/types/build и deploy/connection/live guards/
vector-scale/media/privacy/profile завершились успешно. Пять opt-in OCI здесь
пропущены; внешний CI source0591ed1 выполнил их отдельно: **5/5 PASS**,
run42969991364/job130356081326. API identity42969991356 success.
Общий Verify monorepo/Browser acceptance ещё выполнялись при последней проверке;
их итог не подменяется scoped результатами. Production Chromium22/22 PASS, exit0,
workers1/retries0 на том же code0591ed1 после core; логи сохранены.

## Оставшиеся границы и следующий шаг

Поиск по остальному индексу пока не доступен модели: list_files возвращает короткую
выборку, read_file требует точный путь. Следующий scoped срез — ограниченный
literal search_files в прежнем tool cycle после существующего gateway negotiation,
без новых GitHub запросов, blob reads или прав. Для усечённого tree остаётся честный
отказ; безопасная subtree strategy потребует отдельного adapter integration.
Полная автономная сфера не завершена. Общая SPA-навигация и bounded repair остаются
в backlog; live model/foreign publish/owner PC/VPS/merge/deploy не выполнялись.

---

# 02_DEVELOPER: третий срез — точная задача и изоляция поздних ответов

Исполнитель: Разработчик + GPT Plus. 10 ноября 2026, Москва.
Статус поставленных срезов: **готово к интеграции**. Вся автономная сфера ещё не завершена.

- Branch `ops/developer-coscode`, [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
- Исходный BASE_SHA `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`, контрольный `9d972e8` — его предок.
- BASE_SHA третьего среза `ab2c39d1df641cc8ae74f060e911e522403b09db`.
- HEAD_SHA исходников третьего среза `30e19446989dae92ed692a60f593d67cbb716389`.
- После просмотра общих DB/result-acceptance контрактов принят новый main
  `f9da6e83c8764949d7a478649b8d680517f1c320`, без конфликтов и без правок чужого кода.
- HEAD_SHA объединённого кода `589eb3110c6a123f6dcf612f666269b5bd56468e`;
  tree `870f2aaeb5c7c882e2b919ac5a767c0a7afe6963` совпал локально и на GitHub.
  Финальный commit только отчётов указывается в PR; самоссылочный SHA в файл не вставляется.

## До / после и действующий entrypoint

`/code-agent?project=…&run=…` раньше искал run лишь среди последних 20 записей,
затем молча открывал последнюю чужую для этой ссылки задачу. Теперь точная запись
догружается существующим owner/project-bound GET. При 404 или несовпавшем ID
показан отказ, другая задача не выбирается. Недоступный project из ссылки также
не подменяется первым собственным проектом и не вызывает scoped reads.

Переключение проекта/задачи/нового запуска меняет epoch запросов. Поздние ответы
не восстанавливают прежнюю задачу и не очищают ошибки новой. Unmount редактора
и смена версии отменяют применимость старого preview/invalidate-review ответа;
после ухода он не может начать новый preview или внести файлы в другую задачу.
Сохраняется прежний серверный review/task checkpoint, второй store не создавался.

Изменены `apps/web/src/app/code-agent/page.tsx`, `patch-editor.tsx` и
`apps/web/e2e/code-agent.spec.ts`. Новых API/contracts/DB/dependencies нет.
Входы/ответы UI сценариев — явные fixtures внутри E2E; реальная модель не вызывалась.
Проверяются реальные production UI и запросы через существующие контракты,
но не live GitHub publish. Прочие срезы и настоящий Git/OCI receipt описаны ниже.

## Проверки третьего среза

На исходниках `30e1944` последовательные web lint, typecheck, strict E2E types,
production build и **22 browser PASS**, workers=1/retries=0; сохранён exit=0.
Логи в `fixtures/linked-context/`. Дополнительные сценарии: старая deep link,
недоступный project/run, неверный ID ответа, позднее завершение после выбора
другой задачи и поздний invalidate-review при уходе из редактора.

Первый strict E2E typecheck обнаружил TS2345 в двух Promise(requestAnimationFrame).
Исправлены callbacks тестов, проверка повторена; исходный отказ не объявляется успехом.
После этого прошли 21, затем с добавленным unavailable-project тестом 22 сценария.
Проверки объединённого кода после нового main приводятся отдельным разделом ниже.

## Приёмка после объединения с main

На code HEAD `589eb3110c6a123f6dcf612f666269b5bd56468e`:

- `pnpm check:core` **exit0**: format/secrets/lint/types, unit tests,
  deploy/connection/live-guards/secrets/vector-scale/media-acceptance, build,
  privacy и profile. Свежие API992/web290/runtime71/DB205 PASS; пять opt-in OCI
  пропущены здесь и отдельно выполнены внешним job. Config17/contracts206/
  policy43/gateway151/core387 — Turbo cache replay, не новые прогоны.
- В свежем API-наборе `code-agent.test.ts`57 и `github-integration.test.ts`23 PASS.
  Adapter fixtures покрывают lost PR response/reconciliation без дублирующего
  publish, exact review/base/owner fences и сохранение режима файлов.
- Production Chromium **22 PASS, exit0**, workers1/retries0, после завершения gate:
  `KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts --workers=1 --retries=0`.
- Перед этим ошибочно запущен default Playwright config без executable override:
  **22 launch failures, exit1**, отсутствовал bundled Chromium executable.
  Тестовые действия не начинались. Сбой сохранён в coscode-merged-browser.log;
  исправлены команда/config, браузер не устанавливался и проверки не отключались.
- GitHub CI run [42886979305](https://github.com/RLM-Company/Nexus-OS/actions/runs/42886979305):
  **Code sandbox isolation5/5 PASS** (job130077931797), **Verify monorepo success**.
  API identity run42886979286 success. Общий Browser acceptance оставался in_progress
  при последней проверке; не объявляется пройденным. Эти receipts относятся к code
  HEAD589eb31, не к последующему commit только отчётов.
- `git diff --check`, формат отчётов и secret scan прошли. `.log` дополнительно
  проверены по шаблонам секретов, поскольку штатный scanner их не включает.

Полные локальные логи и отдельные exit-файлы находятся в fixtures/linked-context.
Скрипты pnpm в этой среде запускались с `pnpm_config_verify_deps_before_run=''`,
чтобы не инициировать повторный install при готовых pinned dependencies; сами
lint/types/tests/build не отключались. Зависимости/lockfile не менялись.

## Интеграция, откат и оставшиеся границы

Общий integration по-прежнему только CI commit `fcc183d`; подробности в INTEGRATION.
Входящий main принят отдельным merge, DB/облако/другие команды сохранены как есть.
Откат третьего среза: revert `30e1944`; не откатывать чужой main и не удалять runs.
Миграций и изменения полномочий нет. Общая SPA-навигация, context больших repo,
аудит secret-path фильтрации и ограниченное исправление по ошибкам остаются в BACKLOG.
Live модель/foreign publish, стенд ПК владельца, merge/deploy не выполнялись.

---

# 02_DEVELOPER: второй срез — несохранённые правки Coscode

10 ноября 2026, Москва. Статус срезов 1 и 2: **готово к интеграции**.
Полная автономная сфера ещё не завершена; backlog и точка продолжения ниже.

- Branch `ops/developer-coscode`, [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
- BASE_SHA второго среза `e8e64f3df571cc23e2cddb18b5734f741ee8cb3d`.
- HEAD_SHA кода второго среза `5a5e2e4d3c5cd04c2556c2d065a0cdf8dd8ff62b`.
- Code tree `faf27b8017d0e91a6fdc06a2a11f64a5a67c5920`; GitHub tree и локальный
  index совпали. Итоговый docs/artifacts head фиксируется в PR/передаче.

## Пользовательский сценарий второго среза

Entrypoint тот же `/code-agent`. Раньше смена задачи/проекта или reload молча
теряли локальные edits. Теперь контролы самой страницы требуют явного discard:
проект, сохранённая задача, новая задача/Code-проект и GitHub Link. Native
reload/close используют beforeunload. Отказ от перехода сохраняет точный текст.
Подтверждённый discard открывает выбранное сохранённое состояние. Модель,
публикация и новое выполнение при отказе не запускаются.

Выбранные изменения по-прежнему сохраняются прежним review endpoint/store и
восстанавливаются после reload. Автосохранение или второй task store не вводились.
Неприменённый raw diff имеет отдельный dirty-флаг: сохранение выбранных файлов
не выдаётся за сохранение сырого патча. Есть «Отменить правки diff»; отмена
сбрасывает только локальный текст патча и не возвращает старый proof/approval.
Публикация блокируется, пока raw diff не перенесён или не отменён явно.

Изменены только `apps/web/src/app/code-agent/{page.tsx,patch-editor.tsx,editor-navigation.ts}`
и `apps/web/e2e/code-agent.spec.ts`. Новых API/contracts/DB/dependencies/permissions нет.
Next bundled guides use-client и Link/onNavigate прочитаны, дизайн/CSS не менялись.
Общие файлы вторым срезом не менялись; первый CI integration описан ниже.

## Фактическая проверка второго среза

- Production browser **15 PASS**, workers1/retries0,
  `/tmp/coscode-navigation-delivery-browser.log`. Проверены отмена переходов,
  подтверждённый discard, native reload cancel → отдельный review save → reload,
  сохранность точных edits, raw draft/explicit discard и отсутствие дополнительной
  генерации/публикации. UI API/GitHub — явные route fixtures, не live publish.
- Web lint/typecheck и production build прошли до browser в последовательной && цепочке.
  Во время прогона среда перезапустилась и session registry потеряла ID; процесс
  продолжил выполнение, полный итог 15 PASS сохранён в логе. Отдельный CLI exit
  после перезапуска недоступен и не подменяется выдуманным exit0.
- Дополнительный strict typecheck самого E2E файла прошёл. Первый вызов отказал с
  TS5112 (TypeScript6 требует --ignoreConfig при явном списке файлов); исправлена
  команда, а не отключены типы. Staged diff/secrets проверки прошли до публикации.
- Полный frozen gate/real Git/OCI относятся к первому срезу ниже. Второй срез
  меняет только UI, их результаты не выдаются за повтор всех backend тестов.

История browser-ошибок сохранена в fixtures/editor-navigation: 11/2, 12/1,
12/1, 13/1, 14/1 до итоговых 15 PASS. Сначала fixture перехватывала документ
вместо только API. Затем её hardcoded expectation принимало лишь value=3,
поэтому намеренный review value=99 оставался без ответа. Первичная гипотеза
о native reload/AbortController была неверна; этот продуктовый код не оставлен.
После точного expected review в fixture цельный сценарий прошёл. Последний отказ
14/1 выявил неверное расположение raw-diff пояснения в скрывающемся после review
блоке; сообщение перенесено в постоянную область редактора. Повторные запуски
сопровождались этими конкретными изменениями, не скрывают исходные failures.

## Границы второго среза и следующий шаг

Guard покрывает только контролы самого Coscode и native unload. Общая SPA-навигация
sidebar/router/back-forward не интегрирована; её канонический guard остаётся у Codex.
Не заявляется автоматическое сохранение raw diff при закрытии: его нужно перенести
в выбранные изменения либо явно отменить; оставление страницы требует discard.
Live foreign publish/модель/owner PC/VPS/merge/deploy не выполнялись.

Историческая точка продолжения второго среза (закрыта третьим): ссылка на run вне последних 20 задач могла выбрать
list.items[0] вместо запрошенного run. Это замечено по коду initial load handler,
отдельный сценарий ещё не прогонялся. Проверить exact linked lookup, owner/project
404 и поздний ответ после смены проекта, затем внедрить через текущий GET/store.
Context больших repo, secret paths и bounded repair остаются в BACKLOG.

Для воспроизведения второго среза после production build:

```sh
pnpm --filter @cosmora/web lint
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/web build
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts
pnpm --filter @cosmora/web exec tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop e2e/code-agent.spec.ts
```

Откат второго среза — revert `5a5e2e4`, затем его docs. Review/task данные не удаляются.
Неприменённые локальные drafts не объявляются серверным checkpoint.

---

# 02_DEVELOPER: Coscode — доказательства проверок и отмена OCI

Исполнитель: Разработчик + GPT Plus. 10 ноября 2026, Москва.
Статус первого среза: **готово к интеграции**; полная сфера не завершена.

- BASE_SHA: `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`.
- Контрольная база `9d972e8ba447f681fbfb49253b73d9f02dd1d325` — предок main.
- HEAD_SHA проверяемого кода: `fcc183d18e9e465e10cbf663636fefa0139028b0`.
- Source: `89ec737afdb35d4446193f51604baefe6388c885`.
- Code tree: `223721a5282c57b9ed65cc6e64bafed89a502fba`.
- Branch: `ops/developer-coscode`. [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
- Итоговый docs/artifacts head указывается в PR и финальной передаче: report commit
  следует за указанным HEAD_SHA кода и не меняет реализацию.

## До и после / действующий entrypoint

`/code-agent` → выбранный проект/task/issue → существующие code-agent routes/service,
store и GithubIntegration → proposal/patch editor → review → текущий HTTP/OCI runner →
сохранённый check → отдельное подтверждение Draft PR. Второго runtime/store нет.

До: `passed` от executor с exitCode=1/null мог получить publication_token;
HTTP проверял digest/cleanup, но недостаточно проверял согласованность результата.
Journal не проверялся/не редактировался так же, как stdout/stderr. UI скрывал exit
и мог разрешить публикацию старого противоречивого proof.

Теперь проверяется полный результат на HTTP/sidecar/service границах. Успех требует
status passed + exitCode 0 + cleanupVerified true + точного snapshot. Невалидный
результат отклоняется; новой успешной проверки и publication_token нет. Journal
ограничен по длине/структуре/событиям/timestamps, redaction применяется к каждому
каналу; лишние response fields не сохраняются. Truncated вывод отмечается отдельно,
он не заменяет exit status. Старые durable rows перепроверяются до reuse/publish;
UI показывает код завершения/cleanup и явно блокирует неподтверждённый успех.
Никаких миграций/автоматических повторов модели или публикации для старых rows.

Настоящий Git/OCI-прогон обнаружил гонку отмены: CLI убивали до ответа daemon create,
поэтому созданный позднее loader мог остаться. Теперь уже отправленный create
ожидается до acknowledgement (не более 8 секунд), stopped запрещает следующий start.
Затем повторяются только ограниченные cleanup/probes по собственным labels.
Отсутствие acknowledgement или подтверждённой очистки — unavailable/quarantine,
даже если ранний probe не видел контейнера. Cleanup backoff использует реальный
таймер отдельно от deadline/fake clock. Новые create/start не повторяются.
Read-only snapshot, non-root, network none, pids/memory/cpu limits не ослаблены.

## Изменённые файлы

- `packages/tool-runtime/src/code-agent-result.ts`: единая валидация/canonical result,
  redaction и predicate для persisted rows.
- `code-agent-http-client.ts`, `code-agent-sidecar.ts`: применяют validator;
  `code-agent-workspace.ts`: export и bounded acknowledgement/cleanup отмены.
- Scoped runtime tests: result, sidecar, workspace и новый Git/OCI scenario.
- `apps/api/src/code-agent/service.ts`, `apps/api/test/code-agent.test.ts`:
  check/proposal-check/reuse/publish, отказ новых и старых недостоверных proofs.
- `apps/web/src/app/code-agent/check-evidence.tsx`, его test и `page.tsx`:
  exit/cleanup/unknown и publication eligibility в прежнем разделе.
- `apps/web/e2e/code-agent.spec.ts`: прежний adapter/UI путь + три legacy отказа.
- Общая интеграция отдельным commit: одна строка `.github/workflows/ci.yml`;
  см. [INTEGRATION.md](INTEGRATION.md).
- Только собственные BACKLOG/CHECKPOINT/DELIVERY/INTEGRATION/fixtures.
  Общая доска, Office, browser/CDP, work runtime, shell/sidebar/styles не менялись.

## Настоящий временный Git и точные выходы

[fixtures/check-evidence](fixtures/check-evidence/) содержит input/output JSON,
changes.patch и receipt настоящего runner (не слова модели).
Source Git commit `7f0afdceca1b063c238a2b792d1633a47d63f9e9` создан в отдельном tmp repo.
Два изменённых файла: `src/sum.mjs` и `src/sum.test.mjs`; README побайтно сохранён.
Git apply --check, Git index readback и список изменённых файлов проверены.
Патч к изменившемуся snapshot получает PATCH_SNAPSHOT, без записи.

- Исходный реальный Node test: failed / exit 1 / cleanup true.
- Исправленный immutable snapshot: passed / exit 0 / cleanup true.
- Отмена на setup boundary: cancelled / exit 0 CLI / cleanup true; отменённый
  CLI exit 0 не выдаётся за выполненную пользовательскую проверку.
- Node image: `sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73`.
  Registry: `node@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`,
  официальный Node 24-bookworm-slim, внутри v24.22.2. Это существующий CI image family,
  runtime сам не pull/install. Сторонний source код не переносился.
- Модель не вызывалась; GitHub live publish отсутствовал.

## Фактические проверки и сохранённые неудачи

- Финальный scoped runtime: **61 PASS**, `/tmp/coscode-runtime-verified.log`.
- API code-agent: **57 PASS**, `/tmp/coscode-api-first.log` (real gateway/policy/store,
  provider/GitHub/часть runner — явные transport fixtures, не live модель/публикация).
- Production browser Coscode: **9 PASS**, workers=1/retries=0,
  `/tmp/coscode-browser.log`. API/GitHub ответы этого UI набора — adapter fixtures.
- Первый полный core gate: exit 0, `/tmp/coscode-core-first.log`, до последних уточнений.
- Frozen gate: **exit 0**, `/tmp/coscode-core-frozen.log`. Свежие API **986 PASS**,
  web **290 PASS**, runtime **71 PASS / 5 opt-in OCI SKIP**. Config17/contracts206/
  policy43/gateway151/core387/DB194 — Turbo cache replay, не свежие прогоны.
  Format/secrets/lint/types/build/root guards/vector-scale/privacy/profile PASS.
- Внешний [CI #1753](https://github.com/RLM-Company/Nexus-OS/actions/runs/42878177273)
  для code head `fcc183d18e9e465e10cbf663636fefa0139028b0`: отдельный настоящий
  OCI job **5/5 PASS**, включая новый Git case (2.3 s). Это отдельный стенд;
  он не подменяет локальный failure ниже. Остальные внешние jobs и итоговый
  docs head receipts фиксируются в PR, не выдаются за уже завершённые здесь.
- Последний локальный opt-in OCI набор: **4 PASS / 1 FAIL**,
  `/tmp/coscode-oci-confirmed.log`. Новый temporary-Git scenario PASS; один прежний
  5s тест достиг deadline ещё на setup, получил timed_out/cleanup true.
  Это не объявляется успешным локальным запуском всех пяти OCI-тестов.

Неудачи не удалены: первый OCI run имел 1 failure (неподтверждённая очистка отмены),
следующий — 2 legacy timeout, serial — 4 timeout, warm-up run — снова cleanup
race; после acknowledgement fix новый Git scenario прошёл. Все эти логи в fixtures.
Transport regression run имел 3 timeout из-за fake-clock backoff; после отдельного
cleanup timer scoped набор прошёл. Один lint no-unnecessary-type-assertion исправлен.

Подготовка нового worktree: offline pnpm сначала отказал из-за недоступного default
home, затем из-за отсутствия metadata mirror. Уже установленные pinned packages
подключены локально, workspace ссылки ведут в этот checkout; install scripts не
запускались. Pnpm startup auto-install отключён только для команд стенда, не проверки
приложения. Два прямых web-build не прошли: внешние symlinks Turbopack и ещё не
собранные workspace dist; исправлены локальные ссылки, штатная сборка выполняется
через корневой graph. Логи этих отказов тоже сохранены.

```sh
pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-result.test.ts test/code-agent-sidecar.test.ts test/code-agent-workspace.test.ts test/code-agent-diff.test.ts
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts
# После provision Node OCI image и warm-up, как в существующем CI job:
CODE_AGENT_TEST_IMAGE=<immutable-local-image-id> \
  pnpm --filter @cosmora/tool-runtime exec vitest run --maxWorkers=1 test/code-agent-workspace.oci.test.ts test/code-agent-git.oci.test.ts
# Новый каталог capture обязателен: wx не затирает прежние доказательства.
CODE_AGENT_TEST_IMAGE=<immutable-local-image-id> CODE_AGENT_GIT_REPORT_DIR=/tmp/coscode-new-proof \
  pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-git.oci.test.ts
pnpm check:core
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts
git diff --check
```

На этом заранее подготовленном offline стенде к pnpm-командам применялся
`pnpm_config_verify_deps_before_run=''` либо `--config.verify-deps-before-run=false`,
чтобы CLI не запускал повторную установку. Исходные тесты/types/lint/build/gates
не отключались. OCI и browser не запускать одновременно с Next build/core.

## Полномочия, ограничения и следующий шаг

Реальной модели, платного API и live push/PR в целевой чужой репозиторий не было.
GitHub публикация проверяется fixtures/adapter; собственный PR #507 опубликован
по поручению владельца. Owner/project/capability/budget/privacy fences сохранены.
Новых migrations/dependencies/contracts и изменения тарифов/ключей нет.
Merge/deploy/ПК владельца/VPS не выполнялись. Внешние CI результаты фиксируются
отдельно в PR для его точного head. Только Codex подтверждает дальнейшие статусы.

Следующий срез: проверить потерю несохранённых edits и stale async response при
смене задачи/reload patch editor; использовать текущий checkpoint/store. Контекст
больших repo и bounded repair остаются в очереди BACKLOG. Полная автономность Coscode
этим срезом не объявляется завершённой. Откат — в INTEGRATION; durable runs и чужие
файлы откат не удаляет.
