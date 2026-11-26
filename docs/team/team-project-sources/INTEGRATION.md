# Интеграция: источники Koswork — API и доказательства (#663 continuation)

Передача интегратору. Зона: рабочий сервер, сборка контекста Koswork, иммутабельные
квитанции источников, права и правила исключения. Общий экран результата ведёт
второй разработчик — в этой поставке его нет.

**Ветка:** `team/sources-663-wiring`, база `main` `e6736e0b`.
**SHA коммитов:** `4b404caf` (API #663), `59f72852` (server wiring),
`8ba98496` (запись из сформированного запроса), `7bf91648` (исключение в следующем
запуске), `560e9217` (версия/удаление/отзыв доступа).

## Что подключено

- `ProjectSourceStore` создаётся в `apps/api/src/server.ts` и передаётся в
  `buildApp` и `ManagerWorkCoordinator` (раньше #663 регистрировал роуты только в
  тестах — рабочий сервер оставался без хранилища).
- Koswork `execute()` после `contextMemoryUsage(request)` пишет квитанцию из
  **фактически сформированного** `ModelRequest`: `reference`, `source_id`,
  `version`, `sha256`, `quote` (обогащается из `recalled.items` по reference),
  `excerpt_only`. Источник не выдумывается: пустая representation `"unverified"`
  даёт пустой список.
- `excludedSourceIds(project, owner)` передаётся и в `resolveAsync`, и в fallback
  `resolve()` — исключение действует на следующий запуск Koswork.
- Старый запуск не перезаписывается: `recordRunSources` даёт 409
  `RUN_SOURCES_CONFLICT` при другом наборе; `GET .../run/:runId` возвращает
  `excluded_now` для текущих исключений.

## API (из #663, теперь на рабочем сервере)

- `GET/PUT /api/v1/projects/:projectId/sources/exclusions` — просмотр/CAS-изменение.
- `POST /api/v1/projects/:projectId/sources/run` — записать фактические ссылки.
- `GET /api/v1/projects/:projectId/sources/run/:runId` — история с `excluded_now`.
- Открытие точного фрагмента — существующий
  `GET /api/v1/memory/targets/:kind/:targetId/source?reference=...&offset=...`.
  Он проверяет текущие settings/grants/owned/lifecycle и версию/хеш на каждом
  чтении; при отзыве доступа отдаёт 404/409, даже если квитанция сохранена.

## Сценарии и доказательства

| Сценарий                                     | Где проверено                                                                                                   | Результат                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Источники из сформированного Koswork-запроса | `apps/api/test/manager-work.test.ts` → «records sources from the actually formed Koswork request»               | ✅ receipt с id/version/sha256/quote/reference                                          |
| Два запуска с исключением между ними         | там же → «applies an exclusion to the next formed Koswork request…»                                             | ✅ `19 700` исчезает из II запроса, `18 000` остаётся; run-1 immutable + `excluded_now` |
| Изменение версии/контента материала          | `apps/api/test/project-sources.test.ts` → «keeps the historical quote when the source document changes version» | ✅ 409 conflict, старые байты receipt                                                   |
| Удаление материала                           | там же → «keeps the receipt after the underlying material is deleted»                                           | ✅ receipt сохранён                                                                     |
| Отзыв доступа                                | там же → «delivers the exact fragment only while current access allows it» + #663 `OWNER_DATA_FENCED`           | ✅ выдача фрагмента denied, исторические байты в таблице                                |
| Чужой owner / stale CAS                      | #663 `project-sources.test.ts`                                                                                  | ✅ 404 / 409                                                                            |

## Команды проверок (fixture, без ключей/VPS)

```
node node_modules/vitest/vitest.mjs run test/project-sources.test.ts   # 6/6
node node_modules/vitest/vitest.mjs run test/manager-work.test.ts     # 96/96
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit  # exit 0
node ../../node_modules/prettier/bin/prettier.cjs --check <modified files>  # clean
```

(в CI: `pnpm --filter @cosmora/api exec vitest run ...`, `pnpm --filter @cosmora/api typecheck`,
`pnpm format:check`; `test:privacy` требует собранного `dist`, что CI делает через `pnpm build`.)

## CI

Migration `0072_project_sources.sql` + journal от #663 принимаются `runMigrations`
во всех тестах. `privacy-coordinator.node.mjs` требует `apps/api/dist` (собирается
в CI до `test:privacy`); локально без `dist` он не запускается — это не регрессия.
Prettier по всем изменённым файлам и committed-блобам — чистый.

## Ограничения

- Живые провайдеры, VPS, платные вызовы и общий UI не трогались. `status.json` не менялся.
- Исходные координаты `page/line` для memory/history-источников пока не заполняются
  (snapshot их не несёт); схема `UsedSource` допускает их отсутствие. Для
  document/dataset-источников можно добавить на месте в следующий срез по отдельному решению.
- Второй разработчик: общий экран результата и визуальное дерево источников.
