# Сценарии 06_HARNESS (фактические прогоны)

База: `3af92583`. Branch: `feature/ds3-collaboration-connectors-20261127`.

## S1 — общий проект в списке участника

- A приглашает B (editor) и C (viewer) через `POST /members/invite`.
- До accept `GET /api/v1/projects` у B/C не содержит проект (ссылка не раскрывает данные).
- После accept проект появляется с `membership_role`.
- После revoke/leave проект исчезает из списка, доступ к GET/materials/download/source/run возвращает 404/403.

Проверено: `apps/api/test/project-membership.test.ts` 4 passed;
`packages/db/test/project-membership-store.test.ts` 4 passed.

## S2 — Roles/authority/conflict

- B-editor меняет materials: `updated_by: owner-b`, version 1.
- Повтор с version 0 → 409 `CONFLICT` (тихая потеря правок исключена).
- C-viewer пытается изменить → 404.role
- Owner остаётся владельцем данных: `access.ownerId` в `projectAccess`, actor identity не подменяется.

Проверено: `apps/api/test/project-membership.test.ts` (new scenario); upgrade `project-intake-upgrade.test.ts` 4 passed.

## S3 — Connectors

- `GET /api/v1/integrations/status` — credential-free каталог: github, google-drive, office, http-api.
- При инъекции owner-approved HTTP-транспорта `http-api.transport_wired=true`, endpoint/secret в ответе не раскрываются.
- `createHttpConnectorTransport` проходит allowlist, typed errors, policy-guarded runtime (4 tool-runtime tests).
- Drive lifecycle: `drive-connector-lifecycle.test.ts` passed.
- Остальные сервисы (Calendar/Mail/Docs/Telegram/Slack): готовых production-адаптеров в базе нет, не выдаём фикстуры за подключённые сервисы; следующий шаг — отдельные срезы по реальным адаптерам.

Проверено: `connector-status.test.ts` 2 passed, `drive-connector-lifecycle.test.ts` passed,
`http-connector.test.ts` 4 passed.
