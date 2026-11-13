# Продолжение приёмки, 13 ноября 2026

Ветка `fix/chat-draft-e2e-diagnosis-2026-11-12`, Draft PR558.
Main9f79c6d сохранён отдельным merge ff51c4f, tree191159c5.
Контракты chat/CodeAgent/executor не изменились; чужие изменения не переписывались.
Предыдущий HEAD289dce7 имеет CI43272293412 SUCCESS; это не CI нового кандидата.

Проверена конкретная гипотеза влияния настроек: пять свежих fixture-баз,
два workers, три сценария в каждом прогоне,15PASS/retries0. Research13PASS,
CI-gate regression1PASS. Исходная ошибка чата не воспроизвелась;
причина по-прежнему не установлена, в runtime предположительных правок нет.

Детали: [CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md](CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md).
Следующий шаг — exact final HEAD CI, затем каноническая интеграция по разрешению.
Не создавать новые функции ради продолжения и не повторять неизменённые прогоны:
для дальнейшего runtime-исправления нужен воспроизводимый отказ/error_code/trace.
Без merge/deploy, живой модели, новых разрешений или изменения квот владельца.

Предыдущая история ниже.

---

# Анализ flaky chat и исправление контроля CI, 12 ноября 2026

Ветка `fix/chat-draft-e2e-diagnosis-2026-11-12`, база main33f43b8.
Source33f6014, отдельный CI integration49876e6. Подробности:
[CHAT_FLAKE_DIAGNOSIS_RU.md](CHAT_FLAKE_DIAGNOSIS_RU.md).

Подтверждено и исправлено: flaky после retry больше не даёт зелёный CI;
trace/diagnostics сохраняются и при recovered outcome; тест отправки пишет
HTTP/error_code и безопасные terminal metadata. Таймауты и assertions не ослаблены.

Первопричина исторического «Ошибка запуска» пока не подтверждена: отдельно10/10,
в mixed run целевой тест тоже прошёл. Mixed run остановлен на Games file:// policy:
160PASS,1FAIL,1interrupted,328not run; полный успех не заявляется.
После fix chat16/16 без retry, web363 +10 studio checks, types/lint passed.
Дальше: проверить exact final HEAD CI; при повторе читать сохранённый trace/error_code.
Даже при полном PASS не объявлять первопричину исторического chat сбоя исправленной.
Без merge/deploy, живой модели, изменения тарифов/квот/прав/браузерной политики.

Предыдущая история ниже.

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
