# CHECKPOINT — 02_OPENCODE

**Обновлено:** 27 ноября 2026. **База:** `3af92583`.
**Ветка:** `feature/oc2-games-sites-workspace-20261127`.
**Head:** см. `git rev-parse HEAD` в ветке; PR #693.

## Выполнено

- Адресные v2-правки (`game-project-v2-edits.ts`): название, среда запуска,
  исходники, сцена, трансформация модели, камера/свет/материал. Маркеры
  `# kosmora-*` инертны и не меняют вершины `obj-lite`.
- Панель `v2-scene-panel.tsx` подключена в `GameSourceEditor` только для v2.
- Закреплён 3D runtime three.js 0.187.0 (MIT, notices); сцена (`three-scene.ts`)
  и WebGL-просмотр (`three-game-view.tsx`) вместо статического PNG.
- `site-project.ts`: связанные ресурсы и адресные блоки сайта с запретом
  исполняемых имен и script/iframe/form.
- Воспроизводимый сценарий `run-games-sites-scenario.mjs`: новая 3D-игра и сайт,
  три независимые правки, детерминированный ZIP, распаковка и повторное
  открытие, отказы. Артефакты в `deliveries/02_OPENCODE/ACCEPTANCE/`.

## Проверки (последний прогон)

- `pnpm --filter @cosmora/web exec vitest run src/app/games src/app/sites/site-project.test.ts`
  → 27/27;
- `pnpm --filter @cosmora/web lint` → exit 0;
- `pnpm --filter @cosmora/web typecheck` → exit 0;
- `pnpm --filter @cosmora/web build` → exit 0;
- `node scripts/run-games-sites-scenario.mjs` → 6/6, exit 0, детерминированный
  SHA256 `a837333db66501bc002700f3fe82563234ff46feef97a91c4e766ef1f5964407`
  (проверено двумя независимыми прогонами).

## Точка продолжения

PR #693: все проверки CI зелёные (`Verify monorepo`, `Browser acceptance`,
`Code sandbox isolation`), `mergeStateStatus: CLEAN`. Мерж в main не выполнялся —
ожидает решения владельца/интегратора. Нативный адаптер OpenCode 1 не требуется
при выбранном веб-рантайме; общий sidebar/чат/logo не менялись.
