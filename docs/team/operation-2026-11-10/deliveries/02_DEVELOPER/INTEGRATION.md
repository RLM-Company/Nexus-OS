# Дополнительная CI-интеграция, 13 ноября 2026

Commit `23bbcde7a23c10f6d55d38e28defd718db80fe9e`; единственный общий файл
`apps/web/e2e/chat-reliability.spec.ts`,18 добавлений/14 удалений.
Предусловие draft test теперь создаёт существующий held mock run и явно отменяет
его через owner API; проверяет HTTP200, cancelled и реальную persisted row.
Это не смена production lifecycle: исходный INTERRUPTED seed из CI43455694958
сохранён для отдельного исследования владельцем chat runtime. UI assertions,
финальный successful answer, failOnFlakyTests, retries и timeout CI не ослаблены.
Проверено5 повторов при workers2/retries0, exit0; строгие web types/lint0.
Все продуктовые изменения Coscode2b8b895 остаются без правок.
Откат этой адаптации — отдельный revert integration commit; запускать точный HEAD CI.
[Разбор и исходный failure](COSCODE_UNSAVED_REFRESH_DELIVERY_RU.md).

История ниже.

---

# Coscode unsaved refresh, 13 ноября 2026

Новых общих изменений нет: только `apps/web/src/app/code-agent/page.tsx`
и `apps/web/e2e/code-agent.spec.ts`, плюс собственные отчёты/fixtures.
Новых contracts/API/DB/migrations/routes/dependencies/registration нет.
Используется уже добавленный предыдущим commit404c3ddb strict E2E typecheck и scoped production runner.
Этот slice стоит после предыдущего snapshot-order slice в том же собственном PR581,
BASE1d72d9d. Не переносить source commit2b8b895 отдельно без предшествующего acceptance fence.
Для отката нового поведения revert только product commit2b8b895, сохранить прежнюю
защиту порядка ответов. Данные/миграции не меняются. Последующие изменения сохранять вручную.
[Подробная поставка](COSCODE_UNSAVED_REFRESH_DELIVERY_RU.md).

Перед передачей сохранён main14a5f48 (PR582/583):58 входящих файлов,
аддитивная константа Manager contract просмотрена, семь CodeAgent source blobs прежние.
Четыре конфликта префиксов02_DEVELOPER объединены с сохранением обоих полных
префиксов и единого неизменного исторического suffix. Чужие исходники/отчёты
не переписывались собственными версиями. После объединения root gate повторён, exit0; собственных изменений общих файлов нет.

История ниже.

---

# Coscode snapshot order: отдельная интеграция, 13 ноября 2026

Product commit3ad583333bedb590799d7c984d974edf4e2073d3.
Integration commit404c3ddb3cf69ed473b72d3ad304555942ab783a.
BASE main1b73e49761a61ef34e25a3ae7958de9cf40cf7f9.

Общие изменения ограничены регистрацией проверки и scoped runner:

- `apps/web/package.json`: одна строка typecheck, добавлен strict CodeAgent E2E config.
- `apps/web/tsconfig.code-agent-e2e.json`: отдельная конфигурация проверки E2E и runner.
- `apps/web/playwright.code-agent.config.ts`: optional Chromium path, production build/start,
  проверяемый непривилегированный loopback port; retries0 и запрет reuse сохранены.

Новых contracts, API, gateway, DB, auth, migrations, routes и зависимостей нет.
Runtime, ограничения сети и grants прежние. Не переносить dev-stand проблему
разрешения `.js` TypeScript exports в общий Next config в рамках этого среза.
Для отката отменить integration commit и product commit в обратном порядке
с сохранением последующих правок интегратора; данных для миграции нет.
[Подробная поставка](COSCODE_SNAPSHOT_ORDER_DELIVERY_RU.md).

Перед финальным HEAD сохранён новый main4477dd53 (PR572), пять независимых файлов:
root package.json, scripts/vps-live-acceptance.mjs, scripts/test/vps-live-acceptance.test.mjs,
два отчёта05_GEMINI. Это входящая реализация, не собственное изменение этих файлов.
Контракты/API/CodeAgent не менялись, семь source blobs сверены. Guard test удаляет
пароль и останавливает wrapper до network; живой VPS не запускался.

