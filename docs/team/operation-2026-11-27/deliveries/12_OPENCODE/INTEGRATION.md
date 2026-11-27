# INTEGRATION — OpenCode 6

## Минимальное подключение (integration commit)

- `apps/api/src/app.ts`: импорт `registerAutomationRoutes`, опция `automationStore`,
  регистрация при наличии `automationStore + projectStore + managerWorkStore +
  managerWorkCoordinator`. Существующие `/workflows` и `/scheduled-dispatches`
  не changing.
- `apps/api/src/server.ts`: создать `AutomationStore(database.sqlite)` и передать
  в `buildApp`. Нового процесса/таймера нет.
- `packages/contracts/src/index.ts`: добавочный `export * from "./automation.js"`;
  `workflows.ts` получает опциональные `conditions`/`confirmations`.
- `packages/core/src/index.ts`: `export * from "./automation.js"`.
- `packages/db/src/index.ts`: `export * from "./automation-store.js"`.
-Миграция `0078_automation_runtime.sql` + запись в `_journal.json` (idx 78).

## Границы

- Stars: только consumer через `StarsMissionStore` и `createStarsMission`;
  иерархия и оркестрация Stars не трогаются (Harness 1).
- Внешние события: только generic event ingestion endpoint; реальные коннекторы
  предоставляет Harness 3.
- Нет второго scheduler: `/api/v1/automation/tick` — явный серверный такт,
  использующий ту же SQLite и тот же `WorkDagCoordinator`, что и ручной запуск.

## Проверки интеграции

- `tsc --noEmit` для `packages/contracts`, `packages/core`, `packages/db`,
  `apps/api`, `apps/web` — проходит.
