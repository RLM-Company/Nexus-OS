# Checkpoint — OpenCode 6

- base: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`
- branch: `feature/oc6-workflows-automation-20261127`
- worktree: `C:\Users\Александр\Documents\Codex\2026-11-27\kosmora-oc6-workflows`

## Инвентаризация (п. 1 петли) — сделано

- Reusable workflows: `workflow-routes.ts`, `workflow-store.ts`, `workflows.ts`,
  UI `workflow-panel.tsx`, migration `0062`; версия/CAS/snapshot/idempotency есть.
- Scheduled dispatch: `scheduled-dispatch-routes.ts`, `scheduled-dispatch-store.ts`,
  `core/scheduled-dispatch.ts`, UI `personal-settings/scheduled-dispatches.tsx`,
  migration `0070`. Нет фонового таймера — только явный `/tick`.
- Другие automation: `project-automation.ts` (playbooks/schedules/occurrences) и
  `ruflo`-производные механизмы. Не создаём второй scheduler — расширяем
  существующий scheduled dispatch как единый серверный такт.
- Права: `WorkflowStore.writable()` проверяет owner/project/fence;
  `ManagerWorkStore.assertWritable()` и work-контроль реализуют pause/resume/cancel;
  `GeneralChatBackgroundRunCoordinator` показывает паттерн lease/claim.
- Stars: `StarsMissionStore` и `stars-mission-routes.ts` используют существующие
  Work DAG через `dag` adapter; Stars-specific orchestration — Harness 1.
- Внешние события/коннекторы — Harness 3; в этой зоне только generic event trigger
  с дедупликацией по `(source, event_id)`.

## Решения внутри согласованного объёма (routine)

- Не добавляем отдельный cron-процесс. Расписания запускаются явным серверным
  tick endpoint существующего scheduled dispatch; за таймером открытой вкладки
  серверная автоматизация не считается.
- Event triggers принимаются через новый narrow endpoint с дедупликацией.
- Confirmation Gate для внешнего действия = отдельный `AutomationRun` в
  `awaiting_confirmation`, план не стартует до approve.
- Неизвестный исход external action не повторяется automatik; требуется явная
  верификация через коннектор.

## Следующий шаг

Реализация: contracts + storage + routes + runner/coordinator + UI + migration,
затем проверки трёх обязательных процедур и сценариев отказов.

## Время

Ориентир спринта: до 29.11.2026 ~15:57 МСК, резерв до ~18:57 МСК (по SPRINT_48H_RU,
проверка фактического срока акции по кабинету провайдера).
