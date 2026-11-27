# SCENARIOS — Stars hierarchy (first slice)

## S1 —Permanent team with manager levels

Вход: `team_scope=stars-team`, chief, submanager project-a, submanager project-b,
executor research/delivery, senior. Ожидаемый результат: `version 1`, ровно один
`accountableManager` на проект, `resolveAssignee` находит исполнителя по зоне.

## S2 — Замена состава

Вход: `expected_version=1`, remove alice + add carol. Результат: version 2,
`alice` остаётся в истории как `removed`, `carol` доступна для delegation,
старый `expected_version=0` → 409 без записи.

## S3 — Конфликт владельцев

Вход: два submanager с `project_ids=["project-a"]`. Результат: 422
`DOUBLE_OWNER`, snapshot не создан.

## S4 — Upgrade и перезапуск

База = main после 0077 с существующей миссией. После 0078 миссия сохраняется;
org version 1 переживает reopen; stale write не оставляет частичной записи.

## S5 — Пользовательский экран

Stars page показывает текущий состав: версию, checksum, роли/менеджеров/зоны/проекты.
Данные берутся из org API; вторая копия статусов не ведётся.
