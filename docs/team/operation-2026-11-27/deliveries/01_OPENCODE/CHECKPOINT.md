# CHECKPOINT — 01_OPENCODE (27.11.2026)

Ветка: `feature/oc1-device-browser-runtime-20261127`.
База: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.

## Сделано (первый срез, готов к PR)

- Прочитаны полностью общие правила волны и личное задание.
- Проинвентаризован существующий стек: `browser/engine.cjs`,
  `tab-ownership.cjs` session/driver/lifecycle, `apps/api/src/computer-control`.
- Новый `browser/device-lease.cjs` — общий device/browser action lease:
  один native holder, очередь с приоритетом human, takeover, abort/stop,
  изолированные DOM leases, проверка перед каждым вводом.
- Интеграция в `browser/engine.cjs`: lease acquire/assert/release внутри
  screen queue, human takeover вытесняет lease, состояние в `state()`,
  очистка в `dispose()`. Существующий `tab-ownership` не заменён.
- Тесты: `device-lease.test.cjs` (6) + обязательный engine-сценарий двух
  агентов в `browser.test.cjs`; полный прогон browser+lease **70/70 PASS**.

## Следующий шаг

- Цикл 1: сквозной document task на реальном desktop пути (приложение →
  файл → сохранение → чтение → возврат в Koswork) с trace/version.
- Цикл 2: recovery-маршруты (чужое окно, фокус, диалог, stale observation,
  disconnect, поздний ответ) в driver/session.
- Цикл 3: расширение browser (tabs, upload, profiles, handover) поверх
  существующего ownership.
- Цикл 5: desktop UX (вход/сессия, переподключение, папка, скачивания, ошибки).

## Сделано после первого коммита

- `b8284ce` — packaged native acceptance: lease + human takeover на реальном
  Electron-транспорте (GUI CI).
- `dfcb3a0` — typed recovery для lease-ошибок (`DEVICE_LEASE_TAKEN_OVER` →
  `user_input_active`, `DEVICE_STOPPED` → `device_disconnected`), что исключает
  blind replay; упаковка lease-модуля в `build.files`.
- `executor-target.cjs` — portable capability-aware interface (local/remote),
  portable checkpoint без cookies/паролей/grants; 5 тестов.
- Полный `pnpm --dir desktop/windows check`: **484/484 PASS**.

## Живые пункты

Настоящий Windows GUI/ПК в этом окружении недоступен. Fixture-прогон прошёл;
runnable native acceptance и живые проверки не закрываются unit/fixture
тестами и остаются отдельным срезом.
