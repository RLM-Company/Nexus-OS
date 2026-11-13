# Coscode: интеграция и доступная часть живой приёмки

12 ноября 2026, Москва. Новое поручение владельца разрешило интеграцию, настоящую
модель и тестовую публикацию. Позднее владелец указал работать с существующими правами.

## 1. Интеграция подтверждена

PR519 объединён12ноября09:31UTC: c702c0f0658a0933384be6182fb03b1b8b96c45a.
Доставка c36bee4 — предок проверенного main ea2f4aafe8e9609b678f8743a08c43d43f911f9f.
Code-agent/API, GitHub adapter, web Code, tool-runtime, contracts/gateway, проверенные
core manager/DB entrypoints и model registry после merge не менялись.
На этом main [CI43192292131](https://github.com/RLM-Company/Nexus-OS/actions/runs/43192292131)
полностью success: Browser131094505956, sandbox131094505602, monorepo131094505256.
Повторное объединение PR не выполнялось: он уже был объединён интегратором.

## 2. Реальные GitHub/HTTP/OCI, модельный этап не запущен

Создать отдельный private repo не удалось: GH отказал CreateRepository. Права не
расширялись, повторов с другими учётками/административными методами не было.
После указания работать как есть выбран изолированный workspace в существующем
RLM-Company/Nexus-OS: base ops/coscode-live-base-2026-11-12,
SHA e03ba58f95189e72d8da5658808f1e845250e128. В выбранном tree только3синтетических
файла: src/add.mjs, src/add.test.mjs, README.md. Это branch workspace, не отдельный repo.

Новый opt-in CLI apps/api/test/code-agent-live-github.acceptance.ts использует
существующие registerCodeAgentRoutes/CodeAgentService/CodeAgentStore/GithubIntegration,
PolicyStore, HTTP executor/client/server и OCI runner. Импорт ручного diff через
существующий API → реальные immutable GitHub reads → сохранённый review → фактическая
ошибка Node1 → повтор check → STALE_CHECK409 без изменений → исправленный ручной review
→ Node0/cleanup true → publication token → один publish через действующий adapter.
Временная БД содержит только синтетический project; БД владельца и .env не читались.
Модельных adapters0, model_run_ids0: model response/mock generation не подменяли live.

Создан настоящий [Draft PR542](https://github.com/RLM-Company/Nexus-OS/pull/542),
base указанная тестовая ветка, output a58b7314c967d33331dfd48b337d8f88f3cca5ab.
Изменены2файла; повторное чтение GitHub сравнило точные bytes. README blob сохранился,
article00123 сохранён. Повтор publish получил409 и не добавил GitHub POST; всего
4POST (tree/commit/newref/PR), одна publication invocation. Main SHA before/after
совпал. Test PR и базовую ветку в main не объединять. Production не изменялся.

Фактические input/output/diff, GitHub method/path trace без headers и receipt находятся
в fixtures/live-2026-11-12. SQLite/секреты/node_modules в поставку не включены.

В этой среде MODEL_API_KEY/BASE_URL/NAME отсутствуют, URL подключённого HY4-стенда
не предоставлен. Настоящая модель не вызывалась. Полный пользовательский маршрут
с генерацией и исправлением моделью остаётся отдельным непроверенным этапом.

## 3. Решение для выпуска

**Полная живая приёмка и готовность к выпуску не подтверждены.** Интеграция и live
GitHub/OCI пройдены; обязательный реальный HY4/модельный этап отсутствует. Разрешение
владельца есть; техническое подключение модели нужно для завершения. Production
release/tag/deploy не выполнялись. Ранее проверенные отмена/отзыв/owner isolation
сохраняют свои receipts/CI; в этом live сценарии не выдаются за новый прогон.

## Запуск и сохранность побочных эффектов

CLI отказывается стартовать без точного opt-in target, GH auth и pinned image.
Новый report directory создаётся один раз; повтор команды на том же каталоге
отклоняется до записи GitHub. На ошибке сохраняется interrupted.json с run/draft
и известным SHA; после uncertain публикации нельзя повторять publish: сначала
read/reconcile существующего результата. Не копировать SQLite в другие сервисы.

```sh
COSCODE_LIVE_GITHUB_APPROVE=RLM-Company/Nexus-OS:ops/coscode-live-base-2026-11-12 CODE_AGENT_TEST_IMAGE=sha256:280af3207172947339cc2e8c9d2efac585716fd906af49f57d6fdf0dbb829a73 CODE_AGENT_TEST_EXECUTABLE=/usr/local/bin/docker COSCODE_LIVE_REPORT_DIR=/tmp/coscode-github-live-2026-11-12 NODE_USE_ENV_PROXY=1 node --import ./apps/api/node_modules/tsx/dist/loader.mjs --conditions=development apps/api/test/code-agent-live-github.acceptance.ts
```

Docker endpoint selectors были очищены для местного unix socket; proxy/CA trust
сохранены. Не запускать повторно ради новых PR без нового сценария. Временный
loopback HTTP executor получает случайный синтетический secret, который не печатается.

Изменения поставки: opt-in scoped acceptance CLI, seed/status/actual receipts и свои
handoff files. Общие исходники/registration/DB migrations/provider/quotas/grants
не менялись. Native lint/typecheck и live CLI exit0. Первые pnpm checks не дошли
до линтера/компилятора: reuse dependencies создал symlink task-state path; он заменён
отдельным private real directory. Packages не устанавливались и security check не
отключался. Все ошибки подготовки отражены в логах; повтор с Node tools проверил
настоящие исходники. Новые тесты/формат/secret scan — см. DELIVERY и provenance.
