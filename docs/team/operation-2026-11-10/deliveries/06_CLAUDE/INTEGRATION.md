# INTEGRATION — 06_CLAUDE, срез A

Канонический контракт согласует Codex.

## Общие файлы (аддитивно, минимально)

- `packages/contracts/src/chat-skills.ts` — новые `ChatSkillScope`, `CHAT_SKILL_PRECEDENCE`, опциональное `ChatSkillSnapshot.scope?`. Старые снимки прогонов и сторонние сборщики не ломаются.
- `packages/core/src/chat.ts` — импорт `CHAT_SKILL_PRECEDENCE` и изменённый рендер блока Skills в последнем user-сообщении. System prompt, gateway, composer, sidebar и global CSS не менялись.
- `packages/db/src/chat-skill-store.ts`, `work-skill-store.ts` — в SELECT добавлены литералы `'chat'` / `'project'` AS `scope`; SQL-схема, миграции и registration не менялись.

- `packages/core/src/skill-conflict-resolution.ts` — новый чистый модуль,
  экспортируется из `packages/core/src/index.ts`.
- `packages/core/src/chat.ts` — рендер использует `resolveSkillConflicts()`
  вместо локальной сортировки; `JSON.stringify(instructions)` сохранён.
- `apps/web/src/app/chat-skill-settings.tsx` — только текст внутри существующего
  `<details>`. Компоновка, CSS, сайдбар, чат не менялись; `VISUAL_WAITLIST.md` не
  требуется. Новая зависимость web от `@cosmora/core` **не** добавлена.

## Чего НЕ трогали

`app.ts`, `server.ts`, gateway, auth, DB migrations/registration, work-cycle, computer-session, общая навигация, чужие memory tables, Drive importer, runtime задач. Новых зависимостей нет.

## Проверка для Codex

```
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/db lint
cd packages/core && pnpm exec vitest run test/chat-skill-precedence.test.ts
cd packages/db && pnpm exec vitest run test/chat-skill-scope.test.ts
```
