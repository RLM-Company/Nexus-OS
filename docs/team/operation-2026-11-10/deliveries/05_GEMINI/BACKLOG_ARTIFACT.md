# BACKLOG — 05_GEMINI, срез D

- **BASE_SHA:** `f7864e286c96905883cea1c9fce930a82cec5217`.
- **Ветка:** `ops/gemini-research-artifact`.

## Пробел (п.6 `05_GEMINI.md`)

`/api/v1/research/:id/artifacts` — только метаданные + `download_url`.
Текущий hook `/api/v1/projects/:id/materials/artifacts` принимал `source.kind`
лишь `canvas|table|work`. Завершённый отчёт не мог стать источником материалов
проекта.

## Выполнено

1. `ArtifactContextKind` += `research`; опциональный `ResearchStore`.
2. `list()`: завершённые отчёты проекта/владельца как кандидаты с sha256
   `researchMarkdown(run)` и `version: 1`.
3. `preview()`: тот же ограниченный текстовый снимок; stale sha/версия → 409,
   незавершённый/чужой → 404.
4. Отдельный integration commit для `app.ts` (передача `researchStore`).
5. UI: только метка `research`, без redesign.

## Не трогаем

Chat/sidebar/global CSS, gateway/credits, provider keys, grants, paid/live calls,
второй store, Work runtime, чужие ветки (#548).

## Осталось за живой средой

Отмена/продолжение, live/CDP цикл, живая передача результата в проект.
