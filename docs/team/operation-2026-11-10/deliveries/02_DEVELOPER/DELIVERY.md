# Последнее продолжение: legacy repair feedback, 12 ноября

См. [REPAIR_FEEDBACK_DELIVERY_RU.md](REPAIR_FEEDBACK_DELIVERY_RU.md), тот же Draft PR551.
Source78e516ca4d7a45bf6e7356624b3673649580d2fd: используем канонический очищенный
check result в repair prompt и новом checkpoint, до excerpt и dispatch.
API150PASS+1SKIP/validator4PASS; полный новый core exit0 (API1065PASS+1SKIP,
web361PASS). Main5b6013d с документацией сохранён; после source78e516c code не менялся.
Первоначальные failures и fixture-counter ошибки сохранены; live ИИ API отложен.

Историческая поставка ниже.

---

# Последняя поставка: Code context credentials, 12 ноября 2026

[Отчёт текущего среза](CONTEXT_CREDENTIALS_DELIVERY_RU.md), Draft PR551,
ветка `ops/developer-coscode-context-secrets-2026-11-12`, source
ab53ef4832d3fe79c7441c015fde100edb93a63d. BASE maina5f6511.
Initial/negotiated read → credential refusal до durable context и model dispatch;
legacy snapshot/draft/edited review gates; безопасный исходник сохраняет байты.
Полный повтор check:core exit0; API1059PASS+1SKIP, web361PASS, все локальные
core gates прошли. Ранние failures сохранены в отчёте, не объявлены успехом.
Искусственные credentials/provider/GitHub/runner явно отмечены как fixtures.
Живой ИИ API отложен владельцем.

Предыдущий #549 final0d36f8c имеет полный зелёный CI; это отдельный Draft-кандидат.
Исторические результаты ниже.

---

# 02_DEVELOPER: подтверждение исправления привязано к результату проверки

11 ноября 2026, Москва. Статус: **готово к интеграции**, Draft PR519,
branch `ops/developer-coscode`. BASE c2e093ee0e79d99f8b4c64b1a646728654196de4
сохраняет main0ddb9d06812fcdd9d742fd5d40455bc0ec46b8ad. Входящий main менял
только OpenCode preloads/test/report; Coscode/API/contracts сохранены без коллизий.
Source SHA/tree: `40a3a9ed5ceaec68c46a8e9e904cb7e08d2e5879`, tree `a35aa87ea182cd967e473345c22d3d508b7a51b3`; version guard `9877f5b`. Финальный docs HEAD — в истории ветки и PR.
Контрольная база9d972e8 и первоначальная фактическая mainf9eb452 — см. историю ниже.

Ревью выявило гонку двух вкладок: review hash остаётся тем же, но другая вкладка
может повторно выполнить другую проверку над теми же байтами. Старое согласие
пользователя принималось для новой ошибки. Baseline на настоящем service/SQLite/
policy/gateway с runner/model transport fixtures подтвердил FAIL: ожидался STALE_CHECK,
а старая реализация приняла запрос. Это не live модельный вызов.

Теперь POST `.../code-agent/:id/repair-v2` требует `expected_run_version` (positive
safe integer). Сравнение с существующим optimistic run version выполняется до
reservation, remote reads и модельного запроса. При устаревшем результате —409
STALE_CHECK, состояние строки/число provider calls не меняются. Принятый запрос
сохраняет `source_run_version`; replay того же UUID с исходной версией возвращает
состояние без второго вызова, изменённый payload отклоняется. Модель/бюджет/runner/
policy/privacy/publish остаются прежними, нового исполнителя нет.

Web получает новую команду только при `repair_once:2` и валидном run.version.
В компоненте показан повторяемый `node --check`/`node --test`; ключ включает версию,
поэтому загрузка нового proof сбрасывает checkbox. После конфликта существующая
кнопка «Загрузить сохранённые правки» получает свежий результат, нужен новый consent.
Браузерный сценарий проверяет refusal → неизменный server state → reload proof →
unchecked consent → явное подтверждение → новый diff, без публикации GitHub.

