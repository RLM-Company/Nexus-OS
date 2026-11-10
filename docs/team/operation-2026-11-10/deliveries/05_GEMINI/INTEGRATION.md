# Контракт интеграции с Codex / OpenCode (`INTEGRATION.md`)

- **Исполнитель:** Gemini (`05_GEMINI`)
- **Ветка:** `ops/gemini-browser-research`
- **Отдельный интеграционный коммит:** `607d848` (`feat(05_GEMINI-integration): separate browser shell host and Work runtime coordinator integration`)

## 1. Перечень файлов в отдельном интеграционном коммите

1. `desktop/windows/browser/shell.cjs` — адаптер `KosworkBrowserShellHost` для подключения реального Chromium CDP движка (`KosworkBrowserEngine`) и цикла `executeMultiSiteResearchWorkflow` к Electron Main / Native Host без изменения `Windows main`, памяти, основного `chat/sidebar`, ключей или конфигурации провайдеров.
2. `desktop/windows/ci/unified-task-coordinator.cjs` — добавлен метод `executeLiveBrowserDeepResearchTask(plan, { signal })` в существующий координатор `KosworkUnifiedTaskCoordinator` (используется действующий Work runtime без создания второго планировщика).

## 2. Канонические точки стыковки для Codex

- **Main / Native Host (`desktop/windows/browser/shell.cjs`):**
  - `new KosworkBrowserShellHost({ allowedWorkspaceRoot, allowedDownloadDir, maxLiveTabs: 3, allowedSessionIds, searchAdapterOptions })`
  - Вызов команд: `handleShellCommand(command, payload, { signal })` (`browser:navigate`, `browser:observe`, `browser:find-in-page`, `browser:read-long-page`, `browser:fill-form`, `browser:select-files`, `browser:submit-form`, `browser:search`, `browser:open-search-result`, `browser:deep-research`).
- **API Research (`apps/api/src/research/index.ts`):**
  - `createResearchRouter(service)` обслуживает маршруты `POST /api/research/sessions`, `POST /api/research/sessions/:id/sources`, `POST /api/research/sessions/:id/evidence`, `POST /api/research/sessions/:id/finalize`, `GET /api/research/sessions/:id`.
- **Экспорт Office / Workspace артефактов (`desktop/windows/browser/research-report-builder.cjs`):**
  - Использует существующие адаптеры Codex: `desktop/windows/workspace/workspace-service.cjs`, `desktop/windows/workspace/word-report-builder.cjs` (`saveWordReportToWorkspace`) и `desktop/windows/workspace/excel-workbook-builder.cjs` (`saveWorkbookToWorkspace`).
