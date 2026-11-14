# INTEGRATION — stage3/projects-memory

Канонический контракт и слияние с PR #589 согласует Codex/OpenCode.

## Общие файлы (аддитивно)

- `packages/contracts/src/domain.ts` — опциональные `project_id`, `confidential`
  в `GeneralChatSchema`/`GeneralChatSummarySchema` и `project_id` в
  `CreateGeneralChatRequestSchema`. Старые клиенты не ломаются.
- `packages/core/src/chat.ts` — `ProjectContextItem` + `projectContext?` в
  `ChatRunContext`; без нового поля рендер идентичен прежнему (тест).
- `apps/api/src/app.ts` — передаёт `projectStore` и
  `managerWorkStore.memory` в `registerGeneralChatRoutes`; оба опциональны.
- `apps/web/src/app/globals.css` — новые классы `.project-chat-folder` /
  `.project-chat-item` рядом с `.project-item`; существующие правила не менялись.
- `apps/web/src/app/page.tsx` — **пересечение с PR #589** (он тоже правит
  `page.tsx`). При одновременном мердже сверить: `LocalChatSession`, вызов
  `ChatItemMenu`, блок `matchingProjects.map`, тело POST `/api/v1/chats`.

## Чего НЕ трогали

Поле ввода, настройки профиля, диктовка (`voice/voice-composer.tsx` и др. —
OpenCode), `apps/api/src/server.ts` PR #589, gateway/права/тарифы, global system
prompt, Drive, Multi-Agent, VPS/production, sidebar-реструктуризация.
Старые таблицы `projects`/`chats`/`messages` не переписывались.

## Миграция

`0069_general_chat_project.sql`: два аддитивных `ALTER TABLE` + индекс.
Существующие чаты получают `project_id = NULL`, `confidential = 0`.
Журнал миграций дополнен `idx: 68`. Повторный `runMigrations` идемпотентен.

## Проверка для интегратора

```
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web lint
cd packages/db && pnpm exec vitest run test/general-chat-project.test.ts test/chat-skills-upgrade.test.ts
cd packages/core && pnpm exec vitest run test/chat-project-context.test.ts
cd apps/api && pnpm exec vitest run test/project-chat-context.test.ts test/project-folder-scenario.test.ts
prettier --check . && node scripts/check-secrets.mjs
```
