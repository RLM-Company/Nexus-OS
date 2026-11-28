# INTEGRATION — 02_OPENCODE

## Общие файлы

Затронуты только:`apps/web/src/app/games/`, `apps/web/src/app/sites/`,
`apps/web/src/app/games/RUNTIME_DECISION.md`, `apps/web/THIRD_PARTY_NOTICES.md`,
`apps/web/package.json`, `pnpm-lock.yaml`, корневой `package.json` (npm-скрипт),
`scripts/run-games-sites-scenario.mjs` и папка поставки. Общие `app.ts`,
`server.ts`, exports/config и контракты в `packages/contracts` не изменены.

## Подключение

- `V2ScenePanel` импортирован в `game-source-editor.tsx` и рендерится в правой
  колонке только при `format === "kosmora.game-project.v2"`;
- `ThreeGameView` подключён в `game-source-preview.tsx` отдельным режимом
  «3D-просмотр (WebGL)»; прежний изолированный статический OBJ-lite iframe
  сохранён по умолчанию (e2e `game-development.spec.ts:332` проходит);
- `three@0.187.0` и `@types/three@0.187.0` — зафиксированные зависимости
  `apps/web` с MIT-уведомлением в `THIRD_PARTY_NOTICES.md`;
- `site-project.ts` использует существующий `@cosmora/contracts/website-document`
  для валидации HTML; новый общий контракт не добавлялся.

## Совместимость

- v1-проекты продолжают редактироваться прежними тремя файлами; правки v2 не
  меняют их поведение.
- Старые/ZIP-проекты и квитанции остаются совместимыми: сериализация v2 идёт
  через существующий `parseGameProjectV2`.
- UI_RULES: общий sidebar, основной чат, logo и стиль не переделывались.
- CSP и изоляция iframe/Worker сохранены; сетевые/нативные права не расширялись.

## CI

PR #693 на head `833352c6`: `Verify monorepo`, `Browser acceptance`,
`Code sandbox isolation` — SUCCESS; `mergeStateStatus: CLEAN`. Мерж в main не
выполнялся — ожидает решения владельца/интегратора.
