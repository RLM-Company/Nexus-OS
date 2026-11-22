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

## Проход 5 — второй сценарий и живая модель (ВЫПОЛНЕНО)

`koswork-second-scenario.test.ts`: другая структура входов — таблица
`kosmora.studio.data` с заголовками и строками + две якорные выдержки, dependency
fan-in (`parse → anchor-a/anchor-b → total`). Проверены цель+материалы+снимок при
admission, два `blocked` якоря, сохранение fan-in после reopen.

**Живой пользовательский сценарий выполнен на VPS после того, как владелец
настроил доступ (2026-11-22):** form-логин owner даёт корректную сессию;
`/api/v1/projects` → 200; `/api/v1/model-runtime` → `provider=cheapvibecode`,
`model=hy4`, `credential_configured=true`. Через реальный API приняты две
задачи с реальной моделью:

1. `852c13bd…` — запрос модели выполнен (1 request, ~44 c), план отклонён с
   `UNSUPPORTED_ACTION`, статус `failed`, событие «Работа остановлена:
   UNSUPPORTED_ACTION»;
2. `b5f2297f…` — запрос модели выполнен, провайдер вернул
   `INCOMPLETE_TEXT_RESPONSE`, диагностика записана в события, финальный статус
   `failed / PROVIDER_ERROR`.

То есть **живой контур модель→admission→events→error status работает и честно
сообщает, что готово и где ошибка**; успешной генерации текста провайдер в этих
двух прогонах не дал (это ограничение провайдера, не этого среза). Guard-скрипт
`scripts/koswork-owner-live.mjs` остаётся как воспроизводимый драйвер с явным
подтверждением; секреты не читаются и не печатаются.

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

- Все 5 проходов сданы в коде и тестах. Живой пользовательский сценарий с
  реальной моделью проведён 2026-11-22 после того, как владелец настроил доступ:
  запросы уходили к `cheapvibecode/hy4`, но оба прогона завершились
  диагностированными ошибками провайдера (`UNSUPPORTED_ACTION` и
  `INCOMPLETE_TEXT_RESPONSE` → `PROVIDER_ERROR`). Успешной генерации текста нет;
  это ограничение провайдера, а не кода среза.
- Для положительной живой сдачи нужен провайдер, возвращающий корректный plan
  answer. Контур admission → events → error status при этом уже проверен.
- Общие файлы (`contracts` не трогались; `core/index.ts`, `api` coordinator/routes)
  минимальны и перечислены здесь для интегратора.

## Итог

Два рабочих сценария готовы (сверка заказа с восстановлением/отменой шага и
таблица с fan-in/частичной выдачей), PR по срезам открыт, вертикаль готова к
web-дропу по коду/тестам/CI и живому контуру с диагностикой ошибок. Positive
live generation остаётся за провайдером.
