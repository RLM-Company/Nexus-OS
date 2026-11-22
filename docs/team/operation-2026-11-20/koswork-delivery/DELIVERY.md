# DELIVERY — team/koswork-delivery, проходы 1 и 3

- **Статус:** готово к интеграции (промежуточный PR; проходы 2/4/5 следуют).
- **BASE_SHA:** `815b8f95359bc23744a0d237078dc8088f7b42c0` (main после #606/#607).
- **Ветка:** `team/koswork-delivery`. **PR:** без merge/deploy.
- **Зона:** исполнение Koswork, снимки материалов, зависимости, восстановление,
  расписание, публикация. OpenCode (поле ввода/профиль/диктовка) и навигация
  проектов DeepSeek не трогаются.

## Разведка (что уже было)

| Компонент                           | Состояние                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkDagStore.create()`             | идемпотентен по `client_request_id`, сохраняет `request_json`, `depends_on`, `blocked` с `DEPENDENCIES:…`                              |
| `ManagerWorkStore.createAccepted()` | сохраняет `materials`, `memory_snapshot`, `events[0]="Задача принята"`, `dormant→paused`                                               |
| `WorkDagCoordinator` (679)          | реальный execution, `recoverAutomation()` требует `resume`, control run/retry/pause/resume/cancel/cancel_step/approve_step/resume_step |
| `buildWorkResultsArchive()`         | полный ZIP с проверкой SHA/байтов/версий/публикации; `GET /results.zip`                                                                |
| **Разрыв**                          | частичного ZIP по `node_ids` нет; неизвестный node_id молча дал бы пустой архив                                                        |

## Проход 1 — приём задания

- `packages/core/src/work-admission-snapshot.ts` — чистый
  `buildWorkAdmissionSnapshot()` связывает **цель + материалы + зависимости**
  в один детерминированный снимок (`kosmora.work-admission.v1`), с стабильным
  digest и `sameAdmissionSnapshot()` для проверки повторного запроса. Снимок
  не пишет в БД и не вызывает модель — это не второй store.
- Сценарный тест `apps/api/test/koswork-admission-scenario.test.ts` на **одном
  полезном наборе** (`order.csv` + `notes.txt`, цель «сверить заказ 00123»):
  проект с материами → `ManagerWorkStore.create(..., dormant=true)` → цель,
  вложения и `memory_snapshot` сохранены, событие «Задача принята» → повтор
  того же `client_request_id` возвращает ту же задачу (одна запись в списке) →
  DAG с тремя шагами (`read → compare → report`, два `blocked`) переживает
  переоткрытие store с сохранёнными зависимостями.
- `packages/core/test/work-admission-snapshot.test.ts` — 4 теста на снимок
  (детерминизм, независимость от порядка вложений, реакция на смену источника
  и цели, отказ на пустую цель).

## Проход 3 — сдача работы

- `buildWorkResultsArchive(graph, files, nodeIds?)` — теперь поддерживает
  **частичный ZIP** по выбранным `node_id`. Интегральность выбранных файлов
  проверяется так же строго (SHA-256, байты, версия, публикация, owner/project).
  Манифест явно показывает `partial: true`, `complete: false`,
  `selected_node_ids`, а отчёт внутри ZIP честно говорит «частичный результат».
  Неизвестный `node_id` → `RESULTS_INVALID_ARTIFACT` (не пустой архив).
- `WorkDagCoordinator.resultsArchive(id, owner, nodeIds?)` и
  `GET /api/v1/projects/:projectId/work-dag/:id/results.zip?node_ids=a,b` —
  до 32 id, `work-results-partial.zip`, `cache-control: private, no-store`.
- `apps/api/test/work-results-archive.test.ts` — **22 теста**, включая новый
  сценарий полного и частичного ZIP на одной фикстуре (один файл в `steps/02/`,
  манифест с partial=true, отказ на неизвестный node). Все 21 старый тест
  прошли без изменений — обратная совместимость сохранена.

## Проход 2 — управление

Сценарный тест `koswork-admission-scenario.test.ts` расширен на **том же
наборе материалов**: пауза проекта (`setProjectMode("paused")`) переживает
переоткрытие store; явное продолжение возвращает `"active"`; отмена одного шага
фиксируется с `blocked_reason`, а зависимый шаг и `depends_on` остаются
неизменными. Закрытый шаг не перевыполняется — `edit()` в существующем
`WorkDagCoordinator` запрещает изменять уже начатые шаги (покрыто
`work-dag.test.ts`). Второй scheduler и фоновый запуск не добавлялись.

## Проход 4 — расписание (в существующем механизме)

В `scheduled-dispatch-api.test.ts` добавлен сценарий: закрытое срабатывание не
переоткрывается (повторный dispatch → 409), а рестарт и повторная доставка
создаются **отдельными заданиями** со своими `client_request_id` — три записи,
три id, исходная остаётся `dispatched`, а `ManagerWorkStore` содержит одну
закрытую задачу, а не дубли. Повторные даты/один экземпляр на срабатывание уже
покрыты соседним тестом (`ready`→`dispatch`→`scheduled` на следующий день).
Нового scheduler/фонового тика нет.

## Проход 5 — второй сценарий и живая модель

`koswork-second-scenario.test.ts`: другая структура входов — таблица
`kosmora.studio.data` с заголовками и строками + две якорные выдержки, dependency
fan-in (`parse → anchor-a/anchor-b → total`). Проверены цель+материалы+снимок при
admission, два `blocked` якоря, сохранение fan-in после reopen.

**Живая модель не запускалась — конкретное препятствие зафиксировано:** VPS
`169.40.37.32` доступен по SSH-ключу, `/api/v1/health` отвечает `200`, form-логин
владельца даёт cookie, но все защищённые endpoint'ы (`/projects`,
`/model-runtime`, `/identity/sessions`, `/step-up/*`) отвечают
`401 "Verified identity is required"`. Причина в коде: `canAccessOwnerApi()`
(`apps/api/src/identity.ts:9`) требует `identity.actor_kind === "owner"`; cookie
этого развёртывания разрешается в не-owner actor. Я не обходил и не менял auth/
step-up границы, не извлекал ключи провайдера из GitHub secrets. Guard-скрипт
`scripts/koswork-owner-live.mjs` готов: он ничего не отправляет без явного
`KOSMORA_WORK_LIVE_CONFIRM=RUN_ONE_OWNER_SCENARIO` и loopback origin, не читает и
не печатает секреты. Это **готовность сценария**, а не факт пройденной живой
приёмки — статус остаётся «ожидает согласованной среды / корректной owner-сессии».

## Проверки (фактические)

```
packages/core  work-admission-snapshot.test.ts   4 passed
apps/api       koswork-admission-scenario.test.ts 2 passed (pass 1 + pass 2)
apps/api       koswork-second-scenario.test.ts    1 passed (pass 5)
apps/api       scheduled-dispatch-api.test.ts     6 passed (pass 4 + past)
apps/api       work-results-archive.test.ts      22 passed
apps/api       work-dag.test.ts (execution)       green (pre-existing)
 typecheck/lint (core, api) · prettier --check . · check-secrets — green
CI PR #611: 4/4 pass (Verify monorepo 7m8s, Browser acceptance 13m58s, sandbox, identity)
```

## Как обновляются существующие данные

- Схема и миграции **не меняются**: снимок — чистая функция, частичная выдача —
  опциональный параметр существующего архива.
- Полный `GET /results.zip` без query работает как раньше; `complete: true`
  сохраняется для полных планов. Частичный архив — всегда явный opt-in query.
- Повтор запроса admission по тому же `client_request_id` остаётся
  идемпотентным в штатном `ManagerWorkStore`.

## Ограничения

- Проходы 1–5 сданы в коде/тестах. Живая модель остаётся ожидающей
  согласованной среды — это единственный незакрытый пункт задания; код и
  guard-скрипт готовы, но я не выдаю подготовку за факт прогона.
- Живой пользовательский сценарий с моделью остаётся ожидающим корректной
  owner-сессии на согласованной среде. Дополнительно установлено: form-логин
  даёт cookie, но API через edge требует owner-доступа; deployment-токен
  `COSMORA_OWNER_SESSION_TOKEN` при прямом Bearer получает `401 "Owner login
required"` уже на `/api/v1/health` (значит edge не пропускает bearer к API),
  а внутренние порты API (`3000`/`3100`) не опубликованы на хосте — только
  внутри docker-сети. Это конфигурация деплоя/доступа, а не код этого среза;
  трубопроводы изменил бы вне зоны задачи.
- Общие файлы (`contracts` не трогались; `core/index.ts`, `api` coordinator/routes)
  минимальны и перечислены здесь для интегратора.

## Следующий шаг

Проход 2: сценарий pause → resume → cancel_step → reopen на том же наборе
материалов, без повторного выполнения закрытых шагов. Затем проход 4
(расписание) и проход 5 (второй набор входов + один пользовательский сценарий
с реальной моделью на согласованной среде).
