# DELIVERY — 02_OPENCODE (первый срез)

**База:** `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
**Ветка:** `feature/oc2-games-sites-workspace-20261127`.

## Что реально добавлено

- `apps/web/src/app/games/game-project-v2-edits.ts` — адресные правки v2-проекта:
  название, среда запуска, автозапуск, исходники, отдельная сцена, трансформа
  модели. Каждая правка меняет только выбранное поле, сохраняет остальные
  исходники/ресурсы байт-идентичными и проверяет результат через
  `parseGameProjectV2`.
- `apps/web/src/app/games/v2-scene-panel.tsx` — минимальная панель в зоне Games
  для этих правок; подключена в `game-source-editor.tsx` только для v2.
- Документы поставки: INTERFACES, SCENARIOS, CHECKPOINT, INTEGRATION.

## Проверки

```
pnpm --filter @cosmora/web exec vitest run src/app/games/game-project-v2-edits.test.ts   # 4/4
pnpm --filter @cosmora/web typecheck                                                     # exit 0
```

Prettier по изменённым файлам — чистый.

## Ограничения

Это первый срез цикла 1, не весь блок. 3D runtime, редактируемая сцена, Sites,
полный продуктовый сценарий и отказы ещё в работе — см. SCENARIOS.md.
