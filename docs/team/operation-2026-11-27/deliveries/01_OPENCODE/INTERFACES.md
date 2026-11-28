# INTERFACES — 01_OPENCODE (устройство, браузер, надёжный клиент)

База: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`. Ветка:
`feature/oc1-device-browser-runtime-20261127`.

## Реальные интерфейсы первого среза

### `desktop/windows/browser/device-lease.cjs` (новый, pure state machine)

Общий device/browser action lease для разных агентов. Один системный
курсор/фокус имеет одного действующего владельца (`native`); DOM-задачи в
разных контекстах (`dom`) допускаются параллельно.

Входы/выходы:

- `acquireNative({holder, owner, priority: "agent"|"human", reason, signal})`
  → Promise<lease>. Агенты排队; человек имеет приоритет. Re-entrant вызов тем же
  holder возвращает текущий lease. Abort/stop → `DEVICE_LEASE_ABORTED` /
  `DEVICE_STOPPED`.
- `releaseNative(holder, owner)` → leased entry | null. Только владелец.
- `takeOver({holder, owner, reason})` → `{evicted, current}`. Вытесняет агента и
  отменяет всех ожидающих; human всегда побеждает.
- `assertNative(holder, owner)` → lease | `DEVICE_LEASE_LOST` / `DEVICE_STOPPED`.
  Вызывается перед каждым нативным вводом — поздний ввод после takeover
  невозможен.
- `acquireDom/releaseDom({holder, owner, context})` → изолированы по `context`,
  не трогают native focus.
- `stop()` → отменяет ожидания, сбрасывает все lease, запрещает новые.
- `state()` → `{native, waiting, dom, generation, stopped}`.

Коды ошибок: `DEVICE_LEASE_INVALID`, `DEVICE_LEASE_ABORTED`,
`DEVICE_LEASE_TAKEN_OVER`, `DEVICE_LEASE_HELD_BY_OTHER`, `DEVICE_LEASE_LOST`,
`DEVICE_STOPPED`, `DEVICE_LEASE_INVALID`.

### Интеграция в `browser/engine.cjs`

- `createBrowserEngine` создаёт `deviceLease`.
- `takeControl()` (человеческий ввод) вызывает `deviceLease.takeOver()`.
- `execute()` внутри serialised screen queue acquiring native lease per action
  (distinct holder symbol), `assertNative` перед вводом, `releaseNative` в
  `finally`.без busy-wait: отклонённое acquisition не блокирует очередь.
- `state()` отдаёт `deviceLease` для наблюдения агентом/оператором.
- `dispose()` вызывает `deviceLease.stop()`.

Принадлежность данных: состояние lease живёт в процессе engine, не пишется в
БД/профиль, не содержит cookies/паролей/файлов. Нет новых прав, маршрутов и
внешних вызовов.

## Зависимости

- Потребители (Harness 1 / Grok / OpenCode 2) получают `state().deviceLease` и
  коды ошибок; их бизнес-логика не копируется в driver.
- `tab-ownership.cjs` остаётся источником истины для конкретной вкладки; device lease
  добавляет device-wide порядок, не заменяя его.

### `desktop/windows/executor-target.cjs` (новый, portable interface)

Описатель executor target для local и будущего remote runner: явные
`capabilities` (`native_focus`, `dom_read`, `dom_input`, `files`, `browser`,
`downloads`), `authorize(target, operation, {ownerId, operationKind})`,
`requiresNativeLease(operation)` и `portableCheckpoint()`. Target — данные, не
живое соединение; `credentials:{}` и `device_grants:[]` не переносятся при
передаче чекпоинта Harness 1. Тесты — `executor-target.test.cjs`.
