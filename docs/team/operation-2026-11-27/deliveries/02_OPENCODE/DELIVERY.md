# DELIVERY — 02_OPENCODE

**База:** `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
**Ветка:** `feature/oc2-games-sites-workspace-20261127`. **PR:** #693.
**Head (на момент обновления):** `dfc63319fd5963c97c69f3e154db7021854cbeb4`.

## Что реально добавлено

- `apps/web/src/app/games/game-project-v2-edits.ts` — адресные правки v2-проекта:
  название, среда запуска, автозапуск, исходники, отдельная сцена, трансформа
  модели, камера/свет/материал. Каждая правка меняет только выбранное поле,
  сохраняет остальные исходники/ресурсы байт-идентичными и проверяет результат
  через `parseGameProjectV2`. Параметры рендера хранятся в инертных маркерах
  `# kosmora-*` внутри `obj-lite`, исходные вершины не перезаписываются.
- `apps/web/src/app/games/v2-scene-panel.tsx` — минимальная панель в зоне Games
  для этих правок; подключена в `game-source-editor.tsx` только для v2.
- `apps/web/src/app/games/three-scene.ts` и `three-game-view.tsx` — настоящий
  3D runtime three.js 0.187.0 (MIT) с редактируемой сценой и WebGL-просмотром
  вместо статического PNG; изоляция worker-игр сохранена.
- `apps/web/src/app/sites/site-project.ts` — проект сайта со связанными
  ресурсами и адресными блоками, с запретом исполняемых имен и script/iframe/form.
- Диагностика ошибки запуска привязана к версии `game.js` (хэш исходника);
  тест проверяет, что после правки повторный запуск использует исправленную
  версию и старый диагностический маппинг больше не применяется.
- `V2ScenePanel` вынесен в правую рабочую колонку `game-source-editor.tsx`
  (адаптивный grid); в панели редактируются связанные ресурсы Games.
- Статический snapshot экспорта учитывает поворот/масштаб из проекта.
- `scripts/run-games-sites-scenario.mjs` — воспроизводимая приёмка: новая
  3D-игра «Космический курьер» и продающий сайт, три независимые правки,
  детерминированный экспорт/распаковка/открытие заново, отказы.
- Документы и артефакты в `docs/team/operation-2026-11-27/deliveries/02_OPENCODE/`.

## Проверки

```
pnpm --filter @cosmora/web exec vitest run src/app/games src/app/sites/site-project.test.ts   # 27/27
pnpm --filter @cosmora/web lint                                                              # exit 0
pnpm --filter @cosmora/web typecheck                                                         # exit 0
pnpm --filter @cosmora/web build                                                             # exit 0
node scripts/run-games-sites-scenario.mjs                                                    # 6/6, exit 0
```

SHA256 экспорта (детерминирован, подтверждено двумя прогонами):
`a837333db66501bc002700f3fe82563234ff46feef97a91c4e766ef1f5964407`.

## Ограничения и границы

- Нет платной модели, сети, Electron GUI и нативных прав; WebGL-компонент
  проверен сборкой и node-построением сцены, не GUI-взаимодействием.
- Игра «Ночная смена» владельца не использовалась.
- Отмена/reload/unsaved для v1 покрыты существующими e2e; v2 — повторным
  открытием из ZIP. Нативный адаптер OpenCode 1 не требуется при выбранном
  веб-рантайме. Общий sidebar/чат/logo не менялись.
- CI PR #693: `Verify monorepo` и `Browser acceptance` — см. актуальный статус
  в GitHub; локальные lint/typecheck/tests/build зелёные.
