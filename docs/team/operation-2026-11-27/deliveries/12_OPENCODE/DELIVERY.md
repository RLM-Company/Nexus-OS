# DELIVERY — OpenCode 6

## Точные SHA

- base: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`
- head (промежуточный PR): `1f67827a8f3d5c60c94577b314eb99228bf22073`
- branch: `feature/oc6-workflows-automation-20261127`
- PR: https://github.com/RLM-Company/Nexus-OS/pull/703
- worktree: `C:\Users\Александр\Documents\Codex\2026-11-27\kosmora-oc6-workflows`

## Пользовательская функция

Сохранённая версия процедуры запускается вручную, по событию или по расписанию с часовым поясом; видны ближайший запуск, состояние, история и причина ошибки. Между событиями модель не вызывается: серверный такт использует существующий Work DAG.

## Исходники

- `packages/contracts/src/automation.ts`, `workflows.ts`, `index.ts`, `package.json`
- `packages/core/src/automation.ts`, `index.ts`
- `packages/db/src/automation-store.ts`, `workflow-store.ts`, `index.ts`, migration `0078_automation_runtime.sql`, `_journal.json`
- `apps/api/src/automation-routes.ts`, `automation-runner.ts`, `app.ts`, `server.ts`, `workflow-routes.ts`
- `apps/web/src/app/personal-settings/automation-settings.tsx`, `page.tsx`, `apps/web/src/app/workflow-panel.tsx`
- тесты: `apps/api/test/automation.test.ts`, `automation-real-path.test.ts`, `packages/{db,core,contracts}/test/automation.test.ts`

## Команды проверки (воспроизводимые)

```
node_modules/.bin/tsc -p packages/contracts/tsconfig.json --noEmit
node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit
node_modules/.bin/tsc -p packages/db/tsconfig.json --noEmit
node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
node_modules/.bin/eslint <изменённые исходники>
cd apps/api && ../../node_modules/.bin/vitest run test/automation.test.ts test/automation-real-path.test.ts test/workflows.test.ts test/scheduled-dispatch-api.test.ts
cd packages/db && ../../node_modules/.bin/vitest run test/automation.test.ts test/workflows.test.ts test/scheduled-dispatch-store.test.ts
cd packages/core && ../../node_modules/.bin/vitest run test/automation.test.ts test/scheduled-dispatch.test.ts
cd packages/contracts && ../../node_modules/.bin/vitest run test/automation.test.ts test/workflows.test.ts
```

## Результаты

- typecheck: contracts/core/db/api/web — пройден.
- eslint изменённых исходников — пройден.
- vitest api: 19/19 (18 + 1 real-path), db: 11/11, core: 8/8, contracts: 6/6.
- Миграция 0078: повторный запуск на БД с данными, сохранение определений и проектов.

## Реальные связи vs фикстуры

- Реальные: WorkflowStore/WorkDagCoordinator/WorkDagStore/StarsMissionStore/ProjectStore, SQLite миграции, HTTP routes в buildApp, UI настроек.
- Mock: ModelProviderAdapter в тестах (детерминированный gateway), stub coordinator в юнит-тестах automation.test.ts.
- Не подключено live: реальные коннекторы Harness 3, живой VPS, внешние публикации/сообщения.

## Открытые пункты

- Живая приёмка коннекторов событий/внешних действий — после Harness 3.
- Полный CI точного SHA — запускается отдельно после финального среза.
- Дальше по очереди: расширение событийных процедур и версионирование, затем regression.
