# Предмет решения интегратора: постоянный фикс barrel `@cosmora/contracts`

**Статус:** подготовлено, **не применялось**. PR #621 восстанавливает dev через
webpack `resolve.extensionAlias`; этот документ — точный предмет, что нужно
сделать, чтобы вернуть штатный Turbopack и убрать `--webpack` из dev/build.

## Суть

`packages/contracts/src/index.ts` содержит ~56 строк вида
`export * from "./X.js"`, но на диске лежат `X.ts`. Production и `tsx` это
разрешают через TS `moduleResolution: bundler`; Turbopack (Next 16.3.1) — нет.
Проверено в PR #621: три формы `turbopack.resolveAlias`/`resolveExtensions`
(direct src alias, `.js$`→``, custom extensions) не помогли — `GET /` остаётся 500. Webpack `extensionAlias` работает.

## Точный предмет

Перевести реэкспорты в `packages/contracts/src/index.ts` в форму, которую
Turbopack разрешает напрямую:

- либо `export * from "./X"` (extensionless — Turbopack читает `tsconfig.json`
  `paths` и стандартные расширения, см. docs `turbopack.md#resolving-custom-extensions`);
- либо `export * from "./X.ts"` (прямое имя файла).

Затронутые файлы: только `packages/contracts/src/index.ts` (~56 строк) и,
если выбран вариант с `.ts`, проверка сборки `packages/contracts` (tsconfig
`allowImportingTsExtensions` может запретить явный `.ts` в импортах — тогда
выбирать extensionless).

## Обязательная проверка после применения интегратором

```
pnpm --filter @cosmora/contracts build                  # ESM-вывод остался корректным
pnpm --filter @cosmora/web build                        # без --webpack, Turbopack
pnpm --filter @cosmora/web dev                          # без --webpack, Turbopack
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/          # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/graph-workspace  # 200
node scripts/presentation-demo.mjs --check              # dev-репетиция с чеком главной
node --test scripts/test/presentation-demo.test.mjs     # 5/5
KOSMORA_E2E_PRODUCTION=1 playwright test -c playwright.composer.config.ts   # 48 PASS
```

После зелёных проверок можно убрать из PR #621: `webpack()`-хук в
`next.config.ts`, `--webpack` в `package.json`, `scripts/dev-webpack.mjs`,
`KOSMORA_DEV_WEBPACK` в playwright-конфигах и увеличенный timeout (если
Turbopack-компиляция укладывается в 30 с).

## Почему не сделано в этом блоке

Прямо оговорено заданием: «Main, VPS, ключи, продуктовый интерфейс,
Multi-Agent и чужие незакоммиченные файлы остаются за рамками» и «Если без
изменения общего контракта пакетов решения нет — приложи результаты обоих
вариантов и точный предмет решения для интегратора». Изменение
`packages/contracts/src/index.ts` — это изменение общего контракта пакетов
с влиянием на production ESM-вывод, поэтому оно оставлено интегратору.
