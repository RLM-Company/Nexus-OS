# Koswork: учёт завершённых запросов при пустом ответе

9 ноября 2026, Москва. Продолжение Work reliability в ветке
`developer/koswork-admission-reliability`, PR #479. Проверенная база продолжения:
`df3db9e67c4da4b248f1062175e22af2b74b4579`; main на старте:
`08f865f6362d3045438d6ca7f93be8e9e56e1e6c`.
Объём соответствует пункту «Фоновые задачи/бюджеты» согласованного плана Ruflo.

## Было и стало

Действующий пользовательский путь сохранён: создание Work → существующий
ManagerWorkCoordinator → provider → canonical project usage ledger → owner account
summary → статус Work и доступные файлы. Новый API/исполнитель/журнал денег не создан.

Если provider завершал поток с `response.completed` и usage, но текст был пустым,
`model()` отклонял текст до `completeRun()` и `completeReservation()`. Задача верно
становилась failed, однако доставленные input/output counts терялись, ledger
становился failed с null counts, а баланс продолжал учитывать верхнюю оценку.
Для непустого, но невалидного JSON usage уже учитывался до отказа в содержимом:
пустой ответ был несогласованным исключением.

Теперь наличие completion проверяется раньше, а пригодность текста — после
канонического учёта. Известный usage фиксируется независимо от качества ответа.
Успешный provider transport **не означает** успешную Work: пустые plan/draft/review
по-прежнему дают `INVALID_MODEL_OUTPUT`, без публикации файла и автоматического
повторного модельного вызова. Успешно переданная в account receipt не переводится
повторно в uncertain при последующем отказе в содержимом.

Owner hold освобождает прежний AccountStore только при достаточных подтверждённых
canonical counts/cost/currency. Частичные/null counts остаются такими же, стоимость
не выдумывается, верхняя оценка и uncertain hold сохраняются. Настройки тарифов,
лимиты owner/project, правила принятого Work-бюджета и fallback не менялись.

## Исходники и интеграция

- `apps/api/src/manager-work-coordinator.ts`: общий исходник изменён отдельным
  интеграционным коммитом `c2a4cc31b244b10253e5a506a108c870b86ba07c` —
  8 добавленных строк, 3 заменённые. Регистрация active slot из первого пакета сохранена.
- `apps/api/test/manager-work.test.ts`: существующий provider fixture получил
  stage-specific chunks и nullable usage. Добавлены восемь регрессий:
  пустые plan/draft/review, полностью известные нули, три сочетания null counts.
  Тестовый коммит: `ef4311c8d3499386b4ee85983ca9a75817fc7e34`.
- Входной бриф повторно использует `apps/api/test/fixtures/manager-admission.json`.
- `docs/handoff/fixtures/koswork-metered-replies/result.json`: настоящий readback
  Work, canonical ledger, account summary и ответа file API.

Контракты/routes/миграции не требуются: используются существующие completion,
ledger и error code. Новый реестр инструментов и дублирующее хранилище не добавлялись.

## Воспроизведение и результат

```sh
KOSWORK_METERED_REPORT_DIR=/tmp/koswork-metered-new \
  pnpm --filter @cosmora/api exec vitest run test/manager-work.test.ts \
  -t 'Work metered invalid replies'
pnpm check:core
```

Отдельный каталог отчёта должен не содержать result.json: запись использует `wx`.
Без переменной окружения выполняются те же проверки без дополнительного файла.
Тест читает настоящий бриф, проводит локальный provider через полный Manager
pipeline, сохраняет состояние и usage в SQLite, читает Work через Fastify API,
затем проверяет отказ file download. Это не подмена результата словами модели.

Приложенный readback:

- request goal содержит `19 700 ₽`, `00123` и «кроме доставки»;
- provider ответил whitespace и сообщил 100 input + 100 output tokens;
- один вызов **локального provider fixture**, настоящая модель/HY4 не вызывались;
- Work: failed / plan / INVALID_MODEL_OUTPUT;
- ledger: committed, counts 100/100; account counted tokens: 200;
- file download: настоящий HTTP 404; артефакт не выдаётся как созданный;
- агрегат `currency_cost` остался `unknown`, как в существующем account summary.
  Отчёт подтверждает учёт токенов, а не конвертацию цены в общую валюту.

На базе df3db9e все восемь новых регрессий реально упали до исправления. После
изменения source: **8/8 PASS**; 70 остальных тестов в целевом запуске были skipped
по фильтру и не названы прошедшими этим запуском. Варианты null подтверждают
сохранение верхней оценки/uncertain после создания нового AccountStore. Повторный
execute failed-задачи не добавляет вызовы, а plan/draft/review не публикуют файл.

Полный `pnpm check:core`: **PASS, exit 0**. API: 928 PASS, включая все 78
Manager Work; web: 263; contracts: 206; core: 386; db: 160; model-gateway: 151;
policy-engine: 43; config: 17; tool-runtime: 63 PASS/4 OCI skipped. Прошли format,
secret scan, lint/typecheck, package tests, корневые guards, production builds,
privacy и compatible-profile fixture smoke. Четыре OCI-теста локально не исполнялись.
Внешние checks текущего опубликованного head проверяются отдельно в PR #479.

## Границы и откат

Счётчики учитываются только из принятого полного completion. Отмена/провал
транспорта без него по-прежнему оставляет консервативный неопределённый расход;
фоновая попытка не переиздаётся. Использованы синтетические данные и mock provider.
Реальная модель, production и ПК владельца не проверялись/не изменялись. UI,
native desktop, installer и browser/** не менялись.

Первый пакет старта Work остаётся в том же PR; его история и отдельный readback —
в [передаче admission](TEAM_KOSWORK_ADMISSION_DELIVERY_RU.md). Точный финальный SHA
и внешние CI checks относятся к текущему head PR #479, а не к прежней базе df3db9e.

Для отката только этой логики: `git revert c2a4cc31b244b10253e5a506a108c870b86ba07c`,
затем удалить восемь относящихся к ней регрессий при полном откате пакета.
Это возвращает потерю usage на пустом ответе. Схема данных не менялась;
существующие accounting rows, принятые Work и файлы удалять не требуется.
Merge PR/deploy исполнителем не выполнялись.
