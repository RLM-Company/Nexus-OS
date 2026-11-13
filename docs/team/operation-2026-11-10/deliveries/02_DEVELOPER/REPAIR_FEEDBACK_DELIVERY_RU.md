# Coscode: канонический feedback для повторного исправления

12 ноября 2026, ID 02_DEVELOPER. Статус: **готово к интеграции**, продолжение Draft
[PR551](https://github.com/RLM-Company/Nexus-OS/pull/551), без нового параллельного PR.
Ветка: `ops/developer-coscode-context-secrets-2026-11-12`.
ORIGINAL_BASE_SHA: `a5f6511875ef7ec116e34dd6c35ff445bdea4313`.
FOLLOWUP_BASE_SHA: `f7a67f0928fa18c0cf00e8a76c255b869cfdb64b`.
SOURCE_HEAD_SHA: `78e516ca4d7a45bf6e7356624b3673649580d2fd`.
SOURCE_TREE: `93a4bbbf28e3732b936de03d8c4f491066fc40ac`.
Remote/local source tree equality проверена; финальный docs SHA — в истории PR.
После успешного core сохранён новый main `5b6013d9f93b981de1ed2b2da3ca9269fb21c65c`
merge-коммитом `8de00758f34840cb3760d586fb1d86113a06a6a0`. Его изменения — только
LIVE_ACCEPTANCE_PLAN и отчёты03_OPENCODE; shared contracts и весь apps/packages/
desktop/scripts code идентичны проверенному source78e516c. Чужие файлы не переписывались.

## Действующий путь и исправление

`/code-agent` → сохранённая failed check → загрузка точной версии → отдельное
согласие на модельное исправление → `POST /repair-v2` → CodeAgentService.repair →
existing validator → durable repair attempt → guarded base read/model gateway →
exact edits → повтор прежнего check → новый owner review.

Раньше repair вызывал validateCodeAgentCheckResult, но игнорировал возвращаемый
канонический результат. Исторический check с неочищенными stdout/stderr/journal
мог попасть в модель и новый checkpoint, хотя redactor уже был реализован.
Две реальные регрессии на fixture runtime подтвердили наличие искусственного
токена в захваченном model request и новом repair_request.source_check.

Теперь используется именно возвращённый validator результат:

- stdout/stderr очищаются **до** excerpt в8000 символов. Полный private-key block
  удаляется до обрезки: нельзя отрезать конец и оставить его часть в запросе.
- Поле truncated учитывает размер очищенного excerpt и прежний флаг runner.
  Сокращение секрета — redaction, а не неизвестное усечение разрешённого вывода.
- Новый repair_request.source_check хранит whitelist результата, очищенный journal
  и прежние digest/status/exit/cleanup. Текущий run.check получает тот же результат
  с точными review_hash/check_type. Секрет не копируется туда повторно.
- Невалидное legacy evidence возвращает существующий REPAIR_CHECK_REQUIRED/HTTP409
  до записи попытки и dispatch, вместо непонятного HTTP500.

Числа/артикул/условие и диагностический факт expected5/actual-1 сохранены. Новых
форматов/сканеров/модельных запросов для redaction не добавлено: переиспользован
имеющийся `@cosmora/tool-runtime` validator/redactor.

Обработка применяется при новом явно одобренном repair: массовой миграции или
чистки исторических записей нет. Неотправленные старые raw rows/все остальные
каналы не объявляются прошедшими DLP. Исходные кодовые файлы не маскируются.
Порядок consent/version/budget/owner/project/base fences и лимит одной попытки
сохранены; duplicate/restart по-прежнему не запускают новый запрос автоматически.

## Изменения и интеграция

Только `apps/api/src/code-agent/service.ts` и `apps/api/test/code-agent.test.ts`.
Остальное — собственный отчёт/очередь/checkpoint/evidence в 02_DEVELOPER.
Общие contracts, routes, schemas, DB/migrations, gateway и tool registry не менялись.
Новых dependencies/runtime/executor/capabilities/прав нет. UI/layout/CSS не менялись.
Отдельный integration commit не требуется. Начальный content guard из PR551 сохраняется.

## Воспроизведение и fixtures

```sh
pnpm --filter @cosmora/api exec vitest run test/code-agent.test.ts test/code-proposal-input.test.ts test/code-agent-github-tree.test.ts test/github-integration.test.ts --maxWorkers=2
pnpm --filter @cosmora/tool-runtime exec vitest run test/code-agent-result.test.ts
pnpm check:core
```

Тестовые входы встроены в scoped tests; они вызывают настоящий service/routes/store,
временный SQLite, current guarded operations и validator. GitHub/SSE model/runner —
явные fixtures. Первая неудачная проверка затем используется actual repair-v2 route;
model fixture захватывает реальное сформированное тело запроса. Успех не берётся
из слов модели. Checkrunner здесь синтетический; новый OCI/live-model/browser прогон
этим срезом не заявляется. API модели отложен владельцем.

Шесть новых случаев проверяют model/checkpoint redaction, отмену до dispatch и
идемпотентный повтор, private-key block на границе excerpt, длинный безопасный
вывод, исходный truncated=true и отказ malformed journal без model reservation.
Входы — искусственные ключи, собранные в тесте; .env/реальные ключи/БД/ПК владельца
не читались. Остальные scoped lifecycle tests также запущены.

## Фактические проверки

- Baseline до fix:2FAILED, остальные96 filtered/not run. Assertion проверял наличие искусственного токена
  булевым результатом; сам токен не печатался в журнале.
- После production fix обе исходные регрессии2PASS, остальные96 filtered/not run.
- Два expanded прогона:146PASS+3FAIL+1SKIP и146PASS+4FAIL+1SKIP.
  Причина: новые тесты смотрели f.checked, который считает только default fixture
  runner, хотя использовался отдельный repairRunner. Ошибка исправлена spy на
  фактическом runner.run; ожидания числа исполнений сохранены, не удалены.
- После этого API/context/tree/GitHub150PASS+1opt-inSKIP.
- Canonical validator4PASS; scoped lint/secrets/diff passed.
- Полный **check:core текущего follow-up exit0**. API1065PASS+1SKIP (fresh);
  web361PASS и неизменённые пакеты использовали valid cache. Build/types/lint/format/
  secrets/privacy/profile gates passed; skips не объявляются live/OCI PASS.
  После merge документации main повторно проверяются формат/secrets/diff;
  production/test code после source78e516c не менялся.

В этой среде pnpm запускается с `pnpm_config_verify_deps_before_run=''`, чтобы
не выполнять auto-install. Зависимости pinned, новых установок не было.
Логи нормализованы только по LF/хвостовым пробелам; результаты не менялись.
Логи/exit codes/raw hashes/нормализованные SHA256SUMS — fixtures/repair-feedback-2026-11-12/.

## Интеграция и откат

Перед интеграцией — CI точного финального HEAD и свежий main; статусы старых
CI не заменяют новый. Не merge/deploy автоматически, максимум готово к интеграции.
Откат — отдельный revert follow-up source commit, без удаления source checkpoints
и без автоматического повтора уже зарезервированных модельных попыток.
До настройки ИИ API продолжать безопасные fixture проверки согласованного объёма;
живую модель не подменять фикстурой в отчёте о выпуске.
