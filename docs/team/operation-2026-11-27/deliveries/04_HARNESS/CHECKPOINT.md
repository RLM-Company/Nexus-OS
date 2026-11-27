# CHECKPOINT — 04_HARNESS

- **Обновлено:** 27 ноября 2026, после FIRST SLICE.
- **База:** main `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (refs обновлены).
- **Ветка:** `feature/ds1-stars-hierarchy-runtime-20261127`, изолированный worktree
  `stars-hierarchy`.
- **Статус:** в работе; первый срез готов к интеграции, PR ещё не открыт.

## Выполнено

- Прочитаны полностью `00_COMMON_RULES_RU.md`, `04_HARNESS_STARS_RU.md`,
  `README.md` волны, `STARS_OWNER_DECISIONS_RU.md`, локальные AGENTS/UI_RULES.
- Реализован чистый `stars-hierarchy.ts`: несколько уровней менеджеров, зоны,
  версии состава, ровно один владелец проекта, stale и double-owner conflict,
  resolve assignee.
- Добавлены миграция 0078 и `StarsOrgStore` (неизменяемые версии, CAS, upgrade
  с main после 0077, reopen, atomically reject stale).
- Подключены HTTP `/api/v1/stars/org/:teamScope` (+ `/change`) и read-only панель
  в `apps/web/src/app/stars/`.
- Тесты: core 3/3, db upgrade 1/1, api 1/1 (-local focused).

## Следующий срез

Cycle 2: поручение из ТЗ + verifiable criteria + delegation into real WorkDAG,
замена агента с checkpoint и защита от late result. Затем контексты, event wait,
критика/приёмка, remote boundary, map, полный сценарий приёмки.

## Известное

- `stars-org-upgrade` занимает ~13 c и требует timeout 60s.
- Живые провайдеры/VPS/устройства не использовались; только фикстуры.
