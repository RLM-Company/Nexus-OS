# Kosmora: HTTP executor и общий бюджет Code

База полного патча: `b15912d23ab15a99e38370e22e472faf28c99961` (точные байты переданного tracked-архива). Обновление продолжает ранее принятый `kosmora-code-agent-b15912d-files.zip`; оно сохраняет законченные функции Code. Windows, общие миграции, schema.ts, зависимости и lockfile не изменялись.

## Реализовано

* Настоящий HTTP OCI sidecar и API client. API не запускает процессы и не получает daemon socket; старые переменные локального OCI запуска больше не включают executor в API.
* Авторизация отдельным внутренним bearer из secret-файла, constant-time сравнение. HTTP job API: PUT/GET/DELETE `/v1/jobs/:uuid`. PUT идемпотентен по ID + digest + check; повтор с другим snapshot запрещён. Нельзя передать команды, image, URL, env, mount, лимиты или runtime в задании.
* Snapshot копируется до await, валидируется и хешируется. Sidecar передаёт обычные readonly файлы через PAX tar и `docker cp` до start. В пользовательском контейнере нет host mounts, Docker socket, server env/PAT/model tokens. Обычные Unicode/длинные пути сохраняются; symlink/device/traversal entries не создаются.
* Фиксированные `syntax` и `node-test`. Pin локального immutable OCI образа; `--pull=never`, `network=none`, readonly rootfs и snapshot, UID/GID 65534, cap-drop ALL, no-new-privileges. По умолчанию CPU 1, RAM/swap 256 MiB, pids 64, timeout 30 секунд (максимум 120), общий stdout/stderr 128 KiB, bounded tmpfs. Командные строки, npm lifecycle и команды модели не исполняются.
* Превышение вывода останавливает job. ANSI/control sequences, типовые токены, bearer, private keys и значения credential-полей редактируются; редактированный stdout/stderr также ограничен. Это ограничение распространённых форматов, не классификатор всех возможных секретов.
* DELETE ждёт остановки runner и daemon cleanup, CLI process group убивается. Неподтверждённая очистка quarantines runner и сообщает unavailable; ошибка transport не доказывает успешную остановку. Sidecar всё равно сохраняет собственный deadline. При старте sidecar удаляет оставшиеся контейнеры со своим фиксированным label; если daemon/очистка недоступны, сервис не принимает задания.
* 2 одновременных задания, максимум 64 retained job records, completed jobs TTL 10 минут; request body 3.2 MB, request/header deadlines, bounded HTTP response. Неопределённый PUT не отправляется повторно: клиент пытается DELETE с тем же ID.
* Проверка привязана к точному merged snapshot digest и review_hash. Начало любой повторной проверки сразу удаляет прежние результат и publication_token. Изменение diff аннулирует проверку; публикация повторно сверяет digest и cleanupVerified. Cancel/check errors позволяют повторить ту же сохранённую проверку с новым подтверждением. Неподтверждённый PR нельзя повторно публиковать; прежняя read-only reconciliation сохранена.
* Общий бюджет через необязательный `ownerBudget: CodeOwnerBudget`, структурный интерфейс для AccountStore. Code не хранит balances/reservations и не добавляет второй счётчик. Резерв до продолжения gateway после route.selected; отказ предотвращает provider HTTP. Второй автоматический route attempt блокируется до dispatch.
* Успешная completion сначала записывается через ProjectStore.completeRun в канонический usage ledger, затем ownerBudget.reconcile получает именно эти строки. Неизвестные токены/стоимость, cancellation и failed dispatch должны сохранять резерв. Release разрешён только при доказанной локальной ошибке до продолжения gateway. После restart onReady повторяет идемпотентную reconciliation сохранённых Code model run IDs; ни модель, ни GitHub повторно не вызываются.
* UI показывает токены/подтверждённые расходы из ledger, неизвестные запросы и отсутствие общего бюджета; появились русские объяснения unavailable/timeout/cancel и повтор проверки. Цветовая схема прежняя, чёрно-белая.
* CheapVibeCode/gpt-5.5 по-прежнему `tool_calling=false`. Текстовые proposal/выбор файлов работают через настоящий adapter и strict JSON workflow; Registry capabilities не изменены.

## Контракт AccountStore / Manager

В переданном `b15912d` нет AccountStore, поэтому его реализация не выдумана. Подключите тот же экземпляр общего owner budget, которым пользуется Manager, в `buildApp({ ..., ownerBudget })`. Структурные методы определены в `apps/api/src/code-agent/owner-budget.ts`:

| Метод | Вход и обязательное поведение |
|---|---|
| reserve | `{ownerId, runId, attempt, projectId, route}` → boolean/Promise; атомарная durable reservation по ключу owner/run/attempt. `route` содержит верхние оценки токенов и стоимость/валюту либо null. Неизвестную цену разрешать только согласно общей owner policy, не считать её нулевой. |
| reconcile | `{ownerId, runId, attempt, ledger}` → void/Promise; ledger — канонические StoredModelUsage[]. Повтор безопасен. Не создавать резерв для отсутствующего/отклонённого ключа, не восстанавливать уже доказанно released ключ. Unknown usage/cost и failed/cancelled rows удерживать, не освобождать по одному статусу run. |
| releaseBeforeDispatch | `{ownerId, runId, attempt, reason:'local_before_dispatch'}` → void/Promise; идемпотентное освобождение только с этим доказательством. |

