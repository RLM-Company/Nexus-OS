# DELIVERY — 04_HARNESS, Stars hierarchy first slice

- **База:** main `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (refs обновлены).
- **Ветка:** `feature/ds1-stars-hierarchy-runtime-20261127`, изолированный worktree `stars-hierarchy`.
- **Статус:** готово к интеграции; PR # и точный HEAD SHA — в финальной передаче.

## Что сделано (цикл 1 иерархии)

- `packages/core/src/stars-hierarchy.ts`: постоянная команда с уровнями
  `owner → chief → submanager → executor/senior`, зоны ответственности, версии
  состава, ровно один ответственный submanager на проект, resolve assignee.
  Stale compose и double owner отклоняются; удалённый агент остаётся в истории.
- `packages/db/migrations/0078_stars_org_snapshots.sql` +
  `StarsOrgStore`: неизменяемые версии, CAS, upgrade с main после 0077,
  сохранение существующих миссий, atomically reject stale.
- HTTP `GET/POST /api/v1/stars/org/:teamScope` и `POST .../change`
  через существующую Stars mission registration.
- Read-only панель состава в `apps/web/src/app/stars/stars-org-panel.tsx`
  и подключение в Stars page; без изменений sidebar/главного чата/общего CSS.

## Проверки

```
packages/core test/stars-hierarchy.test.ts   3/3
packages/db   test/stars-org-upgrade.test.ts 1/1 (13.4s, timeout 60s)
apps/api      test/stars-org-api.test.ts     1/1
typecheck core/db/api/web 0 · lint core/db/api/web 0 · prettier · check-secrets
```

## Границы

Права людей — Harness 3, память/skills — Harness 2, device/browser — OpenCode 1,
product API — OpenCode 3: не тронуты. VPS/deploy не выполнялись. Общие
`app.ts/server.ts` изменены минимально и описаны в INTEGRATION.md.
