# DELIVERY — 06_HARNESS (2026-11-27)

Ветка: `feature/ds3-collaboration-connectors-20261127`.
Изолированный worktree: `.../ds3-collaboration`.
База: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
PR: #691 (https://github.com/RLM-Company/Nexus-OS/pull/691).
Head будет зафиксирован в финальном сообщении и CHECKPOINT.md.

## Фактические возможности

- Accepted shared project отображается в основном списке участника с ролью viewer/editor; приглашение без accept данные не раскрывает; revoke/leave убирает проект.
- Ролевые ограничения: viewer может читать, не может изменить材料; editor меняет с записью авторства; owner остаётся владельцем данных.
- Concurrent version conflict: stale version → 409, без тихой потери правок.
- Миграция 0078 создаёт отдельную таблицу авторства, не меняя bytes现有 `project_materials`; upgrade-фикстуры с main/кандидата/Stars/delivery проходят.
- Connector catalog: github, google-drive, office, http-api; injected HTTP transport виден как `transport_wired` без раскрытия endpoint/secret.
- Drive connector lifecycle проходит; HTTP adapter проходит allowlist/typed errors/guarded runtime.

## Команды проверок (воспроизводимые)

```bash
pnpm --filter @cosmora/db exec vitest run --pool=threads --maxWorkers=1 --testTimeout=30000 test/project-membership-store.test.ts test/project-intake-upgrade.test.ts
pnpm --filter @cosmora/api exec vitest run --pool=threads --maxWorkers=1 --testTimeout=30000 test/project-membership.test.ts test/connector-status.test.ts test/drive-connector-lifecycle.test.ts
pnpm --filter @cosmora/tool-runtime exec vitest run --pool=threads --maxWorkers=1 test/http-connector.test.ts
pnpm --filter @cosmora/contracts run typecheck
pnpm --filter @cosmora/db run typecheck
pnpm --filter @cosmora/api run typecheck
node scripts/check-secrets.mjs
```

Фактические результаты последнего прогона: DB 9 passed, API 8 passed,
tool-runtime 4 passed, typecheck 0, check-secrets green.

## Что НЕ проверено / blocker

- Calendar, Mail, Docs/Sheets, Telegram, Slack: готовых production-адаптеров в базе
  `3af92583` нет; фикстуры не выдаются за подключённые сервисы. Нужны отдельные
  срезы с реальными OAuth/transport и тестовыми аккаунтами.
- Живые OAuth, реальные отправки/изменения внешних данных и VPS — отдельные
  разрешённые действия пользователя; не выполнялись.
- Полный A/B/C e2e с персональными агентами зависит от Harness 1; граница личных
  и общих материалов согласована в INTEGRATION.md как owner-scoped store + membership.
- Событийный поток и повторное использование старого ID требуют отдельного e2e;
  пока покрыты members/sources/materials тестами на API-уровне.

## Зависимости

- Интегратор: финальный номер/timestamp миграции 0078 перед общим слиянием.
- Harness 1 / Harness 2: персональные агенты и граница личных материалов.
- Внешние аккаунты для 4-го и последующих сервисов — отдельно.
