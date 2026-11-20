# DELIVERY — stage3/scheduling

- **Статус:** готово к интеграции.
- **BASE_SHA:** `d860baf3cad3b16251a9bfda5f09e7da5f31f0a1` (актуальный `main` на момент изоляции; позже main ушёл вперёд).
- **Ветка:** `stage3/scheduling-work`. **PR:** открывается в `main`, без merge/deploy.
- **Исполнитель:** DeepSeek Harness.

## Проблема

Нужна была планировка: в Work / Koscode / Multi-Agent — расстановка задач по дням
и расписанию; во всех режимах, включая **обычный чат** — отправка сообщения в
заданное время. Существующий `AutomationScheduleSchema` /
`ProjectAutomationService.collectDue()` покрывает только playbook-автоматизации
в проекте (explicit tick → occurrence-кандидаты → `accept`), но не сообщения и не
задачи. Фонового таймера у него нет.

## Решение (без второго scheduler)

Переиспользован паттерн `collectDue`: **один store, одна таблица, один явный тик,
исполнение только по явному подтверждению**, модель скрытно не запускается.

| Срез | Что                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Миграция `0070_scheduled_dispatches.sql` + journal: `owner_id`, `client_request_id`, `chat_id`/`project_id`, `kind` (`message`\|`work_task`\|`koscode_task`\|`team_task`), `mode` (`once`\|`daily`\|`weekdays`\|`weekly`), `due_at`, `payload_json`, `status` (`scheduled`\|`ready`\|`dispatched`\|`cancelled`), индексы                                         |
| B    | `ScheduledDispatchStore` (`packages/db/src`): create (CAS по `client_request_id`), get/list/due, markReady/reschedule/markDispatched/cancel, owner isolation, restart                                                                                                                                                                                            |
| C    | `scheduled-dispatch.ts` (`packages/core/src`): `nextDispatchAt()` с coalescing пропущенных интервалов и переносом `weekdays` на будний день; `tickScheduledDispatches()` — due → ready + перестановка повторяющихся, **без вызова модели**                                                                                                                       |
| D    | `scheduled-dispatch-routes.ts` + регистрация в `app.ts`/`server.ts`: POST create, GET list, POST `/tick`, POST `/:id/dispatch`, DELETE cancel. Для `message` — `GeneralChatStore.createMessage` с идемпотентным `client_message_id = scheduled:<id>`; для задач — только пометка `dispatched` с телом задачи, без немедленного запуска Work/Koscode/team runtime |
| E    | Панель «Планировка» в `personal-settings`: создание (тип/повтор/время/текст/ID чата или проекта), список, «Проверить время» (тик), «Отправить / поставить задачу», «Отменить». **Composer, поле ввода и диктовка OpenCode не менялись**                                                                                                                          |

## Entrypoint

```
POST /api/v1/scheduled-dispatches            -> запись scheduled
POST /api/v1/scheduled-dispatches/tick      -> due -> ready (+ reschedule повторяющихся)
POST /api/v1/scheduled-dispatches/:id/dispatch
   kind=message  -> createMessage в нужный чат (обычный в т.ч.)
   kind=*_task   -> dispatched, задача готова к постановке в Work/Koscode/team
DELETE /api/v1/scheduled-dispatches/:id     -> cancelled
```

## Сценарии проверки (фактические)

```
packages/db   scheduled-dispatch-store.test.ts        4 passed
              create/reload/изоляция/идемпотентность, due/ready/dispatch/cancel,
              невалидный ввод, привязка message к чату
packages/core scheduled-dispatch.test.ts             5 passed
              once/daily/weekly coalescing, weekdays→будни, tick
apps/api      scheduled-dispatch-api.test.ts         3 passed
              1) отложенное сообщение: create -> replay(тот же id) -> conflict(409)
                 -> tick -> dispatch в обычный чат -> повтор dispatch 409, дубля нет
              2) ежедневная задача: tick -> reschedule на следующий день, без пачки
                 просроченных дублей
              3) отмена, изоляция владельцев, чужой chat/project -> 404
typecheck/lint 5 пакетов · prettier --check . · check-secrets — green
```

**Ограничение по сборке:** `web build` в изолированном worktree и в основном
репозитории в момент прогона падал на разрешении подпутей
`@cosmora/contracts/*` — это артефакт конкурирующих изменений в общем worktree
(другой агент одновременно правил `workspace-sections`/`chat-task-plan` и
сбрасывал индекс), а не дефект этого среза: `apps/web typecheck`, `lint` и
`prettier` прошли, UI-компонент типизирован. CI на чистом checkout подтвердит
сборку.

## Как обновляются существующие данные

- Миграция **аддитивная**: новая таблица, существующие проекты/чаты/сообщения
  не изменяются, откат не требуется.
- Повтор запроса (`client_request_id`) возвращает прежнюю запись или 409 при
  расхождении; `dispatch` идемпотентен через `client_message_id`.
- Restart: все записи в SQLite, после перезапуска store видит расписание; тик
  coalesce'ит пропущенное время и не создаёт пачку просроченных отправок.
- Отмена доступна для `scheduled`/`ready`, после `dispatched` — 404.
- Owner isolation на всех операциях; FK проверяются в роутах (404 на чужой
  чат/проект).

## Ограничения

- Исполнение **не фоновое**: нужен явный `tick` + `dispatch`. Фоновый таймер и
  второй scheduler намеренно не создавались по правилам задания.
- Для `*_task` dispatch фиксирует готовность задачи, но не запускает сам
  Work/Koscode/Multi-Agent рантайм — это следующий срез (требует отдельного
  согласования admission/бюджета).
- Живой провайдер, VPS, ноутбук владельца не проверялись; прогоны на in-memory
  SQLite и mock-окружении. Stage-one по `AGENTS.md` не объявляется принятой.
- Общий worktree в процессе работы получил чужие незавершённые коммиты
  (`chat-task-plan`, `clarification-card`); чтобы не смешивать, работа
  перенесена в изолированный `git worktree`, в PR входят только файлы этого
  среза.

## Следующий шаг

Интегратору: слить PR, при необходимости адаптировать к ушедшему вперёд `main`,
затем отдельным срезом подключить `*_task` к admission Work/Koscode/team и,
если владелец разрешит, добавить фоновый тик поверх существующего цикла
координаторов (не второй scheduler).
