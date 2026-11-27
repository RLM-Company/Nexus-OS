# DELIVERY — 04_HARNESS, Stars hierarchy first slice

- **Статус:** готово к интеграции; PR [#695](https://github.com/RLM-Company/Nexus-OS/pull/695), `CLEAN / MERGEABLE / OPEN`.
- **База:** main `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
- **Ветка:** `feature/ds1-stars-hierarchy-runtime-20261127`, изолированный worktree `stars-hierarchy`.
- **HEAD SHA:** `5fed8e14` ( code: `304250cb` → `ea3dc0a9` → `ae9ebea9` → `79eadea8` → format-only `5fed8e14` ).
- **CI точного SHA:** run `46042379413` — 4/4 pass (`Browser acceptance` 14m9s, `Verify monorepo` 7m26s, sandbox, identity).

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

## Delegation → реальный WorkDAG

`POST /api/v1/stars/missions/:id/delegation` берёт текущий versioned org snapshot
и mission, строит `delegateMission()`-план, создаёт **настоящий WorkDAG** через
существующий `WorkDagCoordinator.create()` и сохраняет `plan_digest` + версии
состава/миссии на миссии. Повтор того же плана возвращает тот же graph и не
создаёт второй. Зависимости и входные версии переносятся в `goal` node.

Проверено: `apps/api/test/stars-delegation-api.test.ts` 1/1 на реальном
`WorkDagStore` (in-memory SQLite) с project/org/mission fixture.

## Проверки

```
packages/core test/stars-hierarchy.test.ts       4/4
packages/core test/stars-mission.test.ts         9/9
packages/core test/stars-lifecycle-core.test.ts  3/3
packages/core test/stars-full-scenario.test.ts   1/1
packages/db   test/stars-org-upgrade.test.ts     1/1 (13.4s, timeout 60s)
apps/api      test/stars-org-api.test.ts         1/1
typecheck/lint core/db/api/web 0 · prettier · check-secrets
```

## Полный сценарий (фикстурный)

`packages/core/test/stars-full-scenario.test.ts` проходит: два проекта, chief,
два submanager, исполнители; параллельные и зависимые delegation-ноды;
отказ `a1` и замена `a1b` с handoff-пакетом; конфликт указаний → пауза с
`stop_reason`; возобновление после решения; недоступный executor → видимый
skip; устаревшая версия состава → conflict; разделение контекстов; отмена
отдельного поручения; проверка старшим, отдельное принятие человеком; поздний
результат не оживляет завершённую задачу; restart через replay состояния;
local→remote на изолированном runner boundary.

Артефакты: `FULL_SCENARIO_RESULT.txt`, `FULL_SCENARIO_STATE.json`.

## Границы

`delegateMission()` выдаёт настоящие входные узлы контракта WorkDAG с
зависимостями, но в этом срезе **не запускал реальный WorkDAG coordinator** —
исполнение проверено существующими тестами WorkDAG, а здесь проверено только
преобразование delegation. Remote runner — контрактная граница с изолированным
тестовым leases, не облачная эксплуатация. Живые провайдеры/VPS/устройства не
использовались. Права Harness 3, память Harness 2, device OpenCode 1, product
API OpenCode 3 не тронуты.