Если AccountStore использует другие имена/сигнатуры, главный чат добавляет тонкий adapter к этим трём вызовам, сохраняя существующий единственный owner ledger/счётчик. Нельзя создавать новую таблицу бюджета ради Code. Без этого optional port работает прежний project Usage Ledger, но общего ограничения владельца нет; UI показывает это явно. Для ежедневного hosted режима главный чат обязан передать общий AccountStore.

AccountStore должен сохранять reservations до отправки, переживать process crash и уметь сверять их с каноническим ledger. Code не может доказать отсутствие dispatch после падения процесса; такие резервы остаются удержанными до общей reconciliation. Provider balance units не переводятся в деньги и не подменяют usage tokens.

## Применение патчей

В ZIP находятся реальные файлы с путями репозитория, полные и incremental patches, manifest и этот отчёт. Выберите один вариант:

```bash
# На исходном b15912d — весь Code, включая предыдущий пакет:
git apply --check kosmora-code-executor-budget-b15912d-full.patch
git apply kosmora-code-executor-budget-b15912d-full.patch

# На точно принятом предыдущем Code-пакете — только это обновление:
git apply --check kosmora-code-executor-budget-upgrade-feature.patch
git apply kosmora-code-executor-budget-upgrade-feature.patch
git apply --check kosmora-code-executor-budget-upgrade-integration.patch
git apply kosmora-code-executor-budget-upgrade-integration.patch
# Вместо пары можно один upgrade.patch. Не применять оба варианта одновременно.
```

Минимальный integration patch обновления содержит только `apps/api/src/app.ts` и `packages/tool-runtime/src/index.ts`. Полный b15912d integration patch также включает прежние восемь общих файлов из первого пакета. Если главный checkout уже менялся параллельно, переносите hunks общих файлов вручную; не заменяйте app.ts целиком из ZIP. Manifest фиксирует SHA256 предыдущих и итоговых исходников. Новые файлы входят в unified diff.

## Запуск оператором (не выполнялся в этой среде)

Нужен отдельный доверенный OCI executor host/daemon. Стандартный override использует socket только в sidecar; пользовательский контейнер не получает socket. Сам sidecar является доверенным runtime-компонентом, а не модельным tool с произвольным shell. Не запускайте его от имени публичного edge-сервиса и не добавляйте ports/proxy route; сеть `code_executor` internal и доступна API + sidecar. Compose sidecar стартует root для доступа к daemon socket, пользовательские jobs всегда non-root. Для усиленной инфраструктурной изоляции используйте выделенный daemon/worker host; границу доверия daemon socket невозможно заменить обещанием приложения.

1. Подготовьте локальные проверенные immutable build images Node 24 и Docker CLI, совместимый с версией daemon, а также отдельный чистый job image без application code/секретов. В `check-image.Dockerfile` только Node base, WORKDIR и non-root USER. Нельзя использовать application runtime image с production конфигурацией как job image.
2. Укажите `CODE_AGENT_OCI_CLI_IMAGE` и `CODE_AGENT_BUILD_NODE_IMAGE` как immutable локальные build image references. Не подставляйте плавающие tags в hosted rollout. Dockerfile не содержит автоматически выбранной устаревшей daemon CLI.
3. Постройте job image из уже проверенного локального Node base:

```bash
docker build --pull=false --build-arg NODE_IMAGE=sha256:<approved-node-image-id> \
  -f deploy/code-agent/check-image.Dockerfile -t kosmora-code-check:local .
docker image inspect --format '{{.Id}}' kosmora-code-check:local
# CODE_AGENT_SANDBOX_IMAGE — полученный sha256:<64hex>, не tag.
```

4. Оператор предоставляет отдельный внутренний secret-файл `deploy/alpha/private/code-executor-token`, 32–256 base64url/hex символов. Не использовать модельный API-key, PAT, owner password или внешнюю session bearer. Код не изменял ни одного ключа/secret. Файл исключён действующим .dockerignore, передаётся только как compose secret API/sidecar и никогда job-container. Не помещайте token в frontend env или ZIP.
5. После согласованной проверки/configuration, главный чат выполняет rollout; здесь команд к VPS не было:

```bash
docker compose -f deploy/alpha/compose.yaml -f deploy/code-agent/compose.override.yaml config --quiet
docker compose -f deploy/alpha/compose.yaml -f deploy/code-agent/compose.override.yaml build code-executor
docker compose -f deploy/alpha/compose.yaml -f deploy/code-agent/compose.override.yaml up -d code-executor api
```

