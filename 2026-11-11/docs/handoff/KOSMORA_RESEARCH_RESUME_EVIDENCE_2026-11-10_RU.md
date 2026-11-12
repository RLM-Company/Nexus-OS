# Отчёт и контрольная точка: Сохраняемые исследовательские задачи и выдача доказательств (`feature/research-resume-evidence`)

- **Репозиторий:** `https://github.com/RLM-Company/Nexus-OS`
- **Ветка:** `feature/research-resume-evidence`
- **Полный `BASE_SHA`:** `09369af668e9ab22fd9de175f74fa03304892637` (над локальным `master` `beee048f76a57fc6d3db96e22e5e4440e4820026`; отделено от предыдущего ZIP-архива)

## 1. Инвентаризация существующих модулей и ограничений доступа к исходникам

1. **Что найдено в локальной базе репозитория (`BASE_SHA: 09369af668e9ab22fd9de175f74fa03304892637`):**
   - `apps/api/src/app.ts` (строки 173, 178–180, 194, 197, 228, 714–729): канонический контракт вызова `registerResearchRoutes({ app, store, gateway, manager, ownerBudget, search, projects, policy, identityFor, emergency })`, типы `ResearchCoordinator`, `ResearchStore`, `ResearchOwnerBudget`.
   - `apps/api/src/server.ts` (строки 41, 50, 57–58, 72–73, 120, 203, 218–222): каноническая инициализация `new ResearchStore(database.sqlite)`, `new ProjectResearchOwnerBudget(database.sqlite, projectStore, accountStore)`, `ResearchIntegratedPrivacyAdapter` и остановка `researchCoordinator?.stop()`.
   - `apps/api/src/cloud-storage/google-drive-restore.ts` (строки 565–592) и `apps/api/test/google-drive-complete.test.ts` (строки 95–104): базовая схема таблицы `research_runs (id, owner_id, project_id, query, status, report_markdown, created_at, updated_at)` и таблица жизненного цикла владельца `kosmora_owner_data_lifecycle (owner_id, epoch, state)`.
   - `desktop/windows/browser/search-pagination-and-bookmarks.cjs`: существующее хранилище поисковой выдачи браузера (`KosworkSearchAndBrowserStore`), переиспользованное в браузерном адаптере без создания второго браузера или второго планировщика.
2. **Чего не хватало в локальном слепке контейнера (ограничения среды):**
   - В урезанном слепке VM отсутствовал каталог `apps/api/src/research/` (`research-routes.ts`, `research-coordinator.ts`, `research-store.ts`, `research-synthesis.ts`), а также `apps/api/src/web-search.ts`, `apps/api/src/identity.ts` и пакеты `@cosmora/contracts` / `@cosmora/db` (миграции `0001..0059`).
   - Исходящий сетевой доступ из песочницы VM к `github.com` отключён политикой контейнера, поэтому все модули `apps/api/src/research/*` восстановлены строго по сигнатурам и контрактам `apps/api/src/app.ts`, `apps/api/src/server.ts` и `google-drive-restore.ts`.

## 2. Перечень реализованных изменений

1. `packages/db/migrations/0064_research_resume_evidence.sql` — аддитивная SQLite-миграция для таблиц `research_runs`, `research_run_steps`, `research_sources`, `research_claims` и триггеров `OWNER_DATA_FENCED`.
2. `apps/api/src/research/research-synthesis.ts` — `ProjectResearchOwnerBudget` (проверка владельца, проекта и бюджетов `maxDepth`, `maxSources`, `maxRuntimeMs`), верификация точных цитат (`[startUtf16..endUtf16]`, `quoteSha256`, защита от отрицаний) и раздельный синтез `confirmedClaims`, `conflictingClaims`, `unconfirmedClaims` + детерминированный рендеринг отчёта `renderDeterministicResearchReportMarkdown`.
3. `apps/api/src/research/research-store.ts` — персистентное SQLite-хранилище `ResearchStore` с пошаговыми контрольными точками (`checkpointStep`), идемпотентностью по `(owner_id, project_id, client_request_id)` и нормализованному запросу, дедупликацией источников по `canonicalUrl` с сохранением `originalUrl`, фиксацией обновления страницы (`pageChanged`, `previousPageVersion`, `pageVersion`) и восстановлением прерванных задач после перезапуска (`recoverInterruptedRuns`).
4. `apps/api/src/research/browser-research-adapter.ts` — детерминированный браузерный адаптер `DeterministicResearchBrowserAdapter` поверх существующего `KosworkSearchAndBrowserStore`.
5. `apps/api/src/research/research-coordinator.ts` — `ResearchCoordinator` с пошаговым исполнением (`search` → `read_source` → `synthesize`), безопасной отменой во время чтения (`cancelRun`) и продолжением (`resumeRun`) только незавершённых чтений без повторного чтения уже завершённых источников.
6. `apps/api/src/research/research-routes.ts` и `apps/api/src/research/index.ts` — `registerResearchRoutes` по контракту `apps/api/src/app.ts` (`POST /api/v1/research/runs`, `GET /api/v1/research/runs`, `GET /api/v1/research/runs/:runId`, `POST /api/v1/research/runs/:runId/cancel`, `POST /api/v1/research/runs/:runId/resume`, `GET /api/v1/research/runs/:runId/export`).
7. `apps/web/src/app/research-workspace/{view-model.ts,research-workspace-client.tsx,page.tsx}` — локальная UI-поверхность исследования (без изменений чата и сайдбара) с отображением прогресса, ссылок, раздельных секций подтверждённых, противоречащих и неподтверждённых утверждений и экспортом отчёта `exportResearchReportFromViewModel`, идентичным сохранённому результату.
8. `apps/api/test/research-resume-evidence.test.ts` и `scripts/integration-research-resume-evidence-smoke.mjs` — приёмочные тесты всех 8 сценариев.
