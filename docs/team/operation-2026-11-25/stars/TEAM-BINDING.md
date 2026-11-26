# Stars ↔ Agent Team / WorkDAG binding

## Что добавлено

`apps/api/src/stars-team-adapter.ts` — минимальный адаптер к существующим
`AgentTeamStore` / `AgentTeamRunStore` / WorkDAG:

- при событии `plan` миссия получает `team_binding`: deterministic
  `composition_id` по правилу AgentTeamStore (sha256 sort `blueprint@version`),
  `project_id` и `parts` с ожидаемыми `node_id` вида `part-<hash>`;
- при `GET /api/v1/stars/missions` в `team_binding` подтягиваются живые
  `instance_id` из `AgentTeamRunStore.parts()` через существующий
  `TeamGraphAdapter`/WorkDAG; `activated` становится true только когда
  реальные part-записи существуют;
- адаптер **не запускает модель, не меняет DAG и не пишет фиктивные статусы**:
  в API WorkDAG нет операции «complete», reconcile перезаписывает статусы,
  поэтому Stars-результаты остаются в собственном state machine.

## Почему не переиспользован `graph-workspace`

`IntelligenceGraphView` (`apps/web/src/app/graph-workspace/graph-view.tsx`) и
`layoutGraph` (`graph-layout.ts`) потребляют `GraphForComparison` из
`revision-diff.ts`: версионированные узлы знаний с `node_version`, `kind`,
`verification_status`, рёбрами `from/to @version` и текстовыми records. У них
нет полей для `instance_id`, `workId`, DAG-статуса или owner-run control.
Подмена этих полей была бы выдумыванием данных. Для карты миссии оставлен
компактный отдельный UI на `apps/web/src/app/stars/page.tsx`; при необходимости
расширенного графа следует использовать pattern `work-manager-dag.tsx`,
а не knowledge-graph компоненты.

## Проверки

- eslint/tsc/prettier — 0
- unit-тест `apps/api/test/stars-team-adapter.test.ts` — deterministic binding
  и read-through instance id

Это подготовка связи identity/read-through, а не новый платный запуск. Активация команды и owner-run остаются в существующем API Agent Studio.
