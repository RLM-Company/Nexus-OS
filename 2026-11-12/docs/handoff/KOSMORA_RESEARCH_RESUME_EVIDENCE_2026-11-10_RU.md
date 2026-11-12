# Отчёт и контрольная точка: Сохраняемые исследовательские задачи и выдача доказательств (`feature/research-resume-evidence`)

- **Репозиторий:** `https://github.com/RLM-Company/Nexus-OS`
- **Ветка:** `feature/research-resume-evidence`
- **Полный `BASE_SHA`:** `09369af668e9ab22fd9de175f74fa03304892637` (над локальным `master` `beee048f76a57fc6d3db96e22e5e4440e4820026`; отделено от предыдущего ZIP-архива `05_GEMINI`)
- **Внешняя SQL-миграция:** не требуется — контрольные точки `next_index` и `checkpoint_json` (включая `plan_model_completed`, `planned_queries`, `model_calls_count`, `canvas_artifact_id`, `project_message_id`, `discovered_urls`) автоматически добавляются и обслуживаются аддитивно внутри `ResearchStore.ensureSchema()` на существующей таблице `research_runs`.

## 1. Инвентаризация существующих модулей и ограничений среды

1. **Что найдено в локальной базе (`BASE_SHA: 09369af668e9ab22fd9de175f74fa03304892637`):**
   - `apps/api/src/app.ts` (строки 173, 178–180, 194, 197, 228, 714–729): канонический контракт `registerResearchRoutes({ app, store, gateway, manager, ownerBudget, search, projects, policy, identityFor, emergency })`, типы `ResearchCoordinator`, `ResearchStore`, `ResearchOwnerBudget`.
   - `apps/api/src/server.ts` (строки 41, 50, 57–58, 72–73, 120, 203, 218–222): инициализация `new ResearchStore(database.sqlite)`, `new ProjectResearchOwnerBudget(database.sqlite, projectStore, accountStore)`, `ResearchIntegratedPrivacyAdapter` и остановка `researchCoordinator?.stop()`.
   - `apps/api/src/cloud-storage/google-drive-restore.ts` (строки 565–592) и `apps/api/test/google-drive-complete.test.ts` (строки 95–104): базовая таблица `research_runs` и таблица жизненного цикла владельца `kosmora_owner_data_lifecycle (owner_id, epoch, state)`.
   - `desktop/windows/browser/search-pagination-and-bookmarks.cjs`: существующее хранилище поисковой выдачи `KosworkSearchAndBrowserStore`, переиспользованное в браузерном адаптере без создания второго браузера, второго хранилища или второго планировщика.
2. **Ограничения среды VM:**
   - В локальном слепке контейнера отсутствовали исходники `apps/api/src/research/*`, а также исходящий доступ к `github.com`, поэтому модули `apps/api/src/research/*` реализованы строго по контрактам `apps/api/src/app.ts` и `apps/api/src/server.ts`.

## 2. Реализованные модули и вертикальные срезы

1. `apps/api/src/research/research-synthesis.ts`:
   - `ProjectResearchOwnerBudget`: проверка активности владельца, прав на проект и лимитов `maxDepth`, `maxSources`, `maxRuntimeMs`.
   - `verifyCandidateClaimAgainstSource` и `synthesizeResearchClaims`: верификация точных UTF-16 срезов (`[startUtf16..endUtf16]`, `quoteSha256`, защита от отрицаний), раздельный синтез `confirmedClaims`, `conflictingClaims` и `unconfirmedClaims` (`"не удалось установить"`), плюс `ClaimResolutionAudit` и детерминированный рендеринг `renderDeterministicResearchReportMarkdown`.
2. `apps/api/src/research/research-store.ts`:
   - Персистентное SQLite-хранилище `ResearchStore` с пошаговыми контрольными точками (`checkpointStep`), конвертом `ResearchCheckpointEnvelope` (`next_index`, `plan_model_completed`, `model_calls_count`), идемпотентностью по `(owner_id, project_id, client_request_id)` и нормализованному запросу, дедупликацией источников по `canonicalUrl` с сохранением `originalUrl`, фиксацией обновления страниц (`pageChanged`, `previousPageVersion`, `pageVersion`) и восстановлением после рестарта (`recoverInterruptedRuns`).
   - Гибридное чтение проектной библиотеки документов (`document_library_files`), экспорт в `canvas_artifacts`, передача в `project_messages`, Grounded Q&A, продвижение фактов и гипотез в `context_memory_entries`, сравнение запусков (`diffRuns`), верифицируемый экспорт/импорт пакетов (`kosmora.research.bundle.v1`, `bundleSha256`) и разрешение конфликтов (`resolveConflictingClaim`).
