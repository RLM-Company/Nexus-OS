# Kosmora Research 23–24 — синтез + owner accounting (2026-10-09)

## Точная база

Эта итерация — **дельта к пакету** `kosmora-research-23-24-files.zip` от 2026-10-08, который сам построен на tracked ZIP `b15912d23ab15a99e38370e22e472faf28c99961`. Применять **после** предыдущего полного пакета, не к голому b159. `feature.patch` не меняет центральные API app/server, top-level barrels, global navigation, общие миграции или package/lock. `integration.patch` меняет ТОЛЬКО `apps/api/src/app.ts` + `apps/api/src/server.ts`. Другие локальные ветки могут конфликтовать именно в этих двух точках — интегратор переносит вручную.

## Готовые функции

- Ограниченный SearxNG → безопасное чтение (прежние IP/DNS pinning, no redirects, robots, byte/time limits) → сохраняемые выдержки.
- Опциональный модельный синтез через **существующие** `ManagerService.buildRequest` + `ModelGateway.stream`, без фиктивной генерации, fallback запрещён, prompt строго выводит структурированный JSON. Инструменты / `tool_calling` не используются. Модель видит только вопрос и реально прочитанные отрывки; веб-контент — данные, не команды. Исследователь явно включает «Синтезировать моделью» или жмёт отдельную кнопку после чтения. Новых реальных вызовов при сборке и тестировании нет.
- Проверка всех ссылок модели: только пары `S#:E#`, существующие `ResearchSource.passages`, с проверкой структуры/размера текста. Выдуманные URLs, номера источников, номера выдержек отклоняются. Проверяется **наличие основания**, но не семантическая истинность каждой фразы — поэтому отчёт не обещает независимого фактчекинга.
- `summary`, `disagreements`, `gaps`, связанные с реестром источников; Markdown/HTML экспорты уже содержат модельный ответ и исходные выдержки. В UI видны этап, число проверенных адресов, режим учёта, сохранённые ответы, расхождения, пробелы и привязки цитат.
- Один синтез за запуск с durable `model.run_id` и фазами. `route.selected` → **reserve до remote dispatch**, `response.completed` → canonical usage reconciliation, неполная/неизвестная стоимость сохраняет reserved hold. Crash / cancel / pause после возможной отправки запрещает auto retry. Явный `POST /retry` допустим только когда нет неизвестного расхода. Output JSON проверяется **после** settlement, чтобы ошибки цитирования не стирали фактический расход.
- Owner scoped `ResearchPrivacyAdapter`: `quiesce(owner)` → `export(owner)` (метаданные, отчёт и полный сохранённый state) или `delete(owner)` с запретом поздних записей; после export без удаления `release(owner)` вызывается только общим координатором. Usage ledger / audit не удаляется.

## Подключение

1. Установить предыдущий пакет 23–24. Убедиться, что управляемая миграция **0028 (research)** из основной интеграционной копии применена до старта API и создаёт `research_v1_runs` с полями `id, owner_id, project_id, status, payload_json, created_at, updated_at` и owner индексом. Исходный `apps/api/src/research/migration.sql` в ZIP — **только справочный** эквивалент таблицы. `ResearchStore` больше никогда не делает startup DDL. **0033 / idx33 / when1791580800008 НЕ нужен**, все новые метаданные живут внутри JSON `payload_json`. Не перенумеровывать 0025/0026/0027/0028.
2. `git apply kosmora-research-synthesis-feature.patch`, затем минимальные соединения `integration.patch` (по возможности вручную, чтобы не перезаписать параллельные правки). Новые файлы `research-synthesis.ts`, `research-privacy.ts`; новые тесты. В `server.ts` создаётся `ProjectResearchOwnerBudget(database.sqlite, projectStore)`, работающий через существующие `ProjectStore.reserveModelUsage` / `ProjectStore.completeRun` и существующие `runs` + `model_usage_ledger`. Никаких новых финансовых таблиц или обхода лимитов. **Когда общий AccountStore.ownerBudget станет доступен в main, замените только `ResearchOwnerBudget` адаптер**; вызовы reserve/settle/uncertain обязательны. При отсутствии общего accounting НЕ передавать `ownerBudget`: `model_usage=unavailable`, синтез невозможен.
3. Зарегистрировать `ResearchPrivacyAdapter(researchStore, coordinator)` в общей owner privacy coordinator после получения coordinator из `registerResearchRoutes`; обязательные методы `quiesce/export/delete` реализованы, но shared privacy registry в исходном b159 отсутствует и сознательно не меняется в feature patch. Owner privacy orchestrator должен сначала quiesce все адаптеры, затем выгрузить или удалить. Не вызывать `release` во время удаления.
4. Провести `pnpm --filter @cosmora/api typecheck`, `pnpm --filter @cosmora/api test`, `pnpm --filter @cosmora/web typecheck`, а также E2E на чистой integration copy. Проверить gateway модели в **mock adapter only** до отдельного owner approval для платного smoke.
5. Проверить реальные migrator schema, заполненность project ledger, алгоритм расчёта цены. Цена/usage в старом route могут быть неизвестны; в таком случае committed monetary cost НЕ подставляется и reserved hold остаётся на ledger для ручной сверки. Нет автоматического удаления/обнуления удержаний.

## Безопасность и ограничения

Текущие `ResearchPageReader` и SearxNG adapter **не менялись** — остаются public IP/DNS pinning, no redirects, no credentials/cookies, отказ от robots-denied, лимиты bytes/pages/time и дедупликация. Полный text source не сохраняется — только реально отобранные excerpts.

### Локально проверено

10 автономных Node 22 / SQLite / реальный TypeScript->JS транспиляционный smoke checks: managed DDL, создание checkpoint, синтез через детерминированный gateway event stream и fake ledger hook, source/excerpt validation, реальный HTML/Markdown экспорт, неверная цитата после settlement, cancelled late result / uncertain hold, quiesce/privacy/delete и crash recovery. Все изменённые TypeScript/TSX файлы прошли TypeScript parser/transpile syntax check. `git diff --check` и применимость обоих патчей к **точному предыдущему пакету** проверяются при выпуске.

### Непроверено / действия интегратора

Нет `node_modules` и загрузки pnpm: полный TypeScript semantic typecheck, vitest и Next.js build **не выполнялись**. Никаких живых платных запросов, внешних публикаций или выкладки VPS. Runtime API routes / E2E / настоящая 0028 main migration и будущий общий AccountStore должны проверяться в интеграционной копии. Privacy registry в b159 отсутствует — подключение к нему остаётся отдельной минимальной интеграцией. Не выдавать этот пакет за полностью проверенный production release.