Отдельный маршрут v2 обязателен для безопасной совместимости: прежний Fastify handler
удалял неизвестные поля JSON. Только новое поле на старом /repair могло быть проигнорировано
при смешанных версиях. Новый handler не регистрирует legacy /repair; несовместимый
клиент получает404, новый клиент на старом server с capability1 не отправляет команду.
Тесты проверяют legacy capability, отсутствие версии, invalid integer, stale check,
повтор неизменённого и изменённого payload. Старые v1 attempts читаются и не replayed.

Изменены только собственные API `{routes,service,store}.ts`, scoped API test,
web `{page.tsx,repair-control.tsx,patch-client.ts}` и code-agent E2E. Optional поле
в run JSON не требует DB migration. Общие registry/contracts/gateway/app.ts не менялись.
Новых dependencies, provider/quota changes, grants и shell команд продукта нет.
Интеграционная совместимость отражена в INTEGRATION.md; API+web поставлять вместе.

## Проверки и результаты

- Baseline stale-check **FAIL,exit1**: старая реализация не бросила STALE_CHECK.
  После исправления scoped API/GitHub/tree **117PASS+1opt-inSKIP**, exit0.
- Финальный source40a3a9e: `check:core` **exit0**, включая format/secrets/lint/types/
  tests/build/deploy/connection/live-guards/vector/media/privacy/profile. API1031 и
  web290 fresh; неизменённые config17/contracts206/policy43/core389/gateway151/
  DB214/runtime86+5opt-inSKIP — Turbo cache. API1opt-inSKIP в root не объявляется PASS.
- `repair-v2` HTTP → настоящий OCI Node → Git readback: **1PASS,exit0**;
  остальные85 filtered skipped. Failed1→passed0, cleanup true; owner00123 и README
  сохранены. Модель и GitHub transport — fixtures, реальный provider не вызывался.
- Production Chromium156: **30/30PASS,exit0,1.0m**, workers1/retries0. Новый конфликт
  → owner reload → unchecked consent → explicit consent → diff проверен в браузере.
- Strict E2E types **exit0**; API/web types/lint прошли и в финальном root.
- Предыдущий полный root на9877f5b тожеexit0, затем v2-route потребовал нового полного
  прогона; итоговая версия40a3a9e проверена отдельно. Это не скрытый повтор failure.
