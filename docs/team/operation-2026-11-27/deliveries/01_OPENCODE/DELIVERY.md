# DELIVERY — 01_OPENCODE, первый срез (device action lease)

- Base SHA: `3af92583ccc8ceb49f44c0b8633955f40feaf59f`
- Branch: `feature/oc1-device-browser-runtime-20261127`
- HEAD: точный SHA в PR
- Статус: готово к интеграции; merge/deploy не выполнялись.

## Что было

Существовал `tab-ownership.cjs` (per-tab agent/human) и развитый browser engine
с screen queue, recovery, action evidence, profiles и download guards. Отсутство-
вал device-wide lease: два агента могли претендовать на один системный
курсор/фокус, и не было единой точки, где human input вытесняет агента перед
каждым нативным вводом.

## Что работает теперь

- `device-lease.cjs`: один native holder; агенты в очереди; human priority;
  takeover; abort/stop; изолированные DOM leases; `assertNative` перед вводом.
- `engine.cjs`: lease acquisition/release/assert внутри screen queue; human
  takeover через `takeControl()`; `state().deviceLease`; `dispose()` вызывает
  `stop()`. Отклонённое acquisition не блокирует очередь.

## Команды и факты

```sh
node --test --test-timeout=15000 desktop/windows/test/browser*.test.cjs \
  desktop/windows/test/device-lease.test.cjs
# tests 70, pass 70, fail 0
pnpm --dir desktop/windows check                      # 484 passed, 0 failed
node --check desktop/windows/browser/engine.cjs
node --check desktop/windows/browser/device-lease.cjs
node scripts/check-secrets.mjs
git diff --check
pnpm --filter @cosmora/api exec vitest run test/computer-control.test.ts \
  test/document-workspace-api.test.ts --maxWorkers=2   # 94 passed, 0 failed
```

Обязательный сценарий двух агентов на одно окно — в
`browser.test.cjs`, пройден. История исправления: первая интеграция вызвала
deadlock в takeover-тесте (два агента с одним signal и acquire вне queue);
исправлено путём пер-action holder и acquisition внутри screen queue. Ошибка
не скрыта повторным запуском.

## Живой блок (НЕ закрыт fixture-прогоном)

Обязательная живая приёмка волны — документная задача, браузерная с тестовой
формой и скачиванием, human takeover во время ожидания, отмена,
disconnect/reconnect, проверка отсутствия позднего ввода/чужого доступа/дублей
результата — **требует настоящего Windows-клиента и GUI**, которого в этом
окружении нет. Что подготовлено:

- `browser/native-acceptance.cjs` — runnable packaged-Electron сценарий с
  формой, upload, download, возвратом в Koswork; дополнен проверками device
  lease и human takeover на реальном Electron-транспорте. Выполняется в
  GitHub Windows job (gui-acceptance), а не в этом чате.
- Обязательный сценарий двух агентов на одно native окно оформлен в
  `browser.test.cjs` (engine-level fixture).
- Fixture-прогон 484/484 desktop + 94/94 API **не** заменяет живой пункт и
  не объявляет его пройденным.

## Ограничения и живые пункты

- Настоящий GUI/ПК недоступен; fixture-прогон **не** заменяет обязательную
  живую приёмку (документная задача, тестовая форма, скачивание,
  disconnect/reconnect, human takeover).
- Stars scheduler, память, MediaService и Games editor не менялись.
- Общая регистрация/IPC не изменялась; integration commit не требуется.
  Готовый интерфейс для Harness 1 / Grok / OpenCode 2 — `state().deviceLease`.
- Новых зависимостей и миграций нет.
