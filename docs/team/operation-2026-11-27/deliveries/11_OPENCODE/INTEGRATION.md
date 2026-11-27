# 11_OPENCODE — интеграция

## Изменения общих файлов

Нет. Не трогались `apps/api/src/app.ts`, `apps/api/src/server.ts`, корневые
exports/config/lockfile, общие контракты `packages/contracts`, миграции и `main`.
Все изменения находятся в зоне `apps/api/src/code-agent/` и её тестов, а также
в собственной папке отчётов `deliveries/11_OPENCODE/`.

## Подключение функции

Функция уже подключена в production через существующий вызов
`registerCodeAgentRoutes(app, code, identityFor)` в `apps/api/src/app.ts`.
Изменён только внутренний метод `CodeAgentService.view()`, который используется
всеми существующими маршрутами; новый integration commit не требуется.

## Зависимости от других исполнителей

- Harness 3 (GitHub connector/auth): используется существующий
  `GithubIntegration`/`GithubDraftStore` без изменений. Живой Koscode-путь
  согласуется с его приёмкой.
- OpenCode 1 (executor environment): используется существующий
  `CodeAgentWorkspaceRunner`; OCI image должен быть предоставлен оператором
  для live acceptance.
- OpenCode 3 (developer API): пересечений нет.
- Интегратор: никаких новых DTO, exports или миграций для сведения нет.

## Проверка после включения

```
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-agent-github-tree.test.ts test/code-proposal-input.test.ts test/code-agent-view.test.ts test/code-agent-workbench.acceptance.test.ts --testTimeout=30000
pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-diff.test.ts test/code-agent-result.test.ts test/code-agent-sidecar.test.ts test/code-agent-workspace.test.ts --testTimeout=30000
pnpm --filter @cosmora/api typecheck
pnpm --filter @cosmora/api exec eslint src/code-agent/service.ts test/code-agent-view.test.ts test/code-agent-workbench.acceptance.test.ts
```
