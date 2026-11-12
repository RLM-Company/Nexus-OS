# CHECKPOINT — 05_GEMINI, срез A

- **Обновлено:** срез A готов к интеграции; петля продолжается.
- **BASE_SHA:** `1c07f8dc291b38d0faf92088c53e704e348d0256`.
- **Ветка:** `ops/gemini-evidence-rework` (новая; чужой активный #548 не тронут).
- **PR:** открывается в `main`, без merge/deploy. HEAD_SHA — `git log -1` ветки.
- **Переназначение:** задание именует Gemini; взято по прямому указанию владельца.

## Выполнено (срез A)

1. Разведка: `reference/gemini-operation-20261110` (`b992e639`) неприменим;
   активный runtime — `apps/api/src/research/*`, `packages/core/src/research/index.ts`.
   BACKLOG.md составлен. Прототипы/второй store не подключались.
2. `verifyResearchClaim()` в существующем research-модуле: привязка к доверенному
   снимку/версии/digest, числа с границами и единицей, разделение
   `source_quote_verified` и `claim_assessment`, `unconfirmed` при неоднозначности.
3. Подключение к `researchMarkdown()` — не helper-only. 8 регрессий на три
   false-positive из REWORK_TASK + подмену digest/единицу/отрицание.
4. Проверки: core 414, api research 10; typecheck/lint/prettier/secrets зелёные.

## Точка продолжения (срез B)

- Snapshots / dedup / bounded research / contradictions через те же
  `research-store`, `research-coordinator`, `research-synthesis`, `page-reader`.
- Не выбирать победившее значение по большинству дублирующих сайтов, не стирать
  противоречия, не называть эвристику семантическим доказательством.
- Сохранять restart/cancel/owner-project isolation/privacy lifecycle.
- Обязательно: не трогать chat/sidebar/global CSS, gateway/credits, provider
  keys, OS-права, чужие ветки; общие hooks — отдельный маленький commit.
- Известно: `\b` не работает с кириллицей (использовать lookbehind/lookahead
  по `\p{L}`); проверку неоднозначности ставить ДО сравнения с выдержкой.

## Правила

Статус не выше «готово к интеграции». Отчёты только в своём каталоге. Внешние
зависимости — фикстуры. Не читать .env/токены/БД пользователей; не слать
сообщения, не публиковать, не merger без указания, не VPS, не обучать веса, не
включать Multi-Agent/Jarvis. Фонового процесса нет.
