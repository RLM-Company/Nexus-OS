# INTERFACES — Stars hierarchy (04_HARNESS)

База: main `3af92583`. Ветка `feature/ds1-stars-hierarchy-runtime-20261127`.

## Сущности и数据来源

- `StarsOrgNode`: `id`, `role` (`owner|chief|submanager|executor|senior`),
  `manager_id`, `responsibility_zones`, `project_ids`, `status`, `effective_from`.
- `StarsOrgSnapshot`: `team_scope`, `version`, `nodes`, `checksum`. Хранится в
  `stars_org_snapshots` (миграция 0078) как неизменяемая версия; история не
  переписывается.
- Ответственный проект/бизнес — ровно один `submanager` с `project_ids`.
  `owner`/`chief` имеют широкий `project_ids` как scope наблюдения, не как
  второе владельчество. Попытка назначить двух submanager на один проект →
  `DOUBLE_OWNER`.
- `accountableManager(snapshot, projectId)` и `resolveAssignee(snapshot, managerId, zone)` —
  чистые resolve-функции для delegation; не создают второй scheduler.

## Входы/выходы HTTP

- `GET /api/v1/stars/org/:teamScope` → текущий snapshot или 404.
- `POST /api/v1/stars/org/:teamScope` body `{nodes}` → 201 snapshot v1;
  `DOUBLE_OWNER`/`UNKNOWN_MANAGER` → 422.
- `POST /api/v1/stars/org/:teamScope/change` body `{expected_version, changes}`
  → CAS-обновление; stale → 409. Удаление агента сохраняет старый node как
  `removed` в истории.

## События/контекст

Stars mission остаётся источником stage/version; composition version — отдельная
версия состава. Новая задача должна фиксировать обе версии. Gate доступа к
контексту — интерфейс Harness 2; здесь только `context_scopes` как данные узла,
без автоматического расширения прав. Внешние действия и device — OpenCode 1,
права людей — Harness 3, продукт API — OpenCode 3.

## Изменения общих файлов

`apps/api/src/app.ts`, `server.ts` — минимальная регистрация `StarsOrgStore`;
описано в INTEGRATION.md.
