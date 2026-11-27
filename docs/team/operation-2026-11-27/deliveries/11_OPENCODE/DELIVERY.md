# 11_OPENCODE — Koscode рабочая среда разработки

## Точные идентификаторы

- Репозиторий: `RLM-Company/Nexus-OS`.
- Инструкция: `docs/team/operation-2026-11-27/11_OPENCODE_KOSCODE_RU.md` из ветки
  `team/next-wave-20261127` (`210fe222a9c4c164c16d257db0198338b570debb`).
- База: `3af92583ccc8ceb49f44c0b8633955f40feaf59f` (актуальный `origin/main` на момент старта).
- Рабочая ветка: `feature/oc5-koscode-workbench-20261127`.
- Изолированный worktree: `C:\Users\Александр\Documents\Codex\2026-11-27\kosmora-oc5-koscode`.
- HEAD: `cd259fbf169ea44750461a2d236f7697e9dfb58b`.

## Законченный пользовательский сценарий

В Koscode (`/code-agent`) пользователь даёт задачу, видит immutable snapshot и
точный unified diff, выбирает изменения, запускает разрешённую проверку, получает
честный отказ, исправляет код и проходит повторную проверку, после явного
подтверждения создаёт один Draft PR. Повтор подтверждения после потери ответа
не создаёт вторую запись и не повторяет GitHub-запись.

## Реально сделанные изменения

1. `apps/api/src/code-agent/service.ts` — новая чистая проекция `codeAgentViewState`.
   Владельческие GET/POST-представления больше не содержат `output_checkpoint`
   (сырой непроверенный вывод модели с признаком `unvalidated_model_output`),
   а также внутренние `snapshot`, `owner_id`, `actor_id`, `workspace_scope`,
   `repository_paths`. Одноразовый `publication_token`, точный diff, проверенное
   доказательство проверки и журнал сохраняются: публикация не ослаблена.
2. `apps/api/test/code-agent.test.ts` —воспроизведён дефект до исправления:
   тест с прерыванием потока, где токен формы `sk-proj-...` оставался в GET-ответе.
   До правки тест падал (`expected ... to be undefined`, вывод содержал токен),
   после правки проходит.
3. `apps/api/test/code-agent-view.test.ts` — юнит-тест чистой проекции: внутренние
   поля отсутствуют, обрывки секретов не попадают в JSON, публичное состояние,
   diff, check evidence и publication proof сохраняются, исходный run не мутирует.
4. `apps/api/test/code-agent-workbench.acceptance.test.ts` — запускаемая приёмка
   полной петли на настоящем локальном git-репозитории с небольшой функцией и
   её тестом. Executor материализует неизменяемый снимок в изолированном репо
   и запускает реальный `node --test`: первая проверка честно падает, после
   исправления проходит, затем подтверждается один Draft PR.

## Проверки (точные команды и результат)

```
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts -t "never exposes an unvalidated model output checkpoint through a run view"
  ДО исправления: 1 failed (реальная утечка вывода); ПОСЛЕ: 1 passed.

pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-agent-github-tree.test.ts test/code-proposal-input.test.ts test/code-agent-view.test.ts test/code-agent-workbench.acceptance.test.ts --testTimeout=30000
  Test Files 5 passed; Tests 140 passed, 1 skipped.

pnpm --filter @cosmora/api exec vitest run test/code-agent-view.test.ts test/code-agent-workbench.acceptance.test.ts
  Test Files 2 passed; Tests 3 passed.

pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-diff.test.ts test/code-agent-result.test.ts test/code-agent-sidecar.test.ts test/code-agent-workspace.test.ts --testTimeout=30000
  Test Files 4 passed; Tests 76 passed.

pnpm --filter @cosmora/api typecheck    → EXIT 0
pnpm --filter @cosmora/api exec eslint src/code-agent/service.ts test/code-agent-view.test.ts test/code-agent-workbench.acceptance.test.ts → EXIT 0
```

замечание о надёжности: два существующих long-running теста (`code-agent.test.ts`
"never treats a model file-selection response…" и `code-agent-workspace.test.ts`
"stops an output flood…") имеют жёсткий таймаут 5000 ms по умолчанию и иногда
прерываются под параллельной нагрузкой машины. Повтор с `--testTimeout=30000`
проходит стабильно; production-код в этих тестах не менялся.

## Покрытые отказы и восстановление

Уже покрыто существующими тестами зоны и сохранено без регрессии:
отмена (`cancel`, stream checkpoint) и отсутствие поздней перезаписи; смена базы
(`GITHUB_BASE_CHANGED` до записи, токен инвалидируется); stale diff и конфликт редактора;
ошибка executor и просроченная проверка с `unavailable`; потеря ответа и повтор
подтверждения (`reconcile`, один PR, дублирующий `publish` отвергается);
чужой проект/владелец (404), политика и приватный fence.
Новый тест добавляет проверку того, что сырой непроверенный вывод модели не утекает через представление задачи.

## Живая публикация

Живой внешний Draft PR в назначенном владельцем тестовом репозитории **не выполнялся**.
Причина: в аккаунте `RLM-Company` нет выделенного тестового репозитория Koscode,
а прежняя live- база `ops/coscode-live-base-2026-11-12` отсутствует (GitHub 404).
Дополнительно локально недоступен OCI runtime (`docker` не установлен), поэтому
запуск `code-agent-live-github.acceptance.ts` невозможен. Готов runnable live
acceptance: `apps/api/test/code-agent-live-github.acceptance.ts` с
`COSCODE_LIVE_GITHUB_APPROVE=<repo>:<branch>`, `GH_TOKEN`, `CODE_AGENT_TEST_IMAGE`.
После назначения репозитория и pinned image сценарий создаёт ровно один Draft PR
и сверяет его по GitHub API. Локальная приёмка выше проверяет весь тот же цикл
без внешней записи.

## Границы

Не трогались: global sidebar, основной чат, logo, визуальный стиль, `main`, сервер,
чужые зоны (GitHub connector — Harness 3, device driver — OC1, developer API — OC3,
Office — OC4, Games — OC2). Миграций и общих файлов не добавлялось.
