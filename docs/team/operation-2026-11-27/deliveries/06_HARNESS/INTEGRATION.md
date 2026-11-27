# INTEGRATION — 06_HARNESS

База: main `3af92583`. Ветка `feature/ds3-collaboration-connectors-20261127`.

## Минимальные изменения общих точек

- `packages/contracts/src/domain.ts`: `ProjectSummary.membership_role?` — одно
  необязательное поле для списка проектов; обратно совместимо.
- `apps/api/src/app.ts`: только чтение `projectMembershipStore.sharedWith(owner)`
  при `GET /api/v1/projects`, без refactor'а; identity.owner_id не подменяется.
- `packages/db/migrations/0078_project_material_authorship.sql`: отдельная таблица
  `project_material_activity`, не altering existing `project_materials`; temporary
  номера/время согласует интегратор перед общим слиянием.
- `apps/api/src/project-materials-routes.ts`: в `setMaterials` как actor передан
  `identityFor(request).actor_id`, data owner остаётся `access.ownerId`.
- `apps/api/src/mcp-document-routes.ts`: существующий вызов `setMaterials` обновлён
  под новую сигнатуру (actor = `context.actorId`, completion остался на месте).

## Проверено

- upgrade с main/кандидата/Stars/delivery: `project-intake-upgrade.test.ts` 4 passed,
  данные `project_materials` побайтово сохранены.
- авторство/конфликт/роли: `apps/api/test/project-membership.test.ts` 4 passed.

## Зависимости от других исполнителей

- Harness 1 (agent hierarchy): персональные агенты участников совместного чата —
  пока через существующий identity, без изменения agent tree.
- Harness 2 (memory): граница личных и общих материалов — пока данные остаются
  в owner-scoped store, общий доступ идёт только через membership.
- Интегратор: финальный номер/timestamp миграции 0078 и порядок перед слиянием.
