# INTEGRATION — 05_GEMINI, срез D

Канонический контракт согласует Codex. **Общий hook изменён отдельным маленьким
integration commit**, как требует `05_GEMINI.md`.

## Commit 1 (продуктовый)

- `packages/contracts/src/artifact-context.ts` — `ArtifactContextKind` +=
  `research` (аддитивно, существующие kind не меняются).
- `apps/api/src/artifact-context.ts` — **опциональный** `ResearchStore`; без него
  `list()`/`preview()` ведут себя как раньше (проверено тестом).
- `apps/api/src/artifact-context-routes.ts` — схема `source.kind` и шестой
  опциональный аргумент.
- `apps/api/test/artifact-context-research.test.ts` — 5 scoped тестов.
- `apps/web/src/app/project-artifact-picker.tsx` — только строка метки
  `research: "Исследование"`; компоновка, CSS, типографика не менялись.

## Commit 2 (integration, только `app.ts`)

```ts
registerArtifactContextRoutes(
  app,
  dependencies.projectStore,
  dependencies.canvasStore,
  identityFor,
  dependencies.managerWorkStore,
  dependencies.researchStore
);
```

Больше в `app.ts`/`server.ts` ничего не менялось.

## Чего НЕ трогали

`desktop/windows/browser/*`, `apps/web/src/app/research-workspace/*`,
`apps/api/src/research/{store,coordinator,synthesis,page-reader}*`, gateway,
auth, DB migrations/registration, Work runtime, чужие ветки (#548).
Миграций и новых зависимостей нет. Новых grants/прав/ключей нет.

## Проверка для Codex

```
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/api --filter @cosmora/web typecheck
pnpm --filter @cosmora/contracts --filter @cosmora/core --filter @cosmora/api --filter @cosmora/web lint
cd apps/api && pnpm exec vitest run test/artifact-context.test.ts test/artifact-context-research.test.ts test/research-workflow.test.ts test/research-report-export.test.ts
prettier --check . && node scripts/check-secrets.mjs
```