Исторические интеграции ниже.

---

Перед публикацией сохранён новый main501d403 (PR573) без изменения своих7 source
paths; общие contracts прочитаны. Final merge HEAD требует отдельного CI;
локальный core receipt относится к281. Новая миграция0067 — inherited main, не наша.

# Request recovery, 13 ноября 2026

BASE281604b, branch ops/developer-request-recovery-2026-11-13. Новый Draft PR.
Отдельный integration commit `6d3fd5a8c46660062a5a4771c34a8aebdec28e7d`
(локально7a70d40): page.tsx — общий selector и live draft guards;
chat-attachments.tsx — snapshotReading на существующем latest ref;
tsconfig.composer-e2e.json — одна строка регистрации strict E2E.
Полные пути — apps/web/src/app/{page.tsx,chat-attachments.tsx} и
apps/web/tsconfig.composer-e2e.json. Helper/tests commit9c25062a обязателен вместе с ним.
Дополнительный integration44eb6f1 — apps/web/playwright.composer.config.ts:
две новые suites включены в существующий test:e2e:composer. Никаких новых runner/SDK.
API/contracts/DB/registry не меняются. Макет/CSS и права прежние.
Закрытый PR566 не обновляется; main281 и изменения PR565/566 сохранены без переписывания.
Подробности/откат: [отчёт](REQUEST_RECOVERY_2026_11_13_RU.md).

Исторические интеграции ниже.

---

# Terminal run recovery, 13 ноября 2026

BASE7c2abad, source04c4b2e/tree78443d83. Отдельный integration commit
`04c4b2eb03dc0fa8541041d593352ad9ce84a8f6` (локально3b27dbd).
Общие файлы: `apps/web/src/app/page.tsx` — один terminal ref, передача его прежним
loaders, фиксация6terminal SSE callbacks и успешного cancel acknowledgement;
прежний resolver вынесен в отдельный модуль без дублирования.
`apps/web/tsconfig.composer-e2e.json` — одна строка регистрации новой E2E в strict types.
Нужен вместе с helper/tests commit3a08c3f. Новых API/contracts/DB/registration нет.
Стиль, маршруты, дизайн и права прежние. Подробности и откат в
[отчёте](TERMINAL_RUN_RECOVERY_2026_11_13_RU.md).

Исторические интеграции ниже.

---

# Интеграционная приёмка с новым main, 12 ноября 2026

