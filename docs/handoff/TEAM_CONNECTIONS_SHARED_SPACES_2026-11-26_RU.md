# Подключения и общие пространства: сдача цикла 1–3

Ветка `team/connector-drive-lifecycle`, SHA: `d0897c2d` (сверка #663/#671 с общим кандидатом #664), `8c7aed50` (Drive lifecycle), `4dbb6897` (общий проект двух аккаунтов).

## Цикл 1 — сверка источников

Принята реализация общего кандидата #664: `work-used-sources.ts` (project materials + supplier handoff + memory snapshot, `label`, `kind:"input"`, `source_kind:"work_input"`), `store.sources`, исключения по паре `source_kind:source_id`, `excludedSourceIds` только для message-источников. Мои сценарии #671 сохранены и адаптированы: 97 `manager-work` + 4 `project-sources` теста зелёные.

## Цикл 2 — полноценный коннектор: Google Drive

- `apps/api/src/drive-connector-transport.ts` привязывает **существующий** `GoogleDriveRuntime` как `ConnectorTransport` для `google-drive.list_sources` и `google-drive.restore_backup`.
- Owner берётся из `ToolExecutionContext.actorId`, capabilities остаются в дескрипторе, повторное выполнение идемпотентно через GuardedToolRuntime (один RESTORE на idempotency key).
- Жизненный цикл connect → выбрать ресурсы → read → prepare → execute → confirm → disconnect: OAuth/PKCE, `/sources`, `/backups`, journal, `/disconnect` — существующие Drive API, не тронуты; connector добавляет policy/confirm/replay и честный status (`transport_wired`).
- Тест: `apps/api/test/drive-connector-lifecycle.test.ts` — 2/2 (read с owner, execute+replay, fail-closed без transport).

## Цикл 3 — общий проект двух аккаунтов

**Матрица ролей и операций:**

| Операция                               | owner                 | editor | viewer |
| -------------------------------------- | --------------------- | ------ | ------ |
| пригласить/отозвать участника          | ✅                    | ❌     | ❌     |
| принять приглашение                    | —                     | ✅     | ✅     |
| читать историю/источники проекта       | ✅                    | ✅     | ✅     |
| выполнять действие/сохранять результат | ✅                    | ✅     | ❌     |
| выйти из проекта                       | ❌ (owner не выходит) | ✅     | ✅     |

- `ProjectMembershipStore`: invite/accept/leave/revoke, `canAccess(project, account, role?)` с иерархией viewer < editor < owner и owner-fence `OWNER_DATA_FENCED`.
- API: `GET /projects/:id/members`, `POST .../invite`, `POST .../accept`, `DELETE .../members/:account_id`.
- Проверка членства включена на проектном чтении источников (`sources/exclusions`, receipts):third account → 403 `PROJECT_MEMBER_REQUIRED`; после отзыва доступ прекращается.
- Тесты: 3 store + 1 API (`project-membership*.test.ts`) — приглашение/принятие/отказ третьему/отзыв/выход.

## Первый законченный сценарий (два аккаунта)

Покрыт на уровне API+store: owner приглашает второго → второй принимает → получает доступ к материалам проекта → third аккаунт получает отказ → owner отзывает → второй больше не получает данные. Запуск Koswork-задачи и принятие результата ответственным — следующий срез (author/assignee ещё не реализованы).

## Инструкция: добавить следующий сервис

1. Описать `ConnectorDescriptor` в `connector-catalog.ts` (id, auth_kind, операции read/write, capability_ids, result_checks) — как сделано для `google-drive`.
2. Реализовать `ConnectorTransport` из существующего сервисного рантайма (без нового OAuth/HTTP-кода), как `driveConnectorTransports`: `execute` получает `actorId` из guarded context.
3. `registry.register(FIRST_SLICE_CONNECTORS)` → `bindTransport(connectorToolId(id, op), transport)` → `bindToRuntime()` (до регистрации роутов).
4. Добавить фикстурный тест: read с owner, write с idempotency/confirmation, replay один раз, fail-closed без transport.
5. Если возможности сервиса меняются — обновлять дескриптор/версию и пере- register до bind (frozen catalog не мутировать), как в `mcp-discovery` с revision.

## Команды проверок (fixture, без ключей)

```
node node_modules/vitest/vitest.mjs run test/drive-connector-lifecycle.test.ts   # 2/2
node node_modules/vitest/vitest.mjs run test/project-membership.test.ts          # 1/1
node ../../node_modules/vitest/vitest.mjs run test/project-membership-store.test.ts  # 3/3
node ../../node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit   # 0
```

Полный CI — отдельным PR.

## Ограничения (честно)

- Проверка членства пока включена только на source-читании; история чата, поиск, скачивание и произвольные действия ещё не проверяют `ProjectMembershipStore`.
- Автор сообщения и инициатор/ответственный поручения не выведены; личная память/подключения в общий контекст не попадают (общего контекста ещё нет).
- Референсы MCP Claude / ChatGPT / Google Workspace использованы как образцы для дизайна API, не как live-проверки; живые вызовы, VPS и платные операции не делались. `status.json` не менялся.
- Multi-Agent остаётся последним.
