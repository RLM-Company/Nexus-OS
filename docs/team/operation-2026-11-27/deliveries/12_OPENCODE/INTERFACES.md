# OpenCode 6 —INTERFACES— повторяемые workflows и автоматизации

База: `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (актуальный `origin/main` на 2026-11-27).
Ветка: `feature/oc6-workflows-automation-20261127`.

## Что уже есть и используется повторно

- `WorkflowStore` / `WorkflowDefinitionInput` — сохранённые версии процедуры,
  неизменяемый снимок на каждый запуск, CAS по версии, привязка к `work_dags`.
- `WorkDagCoordinator.control("run_plan"/"pause"/"resume"/"cancel"/"approve_step")`
  — единственный исполнитель плана; budget,остановка и восстановление уже есть.
- `ScheduledDispatchStore` + `/api/v1/scheduled-dispatches/tick` — единственный
  серверный такт расписания; новый планировщик рядом не создаётся.
- `StarsMissionStore` / `createStarsMission` — Stars остаётся потребителем
  через узкий адаптер; иерархия и оркестрация Stars не меняются.
- `GeneralChatBackgroundRunCoordinator` — образец серверного lease/claim цикла.

## Новые интерфейсы этой зоны (добавочные, без изменения существующих DTO)

### Procedure version (расширение сохранённой версии)

`WorkflowDefinitionInput` получает добавочные поля:

- `conditions`: массив `{ id, description, kind: "source_allowlist"|"result_check" }` —
  проверяемые условия procedure; source allowlist ссылается на уже разрешённые
  файлы проекта и не расширяет доступ.
- `confirmations`: массив `{ id, node_id, description, external_action }` — точки
  человеческого подтверждения до внешнего действия. Все точки привязаны к
  версии определения; запуск с Confirmation Gate не стартует план до approve.

Старые определения без этих полей остаются совместимыми (поля опциональны).

### Triggers

`AutomationTrigger` (owner, project, workflow_id, definition_version):

- `kind: "manual" | "event" | "schedule"`;
- `inputs`: снимок входных данных процедуры, проверенный `validateWorkflowInputs`;
- `event`: `{ source, event_type, bindings, dedupe_key }` — события приходят
  через коннекторы Harness 3; повтор того же `(source, event_id)` не создаёт
  второй запуск;
- `schedule`: `{ mode: once|daily|weekdays|weekly, time_zone, local_time, due_at }`;
  ближайший запуск вычисляется в часовом поясе и показывается в UTC и local.

### Runs, lease и журнал

`AutomationRun`: `id, trigger_id, workflow_id, definition_version, event_key,
occurrence_key, inputs, status, lease_owner, lease_expires_at, attempt,
error_code, error_reason, version`, журнал `AutomationRunEvent` с причинами.
Переходы: `queued → claimed → awaiting_confirmation|running → succeeded|
failed|cancelled|unknown_external`; `pause/resume/cancel` через CAS версии.
При потере ответа внешнего действия создаётся `AutomationExternalAction`
с `status: "unknown"`; повтор запрещён до явной верификации (`verified`/
`failed`) через коннектор. Рестарт с истёкшим lease не повторяет внешнее действие.

### Stars consumer

Новый trigger kind `stars_mission` внутри automation (не меняет иерархию Stars):
выполнение вызывает уже существующий `StarsMissionStore.save(createStarsMission(...))`
через внедрённый-port; никакой второй оркестрации Stars.

## Источник данных

Всё хранится в основной SQLite базе проекта миграцией `0078_*`; владелец/проект
проверяются теми же предикатами, что и `WorkflowStore`, отзыв доступа проверяется
перед каждым новым шагом (`work_owner_fences`, `kosmora_owner_data_lifecycle`).
