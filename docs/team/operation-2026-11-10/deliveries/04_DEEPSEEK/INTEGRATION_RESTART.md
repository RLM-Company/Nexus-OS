# INTEGRATION — срез D (restart/expiry)

Канонический контракт согласует Codex.

## Общие файлы

- `packages/contracts/src/context-memory.ts` — добавлено **опциональное**
  `ContextMemoryEntry.expired?: boolean`. Старые потребители не ломаются.
- `packages/db/src/context-memory-store.ts` — `decode()` (приватный) вычисляет
  `expired` из `expires_at` и `this.now()`. Никаких изменений SQL, схемы,
  миграций или registration.
- `apps/web/src/app/context-memory-settings.tsx` — одна функциональная строка в
  существующем списке записей. Компоновка, CSS, сайдбар, чат не менялись;
  `VISUAL_WAITLIST.md` не требуется. Прочитаны bundled Next docs по локальному
  `AGENTS.md` (в предыдущей петле; компонент остаётся `"use client"`).

## Отдельный внесферный commit

- `docs/research/experience-llm-distill-2026-11-10.json` — только `prettier --write`.
  Файл приходит из `main` (`d047ce1`) и роняет корневой `format:check`; проверено,
  что `JSON.stringify` до/после идентичен. Это минимальный адаптер для зелёного
  gate, не правка чужого исследования. Codex может заменить своей правкой.

## Чего НЕ трогали

`app.ts`, `server.ts`, gateway, auth, DB migrations/registration, work-cycle,
computer-session, общая навигация, Drive importer, Skills/стиль, runtime задач.
Новых зависимостей нет.

## Проверка для Codex

```
pnpm --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web lint
cd packages/db && pnpm exec vitest run test/memory-restart-expiry.test.ts
prettier --check .
```
