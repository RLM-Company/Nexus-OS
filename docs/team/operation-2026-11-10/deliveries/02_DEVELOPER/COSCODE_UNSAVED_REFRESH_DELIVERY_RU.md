# Coscode: обновление без потери несохранённых правок

Исполнитель02_DEVELOPER, Разработчик + GPT. Дата13 ноября2026.
Статус: **готово к интеграции** по локальным gates; exact delivery HEAD CI
ожидается после обновления Draft PR. Итоговый receipt фиксируется в описании PR,
чтобы не менять проверяемый commit последующим docs push.

## Версии

- BASE_SHA: `1d72d9ddfb90111edc6bade44ec928fef1aecc19` — предыдущий проверенный HEAD собственного PR581.
- Сохранённый main: `4477dd53e5767a4bb4990c3109c874683a892b63`, предок BASE_SHA; новых изменений main при старте нет.
- Ветка: `ops/developer-coscode-snapshot-order-2026-11-13`.
- PR: [#581](https://github.com/RLM-Company/Nexus-OS/pull/581), остаётся Draft, не merged.
- SOURCE_HEAD_SHA: `2b8b895edcb743bf510246e9c52da10924f053eb`, source tree `e8a54ac6ae8e1223ce64b438d36614d0cc941463`.
- Локальный source commitdf9ff086065065d6f501f3a077007adc15242e8e имеет такое же дерево,
  сравнение локального и GitHub tree выполнено до публикации ref.
- Финальный delivery HEAD содержит отчёты дополнительно к source: точный SHA указывается
  в описании PR и итоговой передаче, не самоссылкой внутри commit.

CI43447416997 success проверил BASE_SHA, не этот новый slice. Его свидетельства
сохранены в предыдущем [отчёте](COSCODE_SNAPSHOT_ORDER_DELIVERY_RU.md) и истории PR.
Далее нужен отдельный CI точного нового HEAD без замены исходных ошибок.

## Сохранение входящего main перед передачей

Во время проверок main продвинулся до `14a5f48ea3a6c0a29d3f1ba6c1189705f0288acb`
(PR582/583). Эта версия сохранена в рабочей ветке.58 входящих файлов включают
Work/Office/Drive/voice/recovery, fixtures и отчёты; это не собственная реализация
этих модулей. Контракт Manager дополняется константой MANAGER_WORK_CONTROL_EVENTS,
CodeAgent contracts и его семь source blobs не менялись; сравнение в fixtures.
Нативное объединение имело4 конфликта только добавленных префиксов своих отчётов.
Проверено точное совпадение общего исторического suffix с main4477; сохранены
оба полных префикса поверх общей истории. Выбором ours/theirs содержимое не отбрасывалось.
Код предыдущего PR574 уже вошёл через review PR582; его живую приёмку здесь не заявляем.

Root gate до main14a завершён exit0; после объединения повторён, также exit0
(API1086PASS+1SKIP, web399PASS, DB236PASS; format/secrets/lint/types/build/gates прошли).
Локальные41PASS проверили те же семь CodeAgent source blobs до этой синхронизации;
общий CI точного нового HEAD должен проверить и входящие изменения main.

## До и после, текущий entrypoint

Путь: `/code-agent` → существующий editor → «Обновить состояние» либо polling →
существующий GET задачи → `accept` → React state. Если сервер присылал новый
proposal_hash, `accept` сбрасывал локальные файлы и remount raw diff без согласия.
Это воспроизведено через production Next и реальный Chromium:3FAIL+1PASS;
в actual DOM readback локальная строка заменялась серверным текстом.

Теперь текущие dirty flags синхронно отражаются в двух boolean полях одного ref, которые
читают и ранее созданные polling callbacks. Если hash поменялся при несохранённых
правках, data не заменяет editor. Видна причина конфликта, save/review и действия,
зависящие от editable/check proof, заблокированы; polling остановлен до разрешения.
Используется существующая кнопка «Загрузить сохранённые правки» и её confirmation.
Отмена не делает GET и оставляет точный текст. Подтверждение читает сервер заново,
а не применяет закешированную копию ответа. При403 локальный текст остаётся,
отказ доступа показан; произвольной записи и расширения grants нет.

Observed durable version watermark сохраняется при конфликте, хотя editor остаётся
на старом предложении: даже подтверждённый reload не может принять более низкую
версию и стереть локальные правки. Чистый editor продолжает принимать новые
предложения без дополнительного подтверждения. Старые epoch/run/version guards
и publication uncertainty сохраняются.

Это защита текущего редактора, а не autosave или новое durable хранилище.
После подтверждённого discard содержимое меняется намеренно; отдельные существующие
navigation/reload guards продолжают защищать несохранённые изменения.

## Реальные файлы и интеграция

Два исходных файла,223 добавления/6 удалений против BASE_SHA:

- `apps/web/src/app/code-agent/page.tsx`: синхронные dirty flags, acceptance conflict,
  observed version watermark, остановка poll и существующий explicit reload.
- `apps/web/e2e/code-agent.spec.ts`:6 regressions, actual preservation/recovery readbacks.

Отчёты BACKLOG/CHECKPOINT/DELIVERY/INTEGRATION и fixtures — только02_DEVELOPER.
Общих новых изменений/миграций/зависимостей нет. Предыдущая scoped регистрация
уже входит в BASE_SHA; [интеграционные условия](INTEGRATION.md).
API/contracts/DB/executor/provider/capabilities/grants и дизайн оболочки прежние.
Сторонний код не заимствован. Уже установленные зависимости: Next16.3.1,
Playwright1.62.1, Node24.22.1, pnpm11.25.0; CI pin pnpm11.19.0.

## Воспроизведение

В checkout с существующими dependencies, из корня:

```bash
pnpm_config_verify_deps_before_run='' PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium KOSMORA_E2E_PRODUCTION=1 KOSMORA_CODE_AGENT_E2E_PORT=3414 pnpm --filter @cosmora/web exec playwright test -c playwright.code-agent.config.ts --output=/tmp/coscode-unsaved-results
pnpm_config_verify_deps_before_run='' pnpm check:core
```

Добавить `--grep 'Code refresh'` к playwright для6 новых сценариев.
Fixtures — в существующем helper scenario, временные ответы: другая proposal identity,
более высокая/устаревшая version,403. Raw diff после сохранения выбранных файлов
проверяется отдельно: proofDirty уже false, patch dirty остаётся true.
Один polling case сначала получает checking с прежним hash, затем новое предложение;
явный read для разрешения конфликта остаётся доступен и в этом случае.

Проверяется точное содержимое со строками19 700,00123,2026-11-13 и «кроме доставки»
по inputValue реального DOM. Все read-only recovery phases проверяют writes=[],
publication/repair counters0. Существующая fixture setup до этих фаз моделирует
сохранение review/check; это не live GitHub/model/executor.

| Проверка                               | Фактический результат                                   |
| -------------------------------------- | ------------------------------------------------------- |
| Baseline до product fix,4 tests        | 3FAIL+1PASS, exit1, outputs сохранены                   |
| Целевой прогон после fix,5 tests       | 5PASS, exit0, до добавления access-revocation case      |
| Полный scoped production suite         | 41PASS, exit0, retries0, 2.4мин;6 новых+35 существующих |
| Root gate check:core до нового main14a | exit0; cache явно указан; log сохранён                  |
| Root gate после main14a                | exit0, итоговый log с raw hash приложен                 |
| Exact delivery HEAD CI                 | ожидается после обновления PR581                        |

[Fixtures, logs и настоящий source.patch](fixtures/coscode-unsaved-refresh-2026-11-13/README.md).
В full production log сохраняются ECONNREFUSED3413 при root navigation: scoped runner
не поднимает API, Code API перехватывается; это не live API acceptance.
Первоначальные3FAIL не скрываются итоговым зелёным прогоном.

## Первый CI и отдельная интеграция теста

CI [43455694958](https://github.com/RLM-Company/Nexus-OS/actions/runs/43455694958)
на HEAD93082c4: Verify monorepo success, OCI5PASS; Browser failure —
529PASS+1flaky. Наборы после основного не запускались из-за `&&`.
FailOnFlakyTests не ослаблялся, успешный retry не выдаётся за зелёный gate.
Все41 сценария Coscode прошли; artifact содержит10 реальных новых CodeAgent readbacks.

Trace показывает: до загрузки страницы seed assistant уже failed/INTERRUPTED,
а тест восстановления черновика ждал completed и истёк через15сек. Причина
production lifecycle interruption не установлена и не исправлялась в этом срезе.
Для независимой проверки draft существующий held fixture prompt теперь явно
отменяется через API, проверяются200/cancelled и сохранённая cancelled row.
Остальные проверки tab close, изоляции, файлов, очистки и финального успешного
ответа сохранены без ослабления. Production runtime/общая оболочка чата прежние.

Отдельный integration commit `23bbcde7a23c10f6d55d38e28defd718db80fe9e` меняет только
`apps/web/e2e/chat-reliability.spec.ts`,18 добавлений/14 удалений.
Повтор целого сценария:5PASS, workers2, retries0, exit0. Строгие web types/lint exit0.
Первый диагностический anchored grep не выбрал tests, exit1 No tests found;
лог сохранён, затем pattern исправлен, assertions того запуска не заявляются.

```bash
pnpm_config_verify_deps_before_run='' PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test -c playwright.composer.config.ts --grep 'restores text and files after closing' --repeat-each=5 --workers=2 --retries=0 --output=/tmp/draft-seed-proof
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web typecheck
pnpm_config_verify_deps_before_run='' pnpm --filter @cosmora/web lint
```

[Исходный failure/trace receipt](fixtures/coscode-unsaved-refresh-2026-11-13/ci43455694958-receipt.json)
и выходы сохранены. Новый exact HEAD CI ожидается после этой интеграции;
старый красный CI не удаляется и не перезапускается под тем же SHA.
Для отката test adaptation revert integration commit отдельно от product2b8b895.

## Полномочия, границы и откат

Реальные .env, пароли/токены/БД/личные файлы не использованы. Новая модель/провайдер
не подключались, paid API/foreign push/публикация чужого PR не запускались.
Ни merge в main, ни deploy, ни управление ПК владельца/VPS не выполнялись.
Публикация собственной ветки и обновление собственного Draft PR входят в поручение.

Локальный draft остаётся памятью текущего view, а не новым crash-proof checkpoint.
Legacy без version сохраняет ограничения предыдущего request-order fallback.
Отзыв доступа моделируется403 в UI fixture; живое изменение account grants не проверялось.
Остальные права обеспечиваются существующим сервером; полномочия клиента не расширены.

Интегратору: ревью нового source commit поверх предыдущего slice, затем exact HEAD CI.
При откате revert `2b8b895edcb743bf510246e9c52da10924f053eb` с сохранением последующих изменений;
предыдущий snapshot-order fix не удалять. Миграций/данных для отката нет.
Максимальный статус исполнителя — «готово к интеграции»; выпуск подтверждает Codex.
Следующий шаг после зелёного CI — независимое ревью текущего PR, без автоматического merge.