3. `apps/api/src/research/browser-research-adapter.ts`:
   - `DeterministicResearchBrowserAdapter` поверх `KosworkSearchAndBrowserStore` без создания второго браузера.
4. `apps/api/src/research/research-coordinator.ts`:
   - `ResearchCoordinator` с `single-flight` защитой от гонок и повторного нажатия «Продолжить», пошаговым выполнением без повтора уже выполненного платного запроса модели (`gateway.planResearchQueries`) и уже завершённых чтений (`index < next_index`), доисследованием (`followUpUnconfirmedClaims`), выборочной перепроверкой свежести источников (`reverifySources`) и дренированием задач владельца (`quiesceOwner`).
5. `apps/api/src/research/research-privacy-adapter.ts`:
   - `ResearchIntegratedPrivacyAdapter` (`quiesce`, `export`, `delete`, `resume`) по контракту `apps/api/src/server.ts`.
6. `apps/api/src/research/research-routes.ts` и `apps/api/src/research/index.ts` — `14` эндпоинтов:
   - `POST /api/v1/research/runs` — запуск/идемпотентное переиспользование задачи;
   - `GET /api/v1/research/runs` — список задач владельца (с фильтром по `project_id`);
   - `GET /api/v1/research/runs/:runId` — статус, прогресс (`nextIndex`, `canResume`), источники и утверждения;
   - `POST /api/v1/research/runs/:runId/cancel` — безопасная остановка с сохранением контрольной точки;
   - `POST /api/v1/research/runs/:runId/resume` — продолжение с последнего шага (`single-flight`, защита от чужого владельца);
   - `POST /api/v1/research/runs/:runId/follow-up` — доисследование неподтверждённых утверждений по новым URL или документам проекта;
   - `POST /api/v1/research/runs/:runId/claims/:claimId/resolve` — разрешение конфликта источников с записью `ClaimResolutionAudit`;
   - `POST /api/v1/research/runs/:runId/reverify-sources` — выборочная перепроверка свежести источников и сброс устаревшего аудита;
   - `GET /api/v1/research/runs/:runId/export` — экспорт отчёта с доказательствами;
   - `POST /api/v1/research/runs/:runId/canvas` — идемпотентный экспорт в `canvas_artifacts`;
   - `POST /api/v1/research/runs/:runId/handoff-to-project` — идемпотентная передача сводки в `project_messages`;
   - `POST /api/v1/research/runs/:runId/answer` — ответ по сохранённым доказательствам;
   - `POST /api/v1/research/runs/:runId/promote-to-memory` — идемпотентное продвижение в `context_memory_entries` (`confirmed -> fact`, `conflicting -> hypothesis`);
   - `GET /api/v1/research/runs/:runId/diff/:otherRunId` — временное сравнение двух запусков;
   - `GET /api/v1/research/runs/:runId/bundle` и `POST /api/v1/research/runs/import-bundle` — экспорт и импорт пакетов с проверкой `bundleSha256` и UTF-16 снэпшотов.
7. `apps/web/src/app/research-workspace/{view-model.ts,research-workspace-client.tsx,page.tsx}`:
   - Локальная UI-поверхность исследования (без изменений чата и сайдбара) с прогрессом, кнопками остановки/продолжения/экспорта, чеклистом разрешения конфликтов (`verificationChecklist`, `onResolveConflict`) и паритетным экспортом `exportResearchReportFromViewModel`.

## 3. Команды и результаты проверок

- **Полный приёмочный и интеграционный тест (`4/4 pass`, `0 fail`):**
  ```bash
  node scripts/integration-research-resume-evidence-smoke.mjs
  ```
- **Проверка чистоты применения патча к базовому коммиту `09369af668e9ab22fd9de175f74fa03304892637`:**
  ```bash
  git apply --check --verbose feature-research-resume-evidence.diff
  ```
