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

Живой прогон модели остаётся открытым. 22 ноября форма входа и защищённый API
прошли проверку с обновлённой служебной owner-сессией на `169.40.37.32`.
Развёрнутый API `84ad2283be03` и web `d6307e9c9fdf` предшествуют этому пакету.
Для прогона нужен актуальный кандидат в согласованной среде.

`scripts/koswork-owner-live.mjs` ограничен loopback и требует явной настройки
`KOSMORA_WORK_LIVE_CONFIRM=RUN_ONE_OWNER_SCENARIO`. После приёма задачи API
может сразу запустить модель. Укажите тестовый проект через
`KOSMORA_WORK_LIVE_PROJECT` и при необходимости задайте временный bearer через
`KOSMORA_WORK_OWNER_BEARER` в окружении процесса. Укажите постоянный идентификатор
прогона в `KOSMORA_WORK_LIVE_REQUEST_ID` и используйте тот же ID при повторе после
сетевого сбоя. Скрипт отправляет одну задачу,
наблюдает её состояние и при успешной проверке критиком скачивает `result.md`.
В отчёт попадают время, число запросов модели, размер и SHA-256 файла.
Ожидание подтверждения или пауза требуют решения владельца.

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
- На VPS подтверждён ежедневный таймер резервных копий. Таймер продления
  owner-сессии не найден. Доступ через форму проверен, сессия истекает
  28 ноября в 22:29 по Москве.
- Общие файлы (`contracts` не трогались; `core/index.ts`, `api` coordinator/routes)
  минимальны и перечислены здесь для интегратора.

## Следующий шаг

Проверить пользовательский сценарий с реальной моделью на актуальном кандидате
в согласованной среде. Зафиксировать итоговый файл, результат проверки и расход.
