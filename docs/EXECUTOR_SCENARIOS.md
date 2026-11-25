# Koswork + локальный исполнитель: сценарии

**Ветка:** `feature/koswork-executor-scenarios` от `main` `e6736e0b`.

## Сценарий 1 (закрыт): сайт → форма → сохранение → новое наблюдение

`apps/api/test/computer-scenarios.test.ts` прогоняет **реальный**
`ComputerControlService` с mock-gateway и синтетическим planner'ом:

1. `work_plan` — четыре шага с наблюдаемыми критериями.
2. `work_step` — явный выбор шага с `observation_id` текущего наблюдения.
3. `work_switch browser` → `browser_open(local-form)` → `browser_fill` → `browser_click` —
   каждое действие получает отдельный observation пакет с новым `observation_id` и `generation`.
4. `work_switch computer` → `workspace_create(result.md)` — результат сохраняется в выбранной папке.
5. `done` — только после того, как observation помечает план завершённым.

Проверяется: последовательность kinds, что **каждый** запрос модели содержал
свой пронумерованный пакет observation, и что браузерные действия не
dispatch'атся без объявленного `browser` tab в наблюдении (отказ до вызова модели).

Ограничение: API — движок предложений; фактический ввод в DOM, запись байтов
и «take control» исполняются нативным клиентом (`desktop/windows`), который
здесь не запускался. Это проверка связки и контракта, не live-приёмка клиента.

## Проверки

```
pnpm --filter @cosmora/api exec vitest run test/computer-control.test.ts test/computer-scenarios.test.ts
pnpm --filter @cosmora/api typecheck
```

Результат: **91 passed** (88 прежних + 3 новых), typecheck exit 0.

## Следующие сценарии той же зоны (в работе)

- передача управления пользователю (`ask_user` → resume) вместе с остановкой;
- отключение устройства и продолжение после восстановления соединения;
- неизвестный исход внешнего действия: сначала выяснить состояние.
