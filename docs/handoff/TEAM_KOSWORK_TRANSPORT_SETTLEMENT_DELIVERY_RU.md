# Учёт Work completion при ошибке закрытия транспорта

9 ноября 2026, Москва. Продолжение согласованного Ruflo-пункта о восстановлении
и неопределённых эффектах, внутри существующего coordinator/ledger.
Ветка `developer/koswork-admission-reliability`, существующий PR #479.
Фактический main на старте: `08f865f6362d3045438d6ca7f93be8e9e56e1e6c`;
предыдущий проверенный head этой ветки: `0a26359969086eaae30cf28a3b040eca8efdc003`.
Отдельных исполнителей, хранилищ, тарифов, migrations и маршрутов нет.

## Было и стало

Gateway уже проверяет provider/model, attempt и допустимость usage перед
передачей `response.completed`. Но Manager Work откладывал canonical commit
до полного закрытия async iterator. Если после completion транспорт выдавал
ошибку, известные token counts терялись: ledger становился failed с null usage,
а owner budget сохранял верхнюю оценку даже для известного нулевого расхода.

Теперь прежние `projects.completeRun`, context-memory usage и
`ownerBudget.completeReservation` вызываются при получении проверенного completion,
до следующего ожидания транспорта. Сохранение usage не означает принятие содержимого:
ошибка закрытия оставляет Work failed, файлы недоступны, автоповторов нет.
Из work checkpoint удаляется уже переданный canonical accounting идентификатор hold.
При частичном/null usage canonical ledger и прежний uncertain hold сохраняют
консервативную оценку без двойного счёта.

## Пользовательский путь и границы

Существующий запуск Work → обычный provider stream через gateway → проверенный
completion → прежний ledger/owner budget → ошибка закрытия → Work failed в API,
скачивание файла возвращает 404. Новый экземпляр coordinator и recovery не
отправляют запрос ещё раз. Отмена после completion оставляет cancelled и не
публикует файл, но не уничтожает уже принятый usage.

Если completion не получен/не прошёл gateway validation, прежний uncertain путь
не меняется. Разрешения, privacy fence, cancellation, лимиты и тарифы не расширяются.
Полная атомарность между несколькими независимыми store не добавляется;
последовательность прежняя: canonical ledger перед owner reservation settlement.
Это не доказательство содержательного успеха и не приёмка живого HY4.

## Файлы

- `apps/api/src/manager-work-coordinator.ts`: минимальное перемещение settlement
  на границу completion и очистка hold checkpoint; отдельный интеграционный коммит.
- `apps/api/test/manager-work.test.ts`: hook fixture после completion; шесть
  проверок на настоящей временной SQLite и обычном gateway. План/черновик/критик,
  известные нулевые/частичные counts, отмена, recovery и API/file readback.
- `docs/handoff/fixtures/koswork-transport-settlement/result.json`: настоящий
  readback локального fixture-прогона, не вручную набранный ожидаемый результат.

## Воспроизведение и проверки

```sh
# Из корня checkout; каталог отчёта должен быть новым (write flag wx):
KOSWORK_TRAILING_REPORT_DIR=/tmp/koswork-transport-fresh \
  pnpm --filter @cosmora/api exec vitest run test/manager-work.test.ts \
  -t 'Work completion accounting before transport settlement'
pnpm --filter @cosmora/api exec vitest run test/manager-work.test.ts
pnpm check:core
```

Вход: обычный defaultPlan из test fixture, completion usage 100/100, затем
`GatewayRunError(PROVIDER_ERROR)` при закрытии stream. Модель не вызывается.
Фактический результат: один provider fixture call, Work failed/PROVIDER_ERROR,
ledger committed 100/100, owner total 200, hold reference null, API 200,
file download 404, provider replay false. Полный report лежит рядом.

История проверок:

- На исходном coordinator новые проверки дали **5 FAIL / 1 PASS**, exit 1:
  plan/draft/review и нулевой/частичный usage терялись при хвостовой ошибке.
- После исправления первый целевой прогон: **5 PASS / 1 FAIL**. Осталась ошибка
  ожидания в тесте: account summary исключает уже учтённый canonical hold, чтобы
  не удваивать верхнюю оценку. Проверка исправлена по существующему контракту:
  summary hold count 0, в SQL при null input остаётся status uncertain.
- Полный Manager Work после исправления: **84/84 PASS**, exit 0.
- После добавления API readback и нового coordinator выполнен полный набор
  повторно: **84/84 PASS**, exit 0; report сохранён этим прогоном.
- Первый полный gate остановился на lint: два fixture hook были async без await.
  Они сделаны синхронными, hook допускает void/Promise; поведение сценария прежнее.
- Следующий полный gate: **933 API PASS / 1 FAIL**. Независимый
  `model-runtime` construction test Fable зависел от wall clock; evidence
  checked-in registry истёк 9 ноября в 09:46:39.765 UTC. Production registry,
  provider и expiry не менялись. Тест переведён в явно исторический момент
  внутри evidence window и дополнен отказом на точной границе expiry.
- Изолированный model-runtime после фикса: **13/13 PASS**, включая явный
  отказ на точной границе истечения evidence.
- Финальный `pnpm check:core`: **exit 0**, **934 API PASS** (84 Manager Work),
  263 web, 206 contracts, 386 core, 160 db, 151 model-gateway, 43 policy-engine,
  17 config и 63 tool-runtime PASS / 4 OCI skipped локально.
  Format, secrets, lint, typecheck, все package tests, root guards, build,
  privacy и profile fixture smoke прошли. API build выполнен заново;
  compiled coordinator содержит settlement до transport closure.
- Финальные scoped format, diff и secret scan выполнены после правок handoff.

Сырые локальные логи: `/tmp/koswork-trailing-before.log`,
`/tmp/koswork-trailing-after.log`, `/tmp/koswork-trailing-work-all.log`,
`/tmp/koswork-trailing-final-work.log`, `/tmp/koswork-trailing-check-core.log`,
`/tmp/koswork-trailing-check-core-fixed.log`,
`/tmp/koswork-trailing-registry-test.log` и `/tmp/koswork-trailing-check-core-final.log`.
Они временные; окончательные внешние checks точного опубликованного SHA
фиксируются в описании PR и не приписываются другим коммитам.

## Коммиты

- `f76d61f159ea80501528cb622fbb0264858a9baa`: регрессионные fixtures/tests.
- `5b13f2993c8159400d862f2459176bf6b02a1b68`: отдельный минимальный
  интеграционный коммит coordinator — 24 добавленные строки, 17 удалённых,
  преимущественно перенос существующего settlement.
- `27199e3b09407612867750235f147a1f58217ff0`: только исторический registry
  construction test и явная проверка expiry; production config не меняется.

## Интеграция и откат

Проверенный source head Office PR #466 `c3431b31621025d39af9bd055b3d1a6c9b0531b9`
содержит прежний Work head 0a26359, но **не это продолжение**. Новый код доставляется
существующим PR #479; перед совместной интеграцией сравнить ancestry, не копировать
целиком coordinator из старого checkout. При обычном Git merge обе цепочки имеют
общего предка 0a26359; merge/deploy исполнителем не выполняются.

Откат только интеграционного изменения возвращает settlement за закрытие iterator;
существующие ledger rows, файлы и holds не удаляются. Схема не менялась.
Включённые ранее admission/empty reply исправления нельзя откатывать вместе с этим
пакетом без отдельного решения. Настоящий HY4, production и ПК владельца не
использовались; provider заменён локальным fixture.