- Удалённый source40 [CI43024980295](https://github.com/RLM-Company/Nexus-OS/actions/runs/43024980295)
  полностью **success**: monorepo130537461796, browser130537462097,
  isolation130537462197. Identity43024980309 также **success**. Точная квитанция
  ci-source.json связывает jobs с исходным HEAD40a3a9e, не с будущим docs commit.
  Предыдущий HEAD10f50a1 тоже имел полный green CI43018692603.

Исходники опубликованы в настоящую ветку GitHub через object API с expected-SHA lease;
local Git tree равен remote tree. Рабочая копия после сдачи чистая. Входящие owner files
не переформатированы. Сырые логовые diagnostics сохранены; normalization LF/trailing
whitespace указана в provenance вместе с hashes, исходный FAIL не выдан за PASS.

## Запуск и откат

В `/code-agent` сохранить review, выполнить подтверждённую проверку. После failed
proof разрешить одну модельную попытку. Если другая вкладка изменила результат,
обновить сохранённое состояние и подтвердить заново. Новый diff по-прежнему требует
свежего review, затем отдельного разрешения публикации. Полные commands/fixtures
предыдущей вертикальной приёмки остаются ниже; новые логи и receipt находятся в
`fixtures/stale-check/`. Команды используют `pnpm_config_verify_deps_before_run=''`:

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts
pnpm check:core
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts --workers=1 --retries=0
```

Revert данного scoped fix возвращает старый протокол и его известный stale-check
риск, потому для безопасного отката отключить repair UI или вернуть API+web вместе;
не использовать v1 платный repair на смешанных версиях. Run JSON/old checkpoints
не удалять. Source version optional metadata безопасно остаётся в сохранённых строках.

Ограничения прежние: live платная модель и foreign target publish не разрешены и не
выполнялись; проверки Node по snapshot без сети/install/arbitrary shell; ограниченный
GitHub tree и старые browsers без Navigation API. Это готовность к интеграции,
не merge/deploy/live/release acceptance. Все старые результаты ниже исторические;
верхний раздел фиксирует новый контракт v2 и точные новые проверки.

---

# 02_DEVELOPER: законченный путь исправления Coscode

11 ноября 2026, Москва. Статус: **готово к интеграции**. Ветка
`ops/developer-coscode`, [Draft PR #519](https://github.com/RLM-Company/Nexus-OS/pull/519).
Публикация своей ветки подтверждена на настоящем GitHub; merge/deploy не выполнялись.

- Контрольная база владельца: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`.
- Фактическая исходная main: `f9eb45285f3473bfd3fe9a73939c1903dc696b3b` (контрольная база — предок).
- Main перед текущим source: `abbcee7eab47d7e8ded86a0cfb1567a133b3a76a`;
  merge BASE_SHA текущего среза: `be85aef8b394a8a6489239def4399dfd59595a19`.
- Source HEAD_SHA: `3936e5f7ebe7abe7780e82debaac71a15743710f`,
  tree `9e4fd6b0382e12c789027b68862aeb42498c98f3` совпадает локально и на GitHub.
  Финальный docs HEAD указан в PR/history (самоссылка SHA в собственном commit не создаётся).
- Финальная сверка: main `026b0dfbf42823c2aeef5da41801378ffc8d6c7a` сохранена
  merge `7900ce6f95abbeb789e3b2a74194a5bd2ed32492` (tree59cf949a). Только11
  OpenCode Windows/download/report files; Coscode и общие API/contracts не менялись.
  Полный core и browser относятся к source3936e5f, после этого merge повторены
  общий format/secret/diff check. Чужой Windows функциональный прогон не заявляется.

## Что теперь работает

Существующий `/code-agent` → project/task/issue → bounded immutable context →
точные edits/diff → сохранённый review → текущий OCI/HTTP executor → строгий proof →
отдельное разрешение branch/commit/Draft PR. Работа остаётся в прежних run/store,
manager/gateway/ownerBudget и executor; переносить код из ответа вручную не нужно.
Ранее доставлены exact deep links, поиск безопасных путей, восстановление усечённого
GitHub tree, конфликт устаревшего review, загрузка checkpoint и защита локальных
правок. Ниже сохранена история этих срезов; её старые blockers не описывают новый итог.

Теперь после реальной неудачной проверки есть явный путь:
**разрешение дополнительного модельного расхода → одна попытка → новый diff → та же
проверка → новый просмотр владельцем**. Запрос отправляется только при capability
`repair_once:1`; старый сервер не получает новую команду от web. Сервер проверяет
owner/project, текущий review, failed exit>0, cleanup, digest и сохранённый check_type.
Старый proof без check_type требует свежей проверки. Неподдержанный набор файлов
(NO_SUPPORTED_CHECK_FILES) отказывается до генерации.

Рабочий контекст — исходный snapshot плюс выбранные сохранённые правки владельца.
Разрешены только точные уникальные edits существующих прочитанных байтов; модель
не получает tools, не создаёт произвольные пути и не заменяет весь файл. Все
выбранные изменения сохраняются, diff строится относительно оригинальной базы.
Результат модели не считается успехом: повторный запуск проходит через прежний
изолированный runner. Старые draft/check/publication_token атомарно отделяются от
нового предложения; токен возможен только после нового review точных проверенных
байтов. Предыдущая ошибка, review hash, draft ID и digest остаются в run JSON.

UUID запроса сохраняется до dispatch. Повтор того же UUID возвращает состояние,
другой UUID после резерва получает REPAIR_LIMIT. Ошибка, timeout, отмена или restart
не дают скрытого второго модельного вызова. При отказе точной замены прежний review
и выбранные байты остаются доступны. Политика повторно проверяется внутри model
scope после ответа: быстрый tool-only ответ при отзыве доступа не становится patch;
фактически полученный usage при этом не теряется.

## Изменённые файлы и контракт

Текущий source commit меняет `apps/api/src/code-agent/{service,store,routes}.ts`,
`apps/api/test/code-agent.test.ts`, `apps/web/src/app/code-agent/{page.tsx,patch-client.ts}`,
новый `repair-control.tsx` и `apps/web/e2e/code-agent.spec.ts`.
POST `.../code-agent/:id/repair` принимает `{review_hash,client_request_id,approve:true}`.
`check_type` и `repair_request` — optional поля прежнего run JSON: миграции и новые
таблицы не нужны. Dependencies/lockfile/provider/квоты/права не менялись.
Общий adapter из tree-среза вынесен отдельно в `b22b4f3` и описан в INTEGRATION.md.
Оболочка чата, sidebar, global CSS и другие сферы не изменялись.

## Воспроизводимая приёмка

- Scoped API/GitHub/tree: **115 PASS, 1 opt-in SKIP**, exit0.
- Отдельный настоящий OCI API/Git repair: **1 PASS**, exit0 (остальные83 skipped
  по `-t`, не объявляются заново пройденными).
- `pnpm check:core`: **exit0** на source3936e5f. Format/secrets/lint/typecheck/test/
  deploy/connection/live-guards/secret-tests/vector-scale/media/build/privacy/profile
  прошли. API1029PASS+1opt-inSKIP и web290PASS выполнены заново; неизменённые
  config17/contracts206/policy43/core389/gateway151/DB214/runtime86+5opt-inSKIP —
  подтверждённые Turbo cache hits. Build API/web выполнены заново (7/9 cache).
- Strict E2E TypeScript exit0, web/API types exit0. Production Chromium156:
  **28/28 PASS**, workers1/retries0, exit0,53.9s.
- На source3936e5f GitHub CI job130510197652 **Code sandbox isolation PASS,5/5**;
  identity boundary также success. Остальные удалённые jobs на момент локального
  итога ещё выполнялись; общий remote CI success здесь не подразумевается.
- `git diff --check`, локальный/GitHub tree equality и проверка секретов перед
  публикацией выполнены; финальный docs-only формат/secret check отмечен в provenance.

Все команды запускались из checkout с pinned dependencies, с
`pnpm_config_verify_deps_before_run=''` (без auto-install):

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts
pnpm --filter @cosmora/api typecheck
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/web exec tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop e2e/code-agent.spec.ts
pnpm check:core
KOSMORA_E2E_PRODUCTION=1 KOSMORA_E2E_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm --filter @cosmora/web exec playwright test -c playwright.acceptance.config.ts e2e/code-agent.spec.ts --workers=1 --retries=0
```

Отдельный реальный OCI API сценарий (существующий разрешённый local image; без pull):

```sh
CODE_AGENT_TEST_IMAGE=sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73 CODE_AGENT_TEST_EXECUTABLE=/usr/local/bin/docker CODE_AGENT_REPAIR_REPORT_DIR=/tmp/coscode-new-repair-receipt pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t 'real OCI API repair'
```

Нужен доступ к отдельному Docker sandbox; удалённый daemon/owner PC не используется.
При заданных DOCKER_HOST/CONTEXT/TLS selectors запускать с очищенными selectors для
местного unix socket, сохраняя Docker credentials. Образ — официальный Node24.22.2,
registry digest `node@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`.
В стандартном root test этот opt-in сценарий явно skipped; отдельно он реально прошёл.
`fixtures/bounded-repair/` содержит input/reviewed/output/changes.patch/receipt,
неудачные исходные прогоны, финальные логи и provenance. В логах нормализованы только LF, хвостовые пробелы и пустой EOF; hashes сырых логов сохранены в provenance. Temp Git base/source digest
настоящие. Node получил failed1 → passed0, очистка true, patch применён через git
apply --check/--index к двум файлам, marker00123 и README сохранены. Gateway/бюджет/
SQLite/код модуля настоящие; внешняя модель и GitHub transport заменены fixtures.
Фактический дополнительный модельный запрос один. Live модель не вызывалась.

Ошибки не спрятаны повтором: baseline tool-only revoke принял proposed вместо failed;
после scopedModel postcheck регрессия прошла. Первый новый API прогон76/4 выявил
undefined результат guarded metadata и ошибочное ожидание Fastify additional-property
400 (Fastify удаляет лишние поля); metadata теперь возвращает JSON proof, предположение
теста удалено. Следующий80/80 и расширенный115/115 прошли. Первый scoped lint нашёл
две лишние assertions и prefer-const; исправлены без изменения поведения. Исторический
общий formatter failure на чужом research JSON исправлен владельцем файла в main
73bf04f и сохранён через merge abbcee7; исходник/ignore нами не обходился.

## Запуск продукта, интеграция и откат

Поставить API+web вместе. В существующем Code разделе подключённого репозитория
создать/открыть задачу, просмотреть выбранные изменения, сохранить review, разрешить
Node check. После failed proof поставить отдельный checkbox дополнительной попытки,
нажать «Исправить по результату проверки», просмотреть новый diff и сохранить новый
review. Успешный автоматический proof переиспользуется только для этих точных байтов;
дальнейшая публикация требует отдельного подтверждения владельца.

Интегратору принять отдельный adapter commit перед scoped service; новых DB steps нет.
Revert source3936e5f выключает новую попытку; JSON fields остаются инертными, данные
не удаляются. Публиковавшиеся ранее внешние PR/refs автоматически не откатываются.
Откат tree-adapter отдельно согласовать с общими потребителями INTEGRATION.md.

## Фактически оставшиеся границы

- Live вызов платной модели и push/PR в чужой целевой репозиторий не разрешены и не
  выполнялись. GitHub publish/idempotency/lost-response проверены adapter fixtures.
- Node syntax/node-test выполняются по выбранным поддерживаемым файлам, без сети,
  install и произвольного shell. Это не произвольный build любого стека.
- Tree восстановление ограничено128nodes/100k entries/8MB/30s; за пределом честный отказ.
- SPA traversal guard проверен Chromium156. Старые browsers без Navigation API и
  uncancelable platform events не гарантируют guard; raw diff автоматически не хранится.
- Filename guards не гарантируют отсутствие секретного содержимого в произвольном
  разрешённом исходнике; владельцу выбирать только разрешённые файлы.
- При неизвестном исходе модельного запроса автоматического replay нет; сохранённый
  review можно доработать вручную и повторить бесплатную проверку. Merge/release/live
  приёмку подтверждает интегратор. Наш максимум — готово к интеграции.

---

## История предыдущих срезов (результаты и blockers на соответствующих версиях)

# 02_DEVELOPER: сохранность правок при Back/Forward

11 ноября 2026, Москва. **Готово к интеграции** в PR519, branch ops/developer-coscode.
BASE ff70f7b073941a82e7abc145f92c93d4878baf76; source HEAD
c6809537b9583404faf873a6e92a0fcdd73ea558, tree543bf1ebd24c12435d13b3e1d04a00549f6a62ea.
Локальный index и GitHub tree совпали; финальный docs HEAD в PR.

Раньше native beforeunload защищал reload/close, но настоящий SPA Forward мог
потерять edits без предупреждения (исправленный baseline: dialogs0, sameDocument=true).
Теперь существующий собственный editor-navigation hook также слушает Navigation API
navigate(traverse). Только cancelable sameDocument переход на другой pathname/search
требует прежнего confirmDiscard. Отказ preventDefault сохраняет URL и видимый текст;
подтверждение позволяет переход. Hash-only переход не теряет editor и не блокируется.
Native unload и собственный Link onNavigate сохранены, второй router/history patch
не создан. Listener снимается после clean/unmount. Общие sidebar/layout/styles не менялись.

Production Chromium26/26PASS, workers1/retries0, exit0. Web lint/typecheck/build
прошли до browser, strict E2E types отдельно прошли после финальных сценариев.
Back: реальный root Coscode Link→Code page→edit→cancel/accept browser goBack,
visible bytes сохранены при отказе, workspace writes[]; Forward: реальная NextLink
история, sameDocument=true, cancel сохраняет текст, browser goForward с явным
confirm завершает переход. Настоящая модель/целевой GitHub не вызывались.

История failures сохранена. Первый baseline не дошёл до navigation из-за selector
getByLabel на wrapping select; исправлен на существующий role combobox. Второй
baseline подтвердил настоящий пропуск guard. После guard первый25-case прогон24/1:
проверка повторяла legacy history.forward() после отмены и не инициировала второй
переход в Chromium156. Диагностика сохранила entries и transition=false. Доп. жест
не помог. Navigation.forward().finished прошёл, затем реальная browser goForward
тоже прошла. Финальные тесты используют browser commands, а не выдумывают success
для повторного legacy-вызова. Это platform/testing distinction, source guard после
первой реализации не ослаблялся. Временные console probes в тесте удалены.

Проверено на Chromium156.0.8078.79. Старые браузеры без Navigation API сохраняют
прежний native/own-Link guard; sameDocument traversal там не гарантирован.
Нельзя блокировать event.cancelable=false против правил платформы. Источники:
[MDN navigate_event](https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigate_event)
(BaselineJan2026,lastmodifiedOct26) и [WHATWG history](https://html.spec.whatwg.org/multipage/nav-history-apis.html),
прочитаны11ноября. Это использование browser API, сторонний код не переносился.

Изменены только apps/web/src/app/code-agent/editor-navigation.ts и scoped
apps/web/e2e/code-agent.spec.ts. Новых dependencies/contracts/DB/permission grants
нет. Откат — revert c680953; checkpoints не удаляются. Команды — web lint/typecheck/
build и strict E2E tsc, затем production playwright.acceptance.config.ts code-agent
workers1/retries0 с Chromium=/usr/bin/chromium. Полные логи/хеши в fixtures/history-guard.
Глобальный core НЕ объявляется новым PASS: upstream formatter blocker из tree-среза
остаётся известным, остальные gates на39cad6b были успешны. Неизменённые API/runtime
не перетестировались ради этого UI-only изменения. Diff/format/secrets проверяются
перед docs commit. Осталось explicit bounded model repair; весь блок ещё не закрыт.

---

# 02_DEVELOPER: восстановление усечённого дерева GitHub

11 ноября 2026, Москва. Branch ops/developer-coscode, [PR #519](https://github.com/RLM-Company/Nexus-OS/pull/519).
Статус кода: **готово к интеграции**, общий quality gate заблокирован upstream format.
BASE_SHA `4a6b9cfbf79e9d9144852fea3cf43bf9d726dda5` после принятия main
`d047ce125f623c64d2615a6235dfdcd1c8e70a55`. Новые optional memory contracts,
store ownership revalidation и чужой Windows source сохранены без авторских правок.
Integration `b22b4f3f42a3b7bb202c72cc8f9ddc200c5b2f1e` отдельно меняет общий adapter.
Scoped source HEAD `39cad6b69c1771f78c78908c4183b4c6af885e4e`, code tree
`e73b1ab02e899f64105d8fbb6ab9bb4fed53a920` совпали локально и на GitHub.

## До / после и entrypoint

`/code-agent` → create → текущие service/GitHub adapter → recursive tree.
Раньше truncated=true давал TREE_LIMIT, не позволяя получить полный existence index.
Теперь существующий adapter при таком результате читает nonrecursive tree объекты
по закреплённым SHA, собирает полный индекс и только тогда возвращает truncated=false.
Оригинальный partial recursive список не смешивается с восстановленным. Scope и
opaque repo/base привязки сохраняются. После этого прежние selection/search/read
получают безопасные blob paths, proposal → preview/review/check сохраняют результат.

<=128 nodes,100k entries,8MB expanded metadata,30swhole deadline; каждый HTTP response
по-прежнему <=8MB/15s. При исчерпании traversal budget или усечённом child возвращается
original truncated=true, поэтому отсутствие файла не выдумывается. Wrong SHA,
unsafe component/duplicate/ancestor cycle отклоняются; один tree SHA под разными
prefixes поддерживается. Это bounded recovery, не обещание читать любой размер repo.

Optional GithubReadScope(signal/allowed) проходит через status/tree/file/prepare/
branchTree. Проверяется до/после HTTP и при чтении body. Code service передаёт
существующие active/external controller и authorityChecks: отмена/privacy/policy
не создают второй permissions runtime. Publish использует свой прежний allowed
predicate также для metadata; write retry не добавлен. Full existence index теперь
включает директории: folder нельзя выдать за новый обычный файл. Secret/symlink blobs
не читаются. Прочитанные files/исходные bytes и новый proof сохраняются прежним store.

## Проверки и фактический upstream blocker

- Adapter+existing GitHub+Code96PASS; после service binding —100PASS (Code68,
  GitHub23, tree9). Success: recovered tree→selected blobs→proposal→review→check;
  folder overwrite refusal; cancel/revoke during child retrieval без blob/model;
  malformed/cyclic/shared tree, nonrecursive truncation и bounded traversal.
- Scoped lint/types/format прошли. Провайдер GitHub/model/runner в этих API tests —
  явные fixtures; parsing/service/guards/store настоящие, live publish не выполнялся.
- Полный pnpm check:core **exit1**: Prettier отклонил пришедший из main файл
  `docs/research/experience-llm-distill-2026-11-10.json`. Это чужой исследовательский
  artifact; его bytes и .prettierignore не менялись. Gate НЕ объявляется пройденным.
- Остаток core выполнен явной последовательностью после scoped format и завершён
  **exit0**: secrets/lint/types/test/deploy/connection/live guards/secrets/vector-scale/
  media/build/privacy/profile. Fresh API1014/web290/runtime86/core389/DB214/contracts206/
  gateway151/policy43 PASS; config17 — cache replay;5 opt-in OCI skipped в root test.
  stdout целиком собран из exec session, profile (redirected отдельно) приложен.
  Это не обход failed formatter и не зелёный общий CI.
- Web component этим срезом не менялся, добавлены только два error messages.
  UI24PASS относится к d8290f6 из предыдущего среза, не к новому browser-прогону.

Команды: pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts
test/code-agent-github-tree.test.ts test/github-integration.test.ts; pnpm check:core
(зафиксированный отказ); затем каждая оставшаяся команда из package.json check:core
после format:check отдельно. Полные логи/exit/hash receipts — fixtures/tree-recovery.
В этой среде pnpm_config_verify_deps_before_run='' при готовых pinned deps.

## Интеграция и откат

Common file только apps/api/src/github-integration.ts; scoped tree test и INTEGRATION
в том же integration commit. Scoped service/test/error messages отдельным commit.
Оба применить вместе. Нет DB/migrations/dependencies/new executor/tool registry.
Callbacks не попадают в сериализованный ChangePlan. Откат: scoped source, затем
integration; source/base/checkpoint/чужие файлы не удалять. Upstream format blocker
передан на согласование Codex через этот отчёт; авторские данные не форматировать
попутно, manifest может быть привязан к их исходным bytes.

Осталось: modern-browser history guard и explicit bounded model repair по реальному
failed check. Старый manual repair/free check retry и новые checkpoint controls
сохранены. Полная сфера ещё не завершена; real model/target publish/owner PC/VPS/
merge/deploy не выполнялись. Далее — точная точка в CHECKPOINT.

---

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
