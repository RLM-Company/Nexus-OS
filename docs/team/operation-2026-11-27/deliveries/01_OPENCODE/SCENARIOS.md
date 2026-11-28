# SCENARIOS — 01_OPENCODE

База: `3af92583`, ветка `feature/oc1-device-browser-runtime-20261127`.

## S1 — Два агента претендуют на одно native окно (обязательный сценарий)

Вход: engine с одной открытой вкладкой; агент A и агент B с разными
`AbortSignal` инициируют `browser_click` / `browser_read` на этой вкладке.

Ожидаемый результат:

- native lease принадлежит ровно одному агенту (`state().deviceLease.native`);
- второй агент заблокирован в serialised screen queue или в очереди lease и
  **не** получает native focus, пока первый не освободит его;
- после освобождения второй агент выполняет своё действие один раз;
  -никогда не бывает двух активных native holder и дублей результата.

Проверка: `desktop/windows/test/browser.test.cjs` — тест
"two agents contending for one native window are serialized by the device lease".
Пройден: 1/1.

## S2 — Human takeover во время ожидания (циклы 1–2)

Вход: агент начал `browser_click`, ожидает ответа DOM; человек нажимает клавишу
(`before-mouse-event`). Ожидается: `handover++`, lease вытеснен, queued-агенты
отменены, все последующие `Input.*` запрещены `assertNative`, late response
отбрасывается; новый явно запущенный агент может reclaim.

Проверка: browser.test.cjs "manual takeover cancels an in-flight browser action
and queued inputs" — пройден после интеграции lease.

## S3 — Отключение/остановка оставляет чистое состояние

Вход: активный lease + ожидающий агент; `stop()`/`dispose()`. Ожидается:
ожидающие отклонены с `DEVICE_STOPPED`, активный evicted, новые acquisition
запрещены, `state().stopped === true`.

Проверка: device-lease.test.cjs "abort and disconnect never leave a late input
path open" — пройден.

## S4 — Независимые DOM-задачи в разных контекстах

Вход: два агента с `acquireDom` для `tab-a` и `tab-b`. Ожидается: оба lease
активны одновременно; native holder не меняется; повторный захват чужого
контекста -> `DEVICE_LEASE_HELD_BY_OTHER`.

Проверка: device-lease.test.cjs "DOM leases are isolated by context..." — пройден.

## S5 — Приоритет человеческого ввода в очереди

Вход: агент держит native; агенты B и human встают в очередь. Human получает
lease первым. Проверка: device-lease.test.cjs "human waiter jumps ahead of an
agent waiter" — пройден.

## Статус живых проверок

Настоящий GUI/Windows-клиент в этом окружении недоступен. Fixture-прогон
(70/70 browser+lease тестов) — **PASS**. Runnable native acceptance и живые
пункты (документная задача, тестовая форма, скачивание, disconnect/reconnect)
остаются отдельными и **не** закрываются этим fixture-прогоном.
