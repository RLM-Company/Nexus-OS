# Coscode: поздний ответ не откатывает задачу

Статус: **готово к интеграции** по локальным проверкам; exact delivery HEAD CI
ожидается после публикации отдельного Draft PR. Решение об интеграции — у Codex.
Исполнитель02_DEVELOPER, Разработчик + GPT. Дата13 ноября2026.

## Версии и область

- BASE_SHA начала: `501d403f8e95c2ced82f88be13b04b18789baa40`.
- Сохранённый актуальный main: `1b73e49761a61ef34e25a3ae7958de9cf40cf7f9`.
- Product commit: `3ad583333bedb590799d7c984d974edf4e2073d3`.
- Integration commit / SOURCE_HEAD_SHA: `404c3ddb3cf69ed473b72d3ad304555942ab783a`.
- Проверяемое source tree: `69766e22c7ca813d5c59ee10bb74b7cd33bd0d52`.
- Ветка: `ops/developer-coscode-snapshot-order-2026-11-13`; [Draft PR](https://github.com/RLM-Company/Nexus-OS/pulls?q=is%3Apr+head%3Aops%2Fdeveloper-coscode-snapshot-order-2026-11-13).
- Финальный delivery HEAD содержит документы дополнительно к SOURCE_HEAD_SHA;
  точный SHA фиксируется GitHub PR и финальной передачей, а не самоссылкой внутри commit.

Входящий main добавил workflow Windows и отчёт05_GEMINI; эти изменения сохранены.
Собственных правок Windows/VPS нет. PR574 и его ветка не менялись.

## Пользовательский путь до и после

Entrypoint: `/code-agent`, существующий `CodeAgentPage`, загрузка выбранной задачи,
опрос через1500мс, «Обновить состояние» и ответы существующих действий.
`apps/api/src/code-agent/store.ts` уже увеличивает `Run.version` при CAS save;
новое поле или второй журнал не нужны.

До: два GET могли пересечься; старый ответ принимался после нового и возвращал
старые summary/status/check/proposal, мог сбрасывать связанную идентичность редактора.
Три воспроизводимых браузерных сценария падали, один уже работавший проходил.

После: существующий `accept` проверяет серверную положительную целую version.
Меньшая/неизвестная версия после известной отклоняется, большая принимается даже
от более раннего запроса. При одинаковой либо отсутствующей version учитывается
последовательность начала запросов. Проверка происходит до изменения React state,
editor/approvals и publication uncertainty. При ручном устаревшем ответе виден
отказ «Получено устаревшее состояние задачи. Показана последняя принятая версия».

Это ephemeral metadata ref в текущем view, очищаемый при смене проекта, а не новое
хранилище. Старые epoch/run guards остаются. Late403/error показывается прежним
путём: sequence не превращается в фильтр для отказов доступа. Новые POST в read-only
сценариях отсутствуют, что проверено реальными перехваченными запросами.

## Изменённые исходники

Product commit, четыре файла:

- `apps/web/src/app/code-agent/page.tsx`: один acceptance fence для существующих входов.
- `apps/web/src/app/code-agent/snapshot-order.ts`: version/request predicate.
- `apps/web/src/app/code-agent/snapshot-order.test.ts`: четыре unit-группы.
- `apps/web/e2e/code-agent.spec.ts`: пять браузерных regressions с actual readback.

Integration commit, три файла, подробно в [INTEGRATION.md](INTEGRATION.md):

- `apps/web/package.json` — регистрация strict E2E typecheck, одна строка.
- `apps/web/tsconfig.code-agent-e2e.json` — узкий config.
- `apps/web/playwright.code-agent.config.ts` — отдельный production/port/executable runner.

Документы и fixtures только в собственном каталоге02_DEVELOPER.
Chat/sidebar/logo/global CSS, API, DB, grants, executor и provider не менялись.
Миграций и новых зависимостей нет. Использованы уже установленные Node24.22.1,
pnpm11.25.0, Chromium `/usr/bin/chromium`, Next16.3.1, Playwright1.62.1.
CI использует закреплённый pnpm11.19.0. Сторонний исходный код не заимствован.

## Воспроизведение и фактические результаты

Из корня репозитория с имеющимися workspace dependencies:

```bash
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web exec vitest run src/app/code-agent/snapshot-order.test.ts
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web typecheck
pnpm_config_verify_deps_before_run='' pnpm check:core
```

Production browser stand, только loopback и полностью intercepted Code API:

```bash
pnpm_config_verify_deps_before_run='' PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium KOSMORA_E2E_PRODUCTION=1 KOSMORA_CODE_AGENT_E2E_PORT=3414 pnpm --filter @cosmora/web exec playwright test -c playwright.code-agent.config.ts --grep 'Code polling never|Code manual refresh|Code keeps a late access' --output=/tmp/coscode-snapshot-results
```

Убрать `--grep` для всей scoped suite35. Новые inputs — в существующей `scenario`
fixture `e2e/code-agent.spec.ts`: versioned delayed2/later3, legacy responses,
earlier request version5/later4, manual8→7, late403 vs authorized3.
Readbacks сохраняются через `testInfo.outputPath` после реального обновления DOM.
Модель не вызывалась, GitHub publish adapter/live API в этих пяти tests не вызывается.

| Проверка                                              | Фактический результат                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| До исправления, четыре браузерных сценария            | 3FAIL+1PASS, сохранены baseline logs/readbacks                                                  |
| Unit predicate                                        | 4PASS                                                                                           |
| Strict web typecheck                                  | exit0 после исправления initial TS2379                                                          |
| Первый полный production suite34                      | 33PASS+1FAIL: два role=alert в locator; actual v8 сохранена                                     |
| Исправленный locator, targeted4                       | 4PASS                                                                                           |
| Финальные targeted5 после review и синхронизации main | 5PASS, включая late403, mutations=[]                                                            |
| Финальный check:core                                  | exit0: format, secrets, lint, types, tests, build и остальные gates; Turbo cache отмечен в логе |
| Финальный полный scoped35                             | 35PASS, exit0, retries0, production build/start, 2.1мин; пять readbacks совпали с targeted5     |
| Exact delivery HEAD CI                                | ожидается после публикации Draft PR                                                             |

В полном scoped production suite переход Back на корневую страницу пишет
ECONNREFUSED3413 в server log: отдельный runner намеренно не поднимает API,
Code API перехвачен fixture. Эти сообщения сохранены; глобальный API/backend
проверяются отдельным root gate/CI, а не выдаются за live-приёмку этим UI стендом.

Первоначальный dev suite прерван exit130 при Turbopack `.js`-imports из contracts
после перехода Back на root. Это не PASS и не отсутствие реального export:
экспорт существует в `domain.ts`, проблема проявилась в dev-resolver этого стенда.
Полный2MB raw log не добавлен; сохранены deduplicated excerpt и SHA256 raw.
После отмены остался local listener3412: production startup exit1 EADDRINUSE,
вторая readiness попытка отменена130 до assertions. PID не показался через fuser,
очистка этого listener не подтверждена, эскалация и изменение isolation не применялись.
Отдельный production стенд3414 успешно выполнил проверки.

Initial type failure TS2379 исправлен явным optional undefined в stamp type;
первый selector failure исправлен уточнением app alert, без изменения assertions
о состоянии задачи. Все эти исходные ошибки сохранены, повторные прогоны не
представляются первым безошибочным запуском.

[Fixtures и логи](fixtures/coscode-snapshot-order-2026-11-13/README.md) содержат
baseline/actual output, команды, raw hashes и SHA256SUMS нормализованных вложений.

## Полномочия, ограничения и интеграция

Реальный UI и production Next build запускались с синтетическими API responses.
Нет live AI calls, чужого push/PR, реальных пользовательских файлов/DB/.env,
установок на ПК владельца, VPS, merge или deployment. Разрешения не расширялись.
Текущая публикация собственной ветки/собственного Draft PR входит в поручение.

Legacy без version защищён только порядком запросов в текущем view, это не
доказательство глобальной версии сервера. Настоящая запись и CAS backend остаются
существующими. Не заявляется новая полная проверка всей программы Coscode или
live-приёмка на аккаунте владельца.

Интегратору: взять product и затем integration commit вместе с документацией,
проверить текущие contracts/main и exact HEAD CI. Не мержить автоматически.
Для отката revert integration затем product с ручным сохранением последующих
правок; миграции/данные откатывать не требуется. Документальные свидетельства можно
сохранить. Независимый от этого среза PR574 рассматривается отдельно.

Следующая точка продолжения: после exact HEAD CI — независимое ревью интегратора;
отдельно исследовать dirty-editor при смене proposal identity из другой вкладки.
Это пока гипотеза, не воспроизведённый и не исправленный дефект этого среза.
