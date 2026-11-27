# 11_OPENCODE — интерфейсы

## Изменённый интерфейс

`codeAgentViewState(run: CodeAgentRun)` в `apps/api/src/code-agent/service.ts` —
чистая проекция состояния задачи для владельца. Используется `CodeAgentService.view()`
для всех GET/POST ответов (/code-agent routes).

Входы: полный `CodeAgentRun` из `CodeAgentStore` (внутреннее состояние).
Выходы: владельческое представление без `snapshot`, `owner_id`, `actor_id`,
`workspace_scope`, `repository_paths`, `output_checkpoint`.

События: нет (чистая функция). Принадлежность данных: `apps/api/src/code-agent/`.

Сохранённые контракты:

- `publication_token` остаётся в представлении — это одноразовое доказательство
  владельца для `/:id/publish`; UI использует его как precondition.
- `proposal`, `proposal_hash`, `proposal_diff`, `check`, `draft`, `log`, `usage`,
  `capabilities` не изменились.
- `CodeAgentStore` по-прежнему хранит `output_checkpoint` для восстановления
  после перезапуска; удаления из durable-состояния нет.

## Внешние интерфейсы (используются без изменений)

- Executor: `CodeAgentWorkspaceRunner.run({files, check, expectedDigest, signal})`
  из `@cosmora/tool-runtime`. В приёмке используется детерминированный runner,
  пишущий снимок в изолированный git-репозиторий и запускающий `node --test`.
- GitHub: `GithubIntegration.prepare/publish/reconcile`, `GithubDraftStore`.
  В приёмке — fixtured HTTPS-ответы, полностью проверенные `validResponse`.
- Политика: `GuardedToolRuntime` через `guarded()`; разрешения
  `sandbox.experiment`, `workspace.write`, `integration.private.use`,
  `external.communicate` сохраняются.

## Временные фикстуры (не выдаются за подключённые сервисы)

- Локальный git-репозиторий с функцией `add(a,b)` и тестом.
- Fixture HTTPS GitHub (только в тестах).
- Детерминированный executor (в локальной приёмке); настоящий OCI runner
  требует `CODE_AGENT_TEST_IMAGE` и Docker.
- Модельный провайдер не вызывается: diff импортируется через `/import-diff`.
