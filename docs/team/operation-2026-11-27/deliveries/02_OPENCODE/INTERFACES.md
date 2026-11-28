# Интерфейсы поставки 02_OPENCODE (Games и Sites)

**База:** `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
**Ветка:** `feature/oc2-games-sites-workspace-20261127`.

## Адресные правки v2-проекта игры

`apps/web/src/app/games/game-project-v2-edits.ts`:

- вход: каноничный JSON `kosmora.game-project.v2` + `V2FieldEdit`
  (`title`, `scene_html`, `styles_css`, `game_js`, `launch`, `scene`,
  `model_transform`, `model_render`);
- выход: `{ok:true,json,project}` или `{ok:false,error}`;
- инвариант: меняется только выбранное поле, остальные исходники/ресурсы/сцены
  остаются байт-идентичными; результат проверяется `parseGameProjectV2` до выдачи;
- `model_transform` и `model_render` пишут инертные маркеры `# kosmora-transform:`
  и `# kosmora-render:` в `obj-lite`; вершины и грани не изменяются;
- `readModelMarkers` / `v2SceneDescriptor` читают маркеры и преобразуют их в
  дескриптор three.js с безопасными значениями по умолчанию; цвет принимается
  только в формате `#rrggbb`.

`apps/web/src/app/games/v2-scene-panel.tsx` — минимальная панель в зоне Games с
полями названия, среды запуска, автозапуска, сцены, поворота/масштаба модели и
камеры/света/цвета/каркасного режима. Подключена в `GameSourceEditor` только для
v2-пакетов; v1 и старые форматы не меняются. Общий sidebar/чат/logo не трогались.

## 3D runtime

`apps/web/src/app/games/three-scene.ts` — чистые функции `buildThreeScene` и
`buildThreeCamera` поверх `three@0.187.0` (MIT); вход — только инертные v2-маркеры.
`apps/web/src/app/games/three-game-view.tsx` — WebGL-компонент с корректным
`dispose()` и остановкой `requestAnimationFrame` при Stop/размонтировании.

## Sites

`apps/web/src/app/sites/site-project.ts`:

- `parseSiteProject(source)` — проверяет `kosmora.site-project.v1`: до 40 блоков,
  32 связанных ресурса, лимиты base64, запрет script/iframe/form;
- `editSiteBlock(source, id, value)` — меняет один блок, остальные блоки,
  ресурсы и `html` остаются байт-идентичными;
- `editSiteResource(source, resource)` — добавляет/заменяет один ресурс,
  отклоняет исполняемые имена (`.exe`, `.js`, `.sh` и др.).

## Экспорт

`scripts/run-games-sites-scenario.mjs` — воспроизводимый сценарий с фиксированным
`mtime` ZIP: один и тот же набор исходников даёт байт-идентичный архив.

## Данные и владение

- Проект игры/сайта остаётся Canvas-артефактом владельца проекта; нового
  хранилища и прав доступа нет.
- v1 (`kosmora.game-project.v1`) и v2 (`kosmora.game-project.v2`) сохраняют
  прежние форматы; правки аддитивные.
- Внешние артефакты/медиа не подключаются; исполняемый код по-прежнему только
  в изолированном Worker.
