# INTEGRATION — 05_GEMINI, срез A

Канонический контракт согласует Codex.

## Общие файлы

- `packages/core/src/research/index.ts` — **аддитивно**: новый
  `ResearchClaimCheckInput`, `ResearchClaimCheckReport`, `verifyResearchClaim()`
  и одна строка честности в `researchMarkdown()`. Существующие
  `researchEvidence`, `parseResearchAnswer`, `researchPassages`, `researchHtml`
  поведение не меняют; старые вызовы не ломаются.
- Новый файл `packages/core/test/research-claim-evidence.test.ts`.

## Чего НЕ трогали

`apps/api/src/research/*`, `apps/web/src/app/research-workspace/*`,
`desktop/windows/browser/*`, `app.ts`, `server.ts`, gateway, auth, DB
migrations/registration, Work runtime, общая навигация, чужие ветки
(активный PR #548). Миграций и новых зависимостей нет.

Пересечения файлов с PR #548 нет: он меняет research-coordinator/routes/page,
этот срез — только `packages/core`. При последовательном мердже конфликтов
не ожидается; Codex всё равно проверяет канонический контракт.

## Проверка для Codex

```
pnpm --filter @cosmora/core --filter @cosmora/api --filter @cosmora/web typecheck
pnpm --filter @cosmora/core --filter @cosmora/api --filter @cosmora/web lint
cd packages/core && pnpm exec vitest run test/research-claim-evidence.test.ts
cd apps/api && pnpm exec vitest run test/research-workflow.test.ts test/research-report-export.test.ts
prettier --check . && node scripts/check-secrets.mjs
```
