# INTEGRATION — Games project v2 контракт

Отдельный аддитивный integration commit в ветке `studio/games-sites-cycle`.
Владелец shared-контракта — Codex; требуется его review перед слиянием.

## Что добавлено

- `packages/contracts/src/game-project-v2.ts` — новый формат
  `kosmora.game-project.v2`: исходники (scene/styles/game), настройки запуска
  (`canvas2d_worker` | `web3d_sandbox`), base64-ресурсы, статичные сцены и
  одна лёгкая 3D-модель (`gltf-json` | `obj-lite`).
- `packages/contracts/src/game-project-v2.test.ts` — 5 тестов (принятие,
  отказ v1 как v2, отказ внешних URL/лишних полей, битый base64, лимиты).
- `packages/contracts/package.json` — новый subpath export `./game-project-v2`.

## Что НЕ изменено

- `game-project.ts` v1 и его валидация/исполнение — без изменений.
  Все существующие игры продолжают работать по старому пути.
- Никаких новых прав, сетевых запросов, маршрутов, миграций БД или тарифов.
- Поля контракта — инертные структурированные данные; исполнение по-прежнему
  только в изолированном Worker/3D-sandbox.
- Общие `index.ts`, app/server, sidebar/chat/logo/global CSS не трогались.

## Проверки

```sh
pnpm --filter @cosmora/contracts exec vitest run src/game-project-v2.test.ts   # 5 passed
pnpm --filter @cosmora/contracts typecheck
pnpm --filter @cosmora/contracts build
```

## Откат

revert этого коммита: удалить v2-файл, тест и subpath export. v1-проекты и
существующие пользовательские данные не затрагиваются.