PR [#551](https://github.com/RLM-Company/Nexus-OS/pull/551), ветка
`ops/developer-coscode-context-secrets-2026-11-12`.
Предыдущий HEAD `30ff9d1d69703d13f07afc5ec889f6d19eab991d` имеет зелёные
CI43255526930 и identity43255527039; это не CI нового объединённого дерева.

Main `33f43b8825756d60c67db306783fed9e3de717ee` сохранён merge-коммитом
`958c8a2e79c71f62a15050ea9b51a446b5dfc1da`, source tree
`57f5c6de8c05908b96a8ab547284bd77ea8f316e`. Изменения research изучены:
аддитивные типы/функция и текст отчёта, без изменений CodeAgent/Manager/executor.
Конфликтов и ручных правок общих файлов нет. Продуктовый код Coscode не менялся.

Подробности: [INTEGRATION_REVIEW_2026_11_12_RU.md](INTEGRATION_REVIEW_2026_11_12_RU.md).
Дальше — CI точного финального docs HEAD, затем независимое ревью и решение
об интеграции. Не сбрасывать длинный browser job попутным push. Самостоятельные
merge в main/deploy, live модель и foreign publish не выполняются.
Максимальный статус — **готово к интеграции**, не интегрировано и не принято в выпуск.

Предыдущая история ниже.

---

# Context envelope hardening, 12 ноября

PR551/sourceb764ac26a5bc061167680a8d5782a77848165adc.
Только scoped Code API helper/service/tests и существующий web error text.
Общий isSafeCodeAgentDiffPath/tool-runtime не менялся: API-private predicate добавляет
известные credential formats для model context. Общих schema/contracts/routes/DB/gateway
изменений нет; integration commit не требуется. Legacy wire errors/commands прежние.
Owner records не переписываются; metadata/task/issue в messages не дают прав.
Main1c07 уже в ancestry. До merge — final HEAD CI и свежий canonical contract review.

Исторические integration notes далее.

---

# Интеграция с main1c07, 12 ноября 2026

PR551, mergec3cef4bb79d1e14b4d61979a7010dcc830e94353 сохраняет main1c07f8d.
Это отдельный integration merge, без ручных изменений общих файлов и форматирования.
Просмотрены optional ChatSkillSnapshot.scope и новые Skills types/core exports/ChatService;
CodeAgent/Manager/executor request contracts не менялись. Main Skills/Windows/chat retry
source и чужие delivery files перенесены точными canonical blob bytes.

Scoped production source равенc9625d6. Совместимость проверена на combined treeb455ff73:
coreexit0 и real tmpGit/OCI1PASS; финальный HEAD CI отдельно. Список main-only paths:
см. git diff c9625d6..c3cef4b. Это inherited source других владельцев, не новая сфера работ.
Общих собственных adapter/schema/route/DB migrations нет. Не выбирать ours при будущем
conflict; снова читать canonical contracts. Merge в main/deploy не выполняются автоматически.

Исторические integration notes далее.

---

# Repair feedback follow-up, 12 ноября

PR551/source78e516ca4d7a45bf6e7356624b3673649580d2fd; только scoped service/test.
Переиспользован текущий validator/redactor, общий tool-runtime не менялся.
Новых integration adapters/contracts/routes/migrations/capabilities/прав нет.
При новом согласованном repair current check и source_check сохраняют канонический
результат и прежние identity/status/exit fields. Массовой миграции исторических rows нет.
Invalid legacy evidence использует прежний REPAIR_CHECK_REQUIRED/HTTP409.
Откат отдельным revert follow-up, без сброса/повтора reserved attempts.

Предыдущие integration notes ниже.

---

# Context credentials: интеграция, 12 ноября 2026

Draft PR551; source ab53ef4832d3fe79c7441c015fde100edb93a63d.
Только scoped code-agent API, tests и web patch-client message.
Общих contracts/gateway/DB/registration/app/navigation изменений нет; новый
integration commit/миграция не нужны. Ошибка CodeAgentError проходит действующий
error envelope как HTTP409; новых negotiated tools и команд не добавляли.

Поставлять API guard вместе с web объяснением. Проверить CI точного HEAD и актуальный
main перед объединением. Форматы credentials консервативные; пример с похожим ключом
также может быть отклонён. Новый guard не переписывает snapshots и не чистит legacy.
Откат отдельным revert исходного commit, без reset/удаления данных или автоповтора runs.

Исторические integration notes ниже.

---

# Интеграция Coscode: доказательства проверок

Статус первого среза: готово к интеграции. Integration commit
`fcc183d18e9e465e10cbf663636fefa0139028b0`; source
`89ec737afdb35d4446193f51604baefe6388c885`. Проверки см. DELIVERY.

Единственный общий файл — `.github/workflows/ci.yml`: в существующем job
Code sandbox isolation к прежним четырём OCI-тестам добавлен
`test/code-agent-git.oci.test.ts`, тот же image provisioning и `--maxWorkers=1`.
Отдельный integration commit; не менять его на host execution или снятие изоляции.

Contracts/DB/migrations/app registration/gateway/auth/work runtime не меняются.
`validateCodeAgentCheckResult` и `isVerifiedCodeAgentCheck` экспортируются существующим
`export *` code-agent-workspace, без нового API контракта. Код service проверяет
не только новые ответы, но и старые rows перед reuse/publish. Старый `passed`
без exitCode=0/cleanupVerified=true требует новой проверки; это намеренный отказ,
а не миграция или автоматический повтор side effect.

Применить source и integration вместе. Откат — revert integration, затем source;
сохранённые runs/checks/чужие репозитории не удалять. Live publish в целевой репозиторий
по-прежнему требует отдельного разрешения. Сама интеграция его не предоставляет.

## Последующие UI срезы и main

Source5a5e2e4 и30e1944 меняют только Coscode UI/scoped E2E. Дополнительных
общих contracts/регистрации/DB нет. Новый mainf9da6e8 принят в feature-ветку
merge589eb311 после обзора manager-work-store / cloud snapshot acceptance:
требование целостности полного набора checkpoint/artifacts сохранено, legacy
не расширен. Чужие Games/desktop/reports в этом merge не редактировались.
Итоговый tree870f2aaeb5c7c882e2b919ac5a767c0a7afe6963.

## Контекст большого репозитория, 11 ноября

Main5e01c4f принят merge2bbb4aa. Source d467fdb + fixture0591ed1 меняют только
code-agent/API tests, code-agent-diff/runtime tests и локальные сообщения Coscode.
Общий GitHub client (включая response limit8MB), contracts/DB/registration/navigation
не менялись. ПутьTREE_LIMIT для truncated tree сохранён. Новых полномочий нет.

## Поиск путей, 11 ноября

Source4eb1b83: только Code service/helper/scoped tests. search_files — definition
в прежнем gateway-negotiated tools array и обработчик в прежнем6-turn cycle;
не новый public API/tool-runtime registry. Tools-free route не получает definition.
Metadata read использует уже разрешённый immutable index; policy/owner/project
fences, лимиты и budget не расширены. Общие файлы не менялись. Main4b74f26
(канонические отчёты) сохранён mergeb457cf9 без авторских правок.

## Review parent CAS и checkpoint recovery (PR519)

Scoped routes добавляют optional expected_review_hash (hash|null) к review и
invalidate-review. New web pins parent hash; legacy replacement без него denied.
Первый legacy review совместим. API+web поставлять вместе; старый API не принимает
новое поле. Общие contracts/DB/registration не менялись. В source d8290f6 добавлен
явный checkpoint load и file SQLite persistence test. Нового store нет.

## Полное покрытие усечённого tree: отдельный integration commit

Изменён общий `apps/api/src/github-integration.ts`, добавлен scoped
`apps/api/test/code-agent-github-tree.test.ts`. Optional GithubReadScope(signal,
allowed) только сужает существующее чтение. Scope проверяется до/после запроса и
при чтении body; status/file/prepare/branchTree его передают, publish использует
прежний allowed predicate и для metadata reads. Write retry не добавлен.
При truncated recursive response текущий client обходит immutable tree SHA:
<=128 nodes,100k entries,8MB expanded metadata,30s whole deadline; каждый response
по-прежнему <=8MB/15s. Несовпавший SHA, duplicate/path-slip/ancestor-cycle refused;
shared subtrees с разными prefixes допустимы. При неполном child/исчерпании бюджета
возвращается original truncated=true result, не фиктивная полнота.
Общий JSON contract tree остаётся прежним; callbacks не сериализуются в ChangePlan.
Scoped adapter+GitHub+Code96PASS, lint/types exit0. Service binding к существующим
authorityChecks/controller поставляется отдельным scoped commit; без второго runtime.

## One-attempt repair, source3936e5f

Только scoped API/web. `repair_once:1` в GET view разрешает web показать новую
команду; old API без capability не получает POST repair. Optional check_type и
repair_request живут в прежнем run JSON; схема/миграции/DB registration не меняются.
Поставлять API+web вместе. Новых tools registry/общих contracts/gateway permissions
нет; модельная попытка идёт без tools через текущий маршрут и общий ownerBudget.
Возврат proposal требует нового review; старый token отзывается атомарно. Не менять
postflight необратимого GitHub publish на blanket отказ — его reconciliation сохранён.
Общий adapter по-прежнему только отдельный b22b4f3. Новых интеграционных файлов нет.

## Текущий repair protocol v2: source9877f5b +40a3a9e

POST /code-agent/:id/repair-v2 требует positive safe integer expected_run_version.
View capability repair_once теперь2 (0 без бюджета). New web требует2 и валидную
version; cap1/нет capability — команды нет. Legacy /repair не зарегистрирован404,
иначе Fastify старого API мог удалить неизвестное version field и выполнить v1.
Old clients на новом API и new clients на старом API безопасно отказывают. Поставлять
API+web вместе. Source_run_version optional в прежнем run JSON, DB migration нет;
старые attempts не удаляются и не повторяются автоматически. UUID replay требует
тот же source version. Новых common contracts/registration/runtime/gateway нет;
все исходники scoped, общего integration commit сверх прежнего b22b4f3 не требуется.
