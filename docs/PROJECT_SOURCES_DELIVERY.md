# Источники в задаче: просмотр, исключение, история запусков

**Ветка:** `feature/project-source-usage` от `main` `e6736e0b`.
**Зона:** сбор сведений об источниках, API просмотра и исключения, проверки
прав доступа. Общий экран результата делает GPT-разработчик (здесь не трогался).

## Что переиспользовано

- Линейные данные происхождения `ContextMemorySource` / `ContextMemoryEvidence`
  (`kind`, `message_id`, `chat_id`, `project_id`, `role`, `quote`, `sha256`,
  `reference`, `version`, `excerpt_only`).
- `MemoryUsageSnapshot.sources` — квитанция фактически переданного пакета.
- Точные координаты фрагментов `KnowledgeReference` / `ArtifactContextSource`
  (`version`, `sha256`, `start/end`, `excerpt_sha256`, `page`, `line_start/end`).
- Канонический путь открытия фрагмента
  `GET /api/v1/memory/targets/:kind/:targetId/source?reference=...&offset=...`
  (`sourceFor` проверяет owner/grants/версию/хеш и отдаёт точный срез).
- Шаблон project-scoped выбора: `owner` + `project` + `expected_version` CAS
  - fence `kosmora_owner_data_lifecycle` + `private, no-store`.

## Реализовано

- `packages/contracts/src/project-sources.ts` — `UsedSource`, `SourceExclusion`,
  `RunSourcesView` (ограничения размеров, 128 ссылок на запуск).
- Миграция `0072_project_sources.sql` + запись в `meta/_journal.json`:
  `project_source_exclusions` (ключ owner/project/kind/source_id),
  `project_source_settings` (CAS version), `project_run_sources`
  (immutable приёмка по run_id), fence-триггеры.
- `packages/db/src/project-source-store.ts` — exclusions view/CAS, запись и
  чтение receipt'а запуска, `excludedSourceIds(project, owner)`, проверки
  владельца и fence. Историческая приёмка не перезаписывается: повтор с другим
  набором ссылок даёт `RUN_SOURCES_CONFLICT`.
- `apps/api/src/project-source-routes.ts`:
  - `GET/PUT /api/v1/projects/:projectId/sources/exclusions` — просмотр и CAS-изменение;
  - `POST /api/v1/projects/:projectId/sources/run` — сохранить фактические ссылки запуска;
  - `GET /api/v1/projects/:projectId/sources/run/:runId` — исторический результат
    с полем `excluded_now` (источник исключён сейчас, но остался в истории).
- Исключение действует в следующем запуске: `registerContextMemoryRoutes`
  получает `excludedFor(target, owner)` и передаёт id в штатный
  `resolveAsync(..., excludeMessageIds, ...)`; для project-target список берётся
  из `ProjectSourceStore.excludedSourceIds`.

## Два последовательных прогона (тест `apps/api/test/project-sources.test.ts`)

1. **Прогон 1:** `POST .../sources/run` с `run_id=run-1`, источники `msg-a`,
   `msg-b` → приёмка из 2 ссылок.
2. Пользователь исключает `msg-a`: `PUT .../sources/exclusions`
   `{expected_version:1, exclusions:[{source_kind:"project_message",source_id:"msg-a",...}]}`
   → version 2.
3. **Прогон 2:** `POST .../sources/run` с `run_id=run-2`, только `msg-b`.
4. Проверка истории: `GET .../sources/run/run-1` возвращает обе исходные ссылки
   с quote `Источник: 19 700 ₽` и `excluded_now:["msg-a"]`; второй прогон — одну ссылку.
5. Дополнительно на уровне store доказано, что `excludedSourceIds` реально
   убирает `19 700` из `resolve()` следующего запуска, оставляя `18 000`.

Проверка прав: чужой owner получает 404 `PROJECT_NOT_FOUND`; устаревший
`expected_version` — 409; при отзыве доступа к файлу (`state='deleting'` в
`kosmora_owner_data_lifecycle`) запись нового receipt'а отклоняется с
`OWNER_DATA_FENCED`, а сохранённые байты истории остаются в таблице.

Открытие нужного фрагмента по ссылке — через существующий
`GET /api/v1/memory/.../source`; ссылка из receipt'а содержит `reference`,
`version`, `sha256`, координаты и quote, поэтому фрагмент проверяется до показа.

## Проверки

```
pnpm install --frozen-lockfile
pnpm --filter @cosmora/db exec vitest run test/project-sources-store.test.ts   # 2 passed
pnpm --filter @cosmora/api exec vitest run test/project-sources.test.ts        # 3 passed
pnpm --filter @cosmora/db typecheck                                            # exit 0
pnpm --filter @cosmora/api typecheck                                           # exit 0
```

Prettier изменённых TS-файлов — чисто. Живые провайдеры, VPS, ключи и общий UI
не трогались.
