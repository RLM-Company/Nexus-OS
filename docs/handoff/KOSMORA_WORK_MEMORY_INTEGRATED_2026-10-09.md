# Kosmora Work и проектная память — интеграция 9 октября 2026

База интеграции: `7e12e12c5a95b6e29a506052115f66c2ccda78d9`. В отдельную Git-копию применён полный Work-патч из предоставленного пакета, рассчитанного на `b15912d`. Никакие файлы VPS или общего checkout этой работой не изменялись.

## Реализованное поведение

- Серверная очередь задач проекта с SQLite CAS, checkpoints и зависимостями этапов: план → файлы → Critic по риску → сохранение. Несколько задач одного проекта ставятся в очередь, но исполняются по одной; существующий предел API — две активные задачи разных проектов.
- Пауза, продолжение, подтверждение плана и отмена используют версии записей. При рестарте безопасная running-граница становится paused; неопределённый запрос или публикация становятся `RECOVERY_REQUIRED` и не повторяются автоматически.
- CRUD проектной памяти с поиском Unicode/NFKC, источником, версиями, pin/unpin и forget. Контекст задачи снимается при приёме; forgotten-записи исключаются из следующих dispatch. Исторические принятые снимки и файлы сохраняются.
- Неизменяемые версии артефактов с SHA-256, размером и происхождением Work. Download допускается только для опубликованного completed-результата текущего владельца/проекта; MIME text/plain, attachment и nosniff.
- Существующий Work UI показывает задачи/зависимости, решения владельца, checkpoints, память и версии результата. Чёрный/белый/серый; глобальная навигация не меняется.
- Обязательный Critic для complex-плана, валидация файлов и JSON. Permission profile, emergency stop, расходы проекта и отсутствие автоматических платных повторов сохраняются.
- HTTP чтения/controls формы Work и памяти ограничены 15 секундами. При timeout показано, что сервер мог уже принять действие; автоматическая повторная запись не выполняется.

## Миграция и объединение

Новая миграция — `0026_work_runtime.sql`, idx26, when **1791580800001**. Миграция документов другого блока должна оставаться idx25/`0025_document_library`, when1791489600000. Главный интегратор должен собрать журнал **24 → 25 → 26** и применить миграции до старта API. Уже применённые записи не перенумеровывать.

В этом изолированном клоне миграция25 документов отсутствует; upgrade24→26 и повторный запуск проверены. Отдельный тест переносит исторический completed Work из migration24: старый download остаётся доступным, новые provenance/version/checkpoint для старого результата не выдумываются. Общий upgrade24→25→26 проверяет главный интегратор.

Вероятные пересечения с другими ветками: `packages/{contracts,core,db}/src/index.ts` и `packages/db/migrations/meta/_journal.json`. Изменения `app.ts`, `schema.ts`, `server.ts`, package.json и lockfile отсутствуют.

## Контракт личной квоты

`ManagerWorkDependencies.ownerBudget?: WorkOwnerBudget` согласован с AccountStore соседнего блока. Интегратор передаёт готовый AccountStore как `ownerBudget` при создании coordinator в production `server.ts`; без опции прежний Work сохраняет свои проектные лимиты.

Методы: `reserve(owner,runId,attempt,maxTokens,'main',projectId,provider,model)`, `completeReservation(id,'main',inputTokens,outputTokens)`, `uncertainReservation(id,'main')`, `releaseBeforeDispatch(id)`.

Owner reserve вызывается внутри `route.selected`, до project-reservation и до возобновления Gateway iterator (provider ещё не вызван). Его сумма — estimated_input_tokens + max_output_tokens. Локальный reject до dispatch освобождает owner hold. Success сначала фиксирует canonical project Usage Ledger, затем reconciles owner hold. Failure/cancel после возможности dispatch сохраняет uncertain hold. QuotaExceededError.code=`USAGE_LIMIT_EXCEEDED` останавливает Work без provider call; UI показывает личный лимит. Реальный AccountStore с Work должен дополнительно проверить главный интегратор после объединения.

## Проверки этого прохода

| Проверка                                                 | Результат                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                         | PASS; собственные зависимости, lockfile supply-chain policies PASS                                            |
| `pnpm typecheck`                                         | PASS, 9 пакетов                                                                                               |
| `pnpm build`                                             | PASS, 9 пакетов                                                                                               |
| API `manager-work.test.ts`                               | PASS, 31 тест; включая disk checkpoint → API reopen → resume без повтора плана и четыре owner-budget сценария |
| DB `work-runtime-store.test.ts` + migration test         | PASS, 6 тестов; owner/project scope, CAS двух connections, immutable artifacts, restart, upgrade24            |
| DB прежний `manager-demo-store.test.ts`                  | PASS, 2 теста                                                                                                 |
| core `work-runtime.test.ts`                              | PASS, 4 теста                                                                                                 |
| scoped ESLint, Prettier, secret scan, `git diff --check` | PASS                                                                                                          |
| `node scripts/manager-compatible-fixture-smoke.mjs`      | PASS: production HTTP auth, project chat +3 Work stages, Critic, download; только loopback providerfixture    |
| Chromium Work/memory/reload/stop scenarios               | PASS, 7 тестов; локальные порты3009/3109, никакой платной модели                                              |

Для локальной браузерной проверки: из `apps/web` выполнить `node node_modules/@playwright/test/cli.js test e2e/work-manager.spec.ts e2e/manager-work.spec.ts e2e/manager-work-stops.spec.ts --config playwright.work-runtime.config.ts`. Config очищает fixture credentials через существующий integration-server и не переиспользует чужой сервер. Chromium1234 уже установлен в среде этого прохода.

## Границы

Это реальный базовый Manager file-work цикл, а не произвольный пользовательский DAG/shell/Code executor. Один production API execution process; распределённый lease scheduler не реализован. Critic оценивает содержание и не выполняет код. Graph только optional adapter, по умолчанию отключён; чужой graph runtime не разрабатывался и не вызывался. Живая платная модель, реальные внешние действия, VPS deployment, Windows lifecycle и общий AccountStore здесь не заявлены проверенными.

Исходный handoff от8октября сохранён отдельно как историческое описание входящего пакета; его migration25 и browser UNVERIFIED superseded этим результатом.
