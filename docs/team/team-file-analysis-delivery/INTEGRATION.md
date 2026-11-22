# Интеграция: анализ файлов (команда `team/file-analysis-delivery`)

Передача Codex по блоку «Анализ файлов» из «Инструкции 3 этапа», взятой по
команде владельца «делаем все, что не делают другие» (20 ноября 2026).
Параллельные ветки ведут Koscode (#609), MCP (#610), Koswork (#611); чат/проекты
(#612), реестр интеграций (#603) и Koswork-сценарий (#606) слиты мной ранее.

**Ветка:** `team/file-analysis-delivery`, база `main` `db06774c`. Коммиты:
`b4ab5543` (срез 1), `7ce046b2` (2), `8bd49cd2` (3), `4cfefbe4` (4/карта).
PR будет открыт отдельно; merge за Codex/владельцем.

## Критерий инструкции

«Итог ссылается на файлы и страницы. Отчёт показывает покрытие, пропуски и
ошибки, включая частично обработанные пакеты».

## Что сделано

1. **Вложенные ZIP** (`apps/web/src/app/library-archive-import.ts`): ровно один
   вложенный уровень ARCHIVE_DEPTH=2 с лимитом 8 архивов, breadcrumb-метки
   (`outer › inner.zip › doc.txt`). Превышение глубины/лимита или битый вложенный
   архив увеличивает `skipped` → владелец видит «Пропущено файлов в ZIP: N».
   Все проверки `BoundedZip` сохранены. 5 unit-тестов.
2. **Unit-покрытие отчёта** (`apps/web/src/app/studio-files-report.test.ts`):
   `answerCoverageLines`/`answerReportLines` проверяют разобранные/ошибочные/
   необработанные фрагменты, страницы с текстом, явное «Всего страниц
   неизвестно», только процитированные источники с стр./строками. 4 теста.
3. **Повтор deep-запуска** (`apps/api/src/document-answer-service.ts`,
   `document-answer-routes.ts`): `POST /answers/:id/retry` создаёт новый run
   для `cancelled`/`failed` deep-запуска с тем же вопросом/файлами и fresh
   coverage; owner/project fence, активный deep → 409, search → 422. Старый run
   остаётся историей, его неопределённый расход не освобождается молча. API-тест.
4. **Видимость пропусков** подтверждена: `saveProgress()` сохраняет coverage
   до `INCOMPLETE_COVERAGE`, поэтому при failed-запуске пропуски доступны через
   `GET /answers/:id`; unit-тесты среза 2 это проверяют.

## Чего НЕ трогали

Сайдбар, стартовый экран чата, логотип, стили. Новых прав, OAuth, MCP, платных
вызовов и выкладки нет. Не меняли fail-closed семантику `INCOMPLETE_COVERAGE`
(сейчас run → failed) — это продуктовый компромисс на решение владельца.
`status.json` не менялся; живая приёмка этапа 1 не объявлена завершённой.
Зоны Claude/DeepSeek и чужие правки chat-export/scripts в дереве не тронуты.

## Подтверждённые проверки (fixture, без ключей)

| Проверка                                                       | Результат |
| -------------------------------------------------------------- | --------- |
| `apps/web`: `library-archive-import.test.ts`                   | 5 passed  |
| `apps/web`: `studio-files-report.test.ts`                      | 4 passed  |
| `apps/api`: `document-answer-http` + `document-answer-service` | 5 passed  |
| eslint / tsc / Prettier (apps/web, apps/api)                   | exit 0    |

E2E локально не запускаются (`playwright.config.ts` требует `pnpm`, нет в PATH);
deep-кнопка/отчёт остаются за CI.

## Проверка для Codex

```bash
# среда с pnpm:
pnpm --dir apps/web exec vitest run src/app/library-archive-import.test.ts src/app/studio-files-report.test.ts
pnpm --dir apps/api exec vitest run test/document-answer-http.test.ts test/document-answer-service.test.ts
pnpm --dir apps/web exec eslint src/app/library-archive-import.ts src/app/studio-files-report.test.ts
pnpm --dir apps/api exec eslint src/document-answer-service.ts src/document-answer-routes.ts
pnpm --dir apps/web exec tsc --noEmit
pnpm --dir apps/api exec tsc --noEmit
pnpm exec prettier --check apps/web/src/app/library-archive-import.ts apps/web/src/app/studio-files-report.test.ts apps/api/src/document-answer-service.ts apps/api/src/document-answer-routes.ts
```

Ожидаемо: вложенный ZIP даёт breadcrumb-метки и честный `skipped`; coverage
отображает analyzed/failed/pending; повтор терминального deep-run создаёт новый
run и не трогает старый.

## Риски и открытые вопросы для Codex/владельца

1. Fail-closed `INCOMPLETE_COVERAGE` → failed: пропуски видны в coverage, но
   полный отчёт не генерируется. Менять на частичный отчёт — отдельное решение.
2. UI-кнопки повтора deep-run нет (endpoint есть) — точечный UI-запрос.
3. E2E «Подробный анализ»/deep-отчёт, deep-cancel/quiesce, >1 000-page deep run,
   abort OCR — непокрытые сценарии; e2e только в CI.
4. Автораспределение работы — фиксированный пул 3 воркеров без DAG/очереди;
   Multi-Agent оставляем последним.

## Следующий шаг

По команде владельца: решение о fail-closed vs частичном отчёте, UI-кнопка
повтора, либо живые/plated замеры — отдельные поручения. Карта:
`docs/handoff/TEAM_FILE_ANALYSIS_DELIVERY_2026-11-20_RU.md`.
