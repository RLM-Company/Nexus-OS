# INTEGRATION — stage3/chat-profile

Канонический контракт и порядок слияния с PR #589/#591 согласует Codex.

## Общие файлы (правки локальные)

| Файл                                                                      | Изменение                                            | Конфликт с                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/chat.ts`                                               | `identityPrompt?` в `ChatRunContext` + system prefix | #591 добавлял `projectContext?` в тот же интерфейс |
| `packages/core/src/manager.ts`                                            | `identityPrompt?` в `ManagerRunContext`              | —                                                  |
| `apps/api/src/general-chat-routes.ts`                                     | подмешивание identity в `buildRequest`               | #591 менял этот файл (project_id)                  |
| `apps/api/src/general-chat-background-run-coordinator.ts`                 | то же для фонового чата                              | #591                                               |
| `apps/api/src/manager-work-coordinator.ts`                                | `accountStore?` + identity в request()               | —                                                  |
| `apps/api/src/server.ts`                                                  | `accountStore` в ManagerWorkCoordinator              | #589 правил server.ts                              |
| `apps/api/src/account-settings/relay-execution.ts`                        | хардкод #589 → `ownerIdentityPrompt()`               | #589                                               |
| `apps/api/src/account-settings/{account-store,routes,migration.*}`        | схема/API профиля                                    | —                                                  |
| `packages/db/migrations/0027_personal_settings.sql`                       | CREATE TABLE с 3 новыми колонками                    | #591 добавлял 0068 в другом journal                |
| `apps/web/src/app/page.tsx`                                               | загрузка display_name + приветствие                  | **#589 и #591 оба правили page.tsx**               |
| `apps/web/src/app/globals.css`                                            | (не менялся в этом срезе)                            | #589/#591                                          |
| `apps/web/src/app/personal-settings/page.tsx`, `voice/voice-composer.tsx` | профиль, retry/стоп                                  | #589 (voice)                                       |
| `apps/web/e2e/composer-controls.spec.ts`                                  | новый dictation-сценарий                             | #589                                               |
| `apps/api/test/relay-execution.test.ts`, `manager-work.test.ts`           | обновлённые assertions / lint                        | #589                                               |
| `scripts/measure-profile-latency.mjs`                                     | measurement-only                                     | —                                                  |

## Порядок слияния (рекомендация)

1. #589 (OpenCode) — основа identity/timeout/voice.
2. #591 (проекты) — его `projectContext?` и `project_id` не конфликтуют
   логически с `identityPrompt?`, но оба правят `ChatRunContext`,
   `general-chat-routes.ts`, `page.tsx` — нужен ручной merge.
3. Этот PR — поверх результата.

## Миграции

- `0027_personal_settings.sql` обновлён (новые БД получают колонки сразу).
- `AccountStore.migrate()` содержит guarded `PRAGMA table_info` + `ALTER TABLE`
  для существующих БД; повторный запуск идемпотентен.
- `apps/api/src/account-settings/migration.sql` и `migration.ts` (dist-mirror)
  синхронизированы. Отката данных не требуется: defaults `'', masculine,
neutral`.

## Проверка для интегратора

```
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web lint
cd apps/api && pnpm exec vitest run test/owner-identity.test.ts test/profile-chat-path.test.ts test/relay-execution.test.ts
cd packages/core && pnpm exec vitest run
cd packages/db && pnpm exec vitest run --maxWorkers=2
node scripts/measure-profile-latency.mjs
prettier --check . && node scripts/check-secrets.mjs
```
