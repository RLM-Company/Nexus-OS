# INTEGRATION — 05_GEMINI, срез B

Канонический контракт согласует Codex.

## Общие файлы

- `packages/core/src/research/index.ts` — **аддитивно**: новая секция в
  `researchMarkdown()` перед «Ограничения». Существующие `researchEvidence`,
  `parseResearchAnswer`, `verifyResearchClaim`, `researchHtml` поведение не
  меняют; старые вызовы не ломаются.
- Новый файл `packages/core/test/research-dedup-report.test.ts`.

## Чего НЕ трогали

`apps/api/src/research/*`, `apps/web/src/app/research-workspace/*`,
`desktop/windows/browser/*`, `app.ts`, `server.ts`, gateway, auth, DB
migrations/registration, Work runtime, общая навигация, чужие ветки (#548).
Миграций и новых зависимостей нет. Пересечения файлов с #548 нет.

## Проверка для Codex

```
pnpm --filter @cosmora/core --filter @cosmora/api typecheck
pnpm --filter @cosmora/core --filter @cosmora/api lint
cd packages/core && pnpm exec vitest run test/research-dedup-report.test.ts
cd apps/api && pnpm exec vitest run test/research-workflow.test.ts test/research-report-export.test.ts
prettier --check . && node scripts/check-secrets.mjs
```
