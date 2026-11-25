# Koswork + локальный исполнитель: сценарии

**Ветка:** `feature/koswork-executor-scenarios` от `main` `e6736e0b`.

## Сценарий 1 (закрыт): сайт → форма → сохранение → новое наблюдение

`apps/api/test/computer-scenarios.test.ts` прогоняет **реальный**
`ComputerControlService` с mock-gateway и синтетическим planner'ом:

1. `work_plan` — четыре шага с наблюдаемыми критериями.
2. `work_step` — явный выбор шага с `observation_id` текущего наблюдения.
3. `work_switch browser` → `browser_open(local-form)` → `browser_fill` → `browser_click` —
   каждое действие получает отдельный observation-пакет с новым `observation_id` и `generation`.
4. `work_switch computer` → `workspace_create(result.md)` — результат сохраняется в выбранной папке.
5. `done` — только после того, как observation помечает план завершённым.

Проверяется: последовательность kinds, что **каждый** запрос модели содержал
свой пронумерованный observation-пакет, и что браузерные действия не
dispatch'атся без объявленного `browser` tab в наблюдении (отказ до вызова модели).

Ограничение: API — движок предложений; фактический ввод в DOM, запись байтов
и «take control» исполняются нативным клиентом (`desktop/windows`), который
здесь не запускался. Это проверка связки и контракта, не live-приёмка клиента.

## Сценарий 2 (закрыт): передача управления → остановка → reconnect

Тот же test-файл добавляет:

1. `work_plan` → `ask_user(question)` — задание ждёт действия владельца, модель
   не делает наблюдений и платных вызовов (нативный pause/resume реализован в
   `computer-session.cjs`, API возвращает действие как обычное предложение).
2. `previous_result = "owner_resumed"` — владелец продолжил локально; модель
   получает новое наблюдение без пароля/учётных данных.
3. `end()` — аналог отключения устройства/остановки: сессия закрывается, позднее
   действие отклоняется, старый `action_hash` не авторизует ничего.
4. `create()` с тем же goal после reconnect создаёт **новую** сессию с другим id.

Неизвестный исход внешнего действия: в API каждый шаг связан с отдельным
наблюдением; нативный слой (`computer-policy.cjs:432`, `computer-session.cjs:595-641`)
не повторяет неизвестный эффект и требует свежего observation. Это отражено
в сценарии 1 (каждое действие — новый observation) и в существующих тестах
`computer-control.test.ts`; отдельный live-прогон с реальной сетью остаётся
за владельцем.

## Проверки

```
pnpm --filter @cosmora/api exec vitest run test/computer-control.test.ts test/computer-scenarios.test.ts
pnpm --filter @cosmora/api typecheck
```

Результат после обоих сценариев: **92 passed** (88 прежних + 4 новых),
typecheck exit 0, Prettier чистый.

## Сценарий 3 (проверен существующим automatic run)

`scripts/run-koswork-local-cycle.mjs` (уже в main, проверка 09):

- симулируется потеря ответа при сохранении `workspace_create`;
- повторное создание даёт `WORKSPACE_ALREADY_EXISTS` (не перезаписывает файл);
- агент делает `workspace_read` и убеждается, что байты прежние, без дублирования.

Плюс новый API-сценарий 1 показывает, что каждое внешнее действие получает свежий
observation-пакет, а модельный `done` приходит только после проверки результата.

Команда воспроизведения (фактически выполнена на этой ветке, exit 0):

```
pnpm --filter @cosmora/api exec node --import ../../node_modules/.pnpm/tsx@4.20.6/node_modules/tsx/dist/loader.mjs ../../scripts/run-koswork-local-cycle.mjs
```

## Следующие шаги

- воспроизводимый прогон с реальным локальным сайтом через нативный Electron-fixture
  (`desktop/windows/ci/computer-browser-live.cjs`) — требует зафиксированного бинария;
- приёмка на основном устройстве владельца — согласуется отдельно.