Relative secret/build paths разрешаются от первого compose файла, `deploy/alpha`. Не добавляйте model.env/GitHub env_file в sidecar. Для private HTTP нужен изолированный network segment; для отдельного worker через иной network segment используйте trusted fixed HTTPS endpoint. URL/client credentials задаются оператором, не моделью/HTTP task payload; redirect запрещён. При IP/host конфигурации API нельзя разрешать пользовательский выбор origin.

## Настоящий smoke

Smoke script не имеет fixture fallback и требует настоящий daemon и существующий immutable Node image. Он не тратит модельные средства, не делает GitHub writes и не делает image pulls. Запускать в отдельном daemon namespace без других текущих Code jobs (скрипт проверяет отсутствие любых контейнеров со своим label):

```bash
pnpm --filter @cosmora/tool-runtime... build
CODE_AGENT_TEST_IMAGE=sha256:<local-approved-image-id> \
CODE_AGENT_TEST_RUNTIME=docker node deploy/code-agent/smoke.mjs
# Для Podman: runtime=podman; при необходимости CODE_AGENT_TEST_EXECUTABLE=/absolute/path.
```

Проверяет failing bug → fixed snapshot; реальный HTTP; non-root/read-only/no socket/no inherited secret env/no network; timeout; cancellation с потомком; flood limit; redaction; отсутствие живых/остановленных job containers после cleanup. Node image должен поддерживать native node:test; произвольные pnpm/vitest/tsc dependency pipelines не добавлены. Полная тестовая поддержка monorepo с зависимостями требует отдельного проверенного image/preset, без произвольных lifecycle scripts/команд.

## Rollback

* Прекратить новые проверки и дождаться завершения/подтверждённой отмены текущих jobs. При неизвестной очистке проверять label на выделенном daemon, не объявлять pass и не публиковать PR.
* Остановить sidecar; SIGTERM отменяет jobs и ждёт cleanup. Проверить отсутствие label `kosmora.code-executor=true` с operator OCI CLI. При аварийном kill следующая загрузка sidecar выполняет reconciliation orphan containers до listener.
* Пересоздать API из базового compose без override; HTTP executor не настроен → unavailable. Старый результат нельзя использовать после начатого retry: token/check уже аннулированы.
* Не откатывать/очищать usage ledger и owner reservations, не повторять неизвестную PR publication. Для возврата исходников применить соответствующий patch reverse только после проверки отсутствия чужих пересекающихся изменений. Старый локальный API runner не возвращать в hosted API.

## Выполненные проверки

| Проверка | Результат |
|---|---|
| pnpm typecheck | PASS, 9 пакетов |
| pnpm lint | PASS, 9 пакетов; финальное локальное изменение cap/body также проходит tool-runtime lint |
| pnpm test | PASS: 651 тест, 3 настоящих OCI tests SKIPPED; после финальной корректировки redacted-output cap/body limit повторно проверен изменённый tool-runtime |
| Code API / SQLite / Policy / gateway / GitHub deterministic transport | 23/23 PASS (включены 5 owner-budget/retry сценариев, прежние 18 Code тестов сохранены) |
| Полный apps/api test | 159/159 PASS |
| Tool-runtime | 37/37 PASS: прежние runtime/OCI CLI boundary tests плюс 8 новых настоящих HTTP/archive/redaction проверок; OCI daemon в этих тестах не запускается |
| Build | PASS, 9 пакетов, `/code-agent` в production routes; первая попытка имела internal Turbopack cache panic, повтор с чистым generated cache прошёл. Финальный tool-runtime build повторён после cap/body limit |
| Formatter | PASS для всех изменённых TypeScript/TSX/MJS/YAML; Dockerfile не поддерживает parser Prettier и им не проверяется |
| node --check | PASS sidecar.mjs и smoke.mjs |
| pnpm check:secrets | PASS |
| YAML/security shape | PASS: internal network; sidecar без public ports; API override без volumes/socket. Настоящий docker compose config/build здесь не выполнялся |
| Patch verification | Полный b15912d и incremental feature+integration patches применены к соответствующим точным baseline; итоговые файлы проверены побайтно (manifest) |

Не запускались: платные модели, реальные GitHub writes/PR, VPS/rollout, OCI контейнеры, browser acceptance. В среде отсутствуют docker и podman. Поэтому настоящий OCI isolation/cancellation/daemon restart и сборка sidecar image не объявлены production-проверенными. Browser UI acceptance также остаётся главному чату; React/Next typecheck/build пройдены.

## Главному чату

Подключить общий AccountStore/ownerBudget без второго счётчика, сверить его unknown-cost policy и идемпотентность; перенести два минимальных integration hunks; подготовить dedicated daemon/проверенные immutable images/internal secret; выполнить OCI HTTP smoke и restart/orphan cleanup; выполнить compose config/build и браузерный сценарий unavailable → retry → check → explicit draft PR в согласованной среде. Публикация и расходы по-прежнему требуют существующих продуктовых разрешений. Ни один такой внешний эффект здесь не выполнялся.
