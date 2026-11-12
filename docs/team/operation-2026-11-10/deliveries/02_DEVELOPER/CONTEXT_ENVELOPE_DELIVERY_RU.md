# Coscode: известные credentials в метаданных и финальном messages

12 ноября 2026, ID 02_DEVELOPER. **Готово к интеграции**, продолжение
[Draft PR551](https://github.com/RLM-Company/Nexus-OS/pull/551).
Ветка `ops/developer-coscode-context-secrets-2026-11-12`.
BASE_SHA `ffc794ce3b377eac32a460283fd12c3075f53805` — CI43247327193 и
identity43247327083 SUCCESS с первой попытки, включая5OCI. Предыдущая приёмка
была завершена до начала этого среза. Main1c07f8d остаётся в ancestry.
SOURCE_HEAD_SHA `b764ac26a5bc061167680a8d5782a77848165adc`.
SOURCE_TREE `400edb998153f15af6bb7d6d5dc2a02b01c6fb1c`.
Локальный source de331ec имеет то же дерево; финальный SHA с handoff — в PR history.

## Подтверждённый пробел и работающий путь

Read-only probe показал, что обычный safe path filter принимал имя файла с
искусственным GitHub token и selectCodeTreePaths включал его в model-visible tree.
Чтение содержимого такого файла вообще не требовалось. Четыре actual-service
регрессии подтвердили наличие искусственного токена в захваченном provider request:
filename metadata, task, issue и task исторического repair. Это не гипотеза о модели.
Реальный провайдер не вызывался; captured request обслуживал fixture fetch.

Entrypoint остался прежним: /code-agent → selected task/issue/files → existing
service/tree/read/tools → request → текущий ModelGateway. Repair использует прежний
repair-v2 с отдельным consent/version check.

Теперь API-private isSafeCodeContextPath дополняет существующий path guard теми же
известными credential formats. Он применяется в selection/validFiles/legacy context
и search; prompt files тоже проверяются. Поэтому безопасное задание продолжается,
а имя с ключом исключается из tree/list/search и не читается. Общий diff/path engine
не менялся; canonical existence index сохраняется для конфликтов непрочитанных файлов.

Один финальный guard проверяет сериализованный **messages** до route reservation и
model dispatch. Это task/issue/repository/tree/tool messages, включая legacy repair.
Известный ключ вызывает прежний CONTEXT_CONTENT_FORBIDDEN без provider call/нового
model_run_id. Для repair отказ происходит до записи попытки; исходный check/run/version
и согласие не подменяются. Новых автоматических повторов нет.

Задача, issue и исходник не переписываются/не маскируются. UI использует существующий
error mapping с уточнением, что проверить надо задачу, issue и выбранный снимок.
Новых команд, tools/capabilities, полей wire contract, маршрутов, схем и миграций нет.

## Файлы

- apps/api/src/code-agent/proposal-input.ts: общий внутри модуля predicate форматов,
  safe context path, prompt/search gates.
- apps/api/src/code-agent/service.ts: safeCodePath alias и final messages check.
- apps/api/test/code-agent.test.ts:4 end-to-end orchestration regressions.
- apps/api/test/code-proposal-input.test.ts:3 search/prompt/name preservation cases.
- apps/web/src/app/code-agent/patch-client.ts: только текст прежнего отказа.
- Собственный report/backlog/checkpoint/evidence в 02_DEVELOPER.

Общих registration/contracts/gateway/DB/tool-runtime/work-runtime изменений нет;
integration commit не нужен. Провайдер/квоты/цены/права/изоляция и UI layout не менялись.

## Фактические проверки

- Baseline:4FAILED, actual captured model request содержал искусственный токен.
  Проверялось boolean includes, значения ключей не печатались.
- После fix focused4PASS,102 filtered/not run.
- Scoped Code/context/tree/GitHub157PASS+1opt-inSKIP; web adapter4PASS.
- Full check:core **exit0**: API1077PASS+1SKIP, web363PASS; остальные types/lint/
  format/secrets/build/privacy/profile gates прошли; неизменённые шаги могли идти из cache.
- Свежий real temporary Git/API/OCI repair1PASS,105 filtered/not run. Node реально
  исполнился: failed exit1 → fixture model edit → passed exit0; cleanup verified.
  Git apply/index/readback совпали с proposal, README00123 остался нетронут.
  Модель/GitHub — fixtures; source/code/runtime действительно читают и сохраняют данные.
- Scoped lint/secrets/diff passed. Финальный HEAD CI проверяется отдельно;
  зелёный CI базового ffc794c не выдаётся за проверку нового source.

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-proposal-input.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts --maxWorkers=2
pnpm --filter @cosmora/web exec vitest run src/app/code-agent/patch-client.test.ts
pnpm check:core
CODE_AGENT_TEST_IMAGE=sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73 CODE_AGENT_TEST_EXECUTABLE=/usr/local/bin/docker CODE_AGENT_REPAIR_REPORT_DIR=/tmp/coscode-envelope-new-output pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t 'real OCI API repair' --maxWorkers=1
```

На этом стенде использованы already installed pinned dependencies, pnpm с
`pnpm_config_verify_deps_before_run=''`, существующий Docker binary/image. Endpoint/TLS
selectors убраны только для managed local daemon; config/credentials не менялись.
Новых установок, host shell с расширенными правами, foreign publish, owner-PC/VPS/deploy нет.
В fixtures/context-envelope-2026-11-12/ — stdout, фактические OCI inputs/review/output/
patch/receipt, exit codes и hashes. Изображения/pseudocode вместо source не использовались.

## Точные ограничения

Это detection известных форматов, а не универсальный DLP: неизвестные/encoded/разбитые
ключи или произвольные пароли могут быть не распознаны. Provider authentication headers
не являются messages; конфигурация и авторизация провайдера не менялись. Source/context
с похожими тестовыми токенами также может быть отклонён.

Owner-scoped task/issue и private tree metadata в canonical store сохраняются по
существующему privacy lifecycle. Это не очистка данных at rest и не массовая миграция
старых rows/model-output checkpoints. Не утверждаем, что всё хранилище свободно от ключей.
Новый guard предотвращает отправку распознаваемых literal credentials в model context.
Самостоятельная работа с реальной моделью не принята live: ИИ API отложен владельцем.
Sandbox по-прежнему Node syntax/node-test; arbitrary install/build/shell не добавлен.

Дальше — exact final HEAD CI и review. Откат отдельным revert source commit, без reset
main/удаления чужих файлов/автоматического повторения неопределённых side effects.
