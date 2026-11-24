# Постоянный фикс dev-резолвера `@cosmora/contracts` — план

## Суть проблемы

В dev-режиме (Next 16.3.1, Turbopack по умолчанию и webpack при `--webpack`)
импорты вида `export * from "./agent-studio.js"` из `@cosmora/contracts`
не разрешаются: на диске лежат `.ts`, а резолвер ищет `.js`.
Production-сборка (`next build`) и `tsx` этот barrel resolve'ют нормально,
поэтому дефект проявляется только в dev.

Симптомы (на `main` `b4ab5543`):

```
next dev:           Export isValidChatTextAction / MANAGER_WORK_CONTROL_EVENTS
                    doesn't exist in @cosmora/contracts
next dev --webpack: Can't resolve './agent-studio.js' in
                    packages/contracts/src/index.ts
GET / → 500
```

`presentation-demo.mjs --check` проходит в dev (`--webpack`), потому что
проверяет только `/graph-workspace` и API; главную страницу `/` он не
проверяет, поэтому дефект оставался незамеченным.

## Подход

Единственный источник истины — исходники `.ts` в `packages/contracts/src`.
Варианты (нужно выбрать один, согласовать с владельцем контрактов/Next):

1. **Webpack `resolve.extensionAlias`** в `next.config.ts`:

   ```ts
   webpack(config) {
     config.resolve.extensionAlias = {
       ".js": [".ts", ".tsx", ".js"]
     };
     return config;
   }
   ```

   Это стандартный способ redirect'ить `.js`→`.ts` в TypeScript-монорепо.
   Работает только для webpack; для Turbopack нужен отдельный
   `turbopack.resolveExtensions` (см. docs), но он не делает alias `.js`→`.ts`.
   Значит dev-режим нужно зафиксировать на webpack (`presentation-demo`
   уже использует `--webpack`, `pnpm dev` — пока нет).

2. **Убрать `.js` из barrel-импортов** в `packages/contracts/src/index.ts`
   (`export * from "./agent-studio"` вместо `"./agent-studio.js"`).
   Меньше конфигов, но правка файла, принадлежащего владельцу контрактов,
   и может повлиять на production ESM-вывод (там `.js` корректен). Требует
   проверки `next build` и `tsc`.

3. **Subpath-экспорты** для каждого символа, используемого клиентскими
   компонентами — обход, уже опробован: одна правка снимает одну ошибку,
   но открывает следующую. Не масштабируется.

Рекомендуется вариант 1 как наименее инвазивный для исходников и
совместимый с уже используемым `--webpack` в `presentation-demo`.

## Проверка после фикса (обязательная)

1. `node scripts/presentation-demo.mjs --check` — должен остаться PASS.
2. Добавить в репетицию проверку GET `/` с ожидаемым `200 text/html`
   (сейчас проверяется только `/graph-workspace`) — иначе дефект снова
   останется незамеченным.
3. `KOSMORA_E2E_PRODUCTION=1 playwright test -c playwright.composer.config.ts`
   — остаться 47/47.
4. dev-режим: `pnpm --filter @cosmora/web dev` + GET `/` → 200 (новый чек).

## Статус

План подготовлен; реализация ожидает решения владельца контрактов/Next.
E2E дефекты уже закрыты через production-режим
([E2E_BLOCKER.md](E2E_BLOCKER.md)), поэтому это улучшение tooling'а,
а не блокер приёмки.
