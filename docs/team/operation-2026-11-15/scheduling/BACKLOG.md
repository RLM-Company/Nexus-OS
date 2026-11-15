# BACKLOG — stage3/scheduling

- **BASE_SHA:** `00c07f34704090b3807da15e9ce1f7dd1efcd656` (main после #602).
- **Ветка:** `stage3/scheduling`. **PR:** без merge/deploy.

## Разведка (факты)

| Проверка                                                                           | Результат                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AutomationScheduleSchema` (`packages/contracts/src/project-automation.ts`)        | уже есть `due_at` + `interval_seconds` для **playbook automation в проекте**                                                                        |
| `ProjectAutomationService.collectDue()` (`apps/api/src/project-automation.ts:230`) | **explicit tick**: создаёт occurrence-кандидаты, coalescing при простое, НЕ вызывает модель, требует `accept`                                       |
| `POST /api/v1/projects/:id/automation/tick`                                        | явный тик, фонового таймера нет                                                                                                                     |
| `manager-work-coordinator.ts` / background coordinators                            | свои `setInterval` для **уже запущенных** run'ов, не для расписаний                                                                                 |
| `general_chat_messages`                                                            | `status ∈ pending/streaming/completed/failed/cancelled`, `client_message_id` (идемпотентность)                                                      |
| **Пробел**                                                                         | Нет единого расписания для: (1) расстановки задач Work/Koscode/Multi-Agent по дням; (2) отложенной отправки сообщения в любом чате, включая обычный |

## Решение (без второго scheduler)

Переиспользуем паттерн `collectDue`: **explicit tick + явное подтверждение**, один
store, одна таблица, один сервис.

- **A.** Миграция `0070_scheduled_dispatches.sql`: `id`, `owner_id`, `chat_id`
  (nullable для задач), `project_id` (nullable), `kind`
  (`message` | `work_task` | `koscode_task` | `team_task`), `mode` (`once` |
  `daily` | `weekdays` | `weekly`), `due_at`, `payload_json` (текст/заголовок
  задачи), `status` (`scheduled` | `ready` | `dispatched` | `cancelled`),
  `client_request_id` (идемпотентность), `created_at`, `updated_at`. Индексы по
  owner+due+status.
- **B.** `ScheduledDispatchStore` в `packages/db/src`: create/list/due/cancel/
  markReady/markDispatched, owner isolation, CAS по client_request_id, restart
  (persisted rows survive store reload).
- **C.** `ScheduledDispatchService.tick(now)`: перевод `due_at <= now` в `ready`,
  coalescing пропущенных повторов (как `collectDue`), расчёт `next_due_at` для
  повторяющихся, **без вызова модели**; dispatch — отдельный явный вызов.
- **D.** Роуты `/api/v1/scheduled-dispatches`: POST create, GET list, POST
  `/tick`, POST `/:id/dispatch` (для `message` — `createMessage` в нужный чат,
  для задач — постановка в Work/Koscode/team без немедленного запуска модели),
  DELETE cancel. Owner isolation, 409 на повтор без идемпотентности.
- **E.** UI: минимальная панель в `personal-settings` (список, создание,
  отмена), **без правок composer/поля ввода** (OpenCode).
- **F.** Прогон: сценарии «ежедневная задача», «отложенное сообщение в обычном
  чате», «повтор запроса», «перезагрузка», «изоляция владельцев», «отмена».

## Границы

Не трогать поле ввода/диктовку/профиль OpenCode, тарифы/квоты/права, gateway,
global CSS/sidebar, VPS/production, Multi-Agent runtime (только расписание),
не создавать фоновый таймер/второй scheduler, не запускать модель скрытно.
