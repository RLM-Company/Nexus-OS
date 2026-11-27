# CHECKPOINT — 02_OPENCODE

**Обновлено:** 27 ноября 2026. **База:** `3af92583`.
**Ветка:** `feature/oc2-games-sites-workspace-20261127`.

## Выполнено

- Адресные v2-правки (`game-project-v2-edits.ts`) и минимальная панель
  (`v2-scene-panel.tsx`), подключённая в `GameSourceEditor`.
- Закреплён 3D runtime three.js 0.187.0 (MIT, notices), построены сцена
  (`three-scene.ts`) и WebGL-просмотр (`three-game-view.tsx`), подключённый
  вместо статического PNG для `web3d_sandbox`.
- Документированы интерфейсы, сценарии и решение по runtime.

## Проверки

- games v2 edits + three-scene: 7/7 vitest;
- web typecheck: exit 0;
- web build (с three.js): exit 0;
- Prettier по изменённым файлам: чистый.

## Точка продолжения

Sites: связанные ресурсы и адресные изменения блока; затем обязательный
продуктовый сценарий с экспортом/распаковкой/открытием заново и отказами.
