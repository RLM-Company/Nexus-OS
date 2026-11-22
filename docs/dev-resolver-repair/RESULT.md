# Восстановление обычного локального dev-запуска — итог

**Ветка:** `stage3/dev-resolver-repair`, база PR #617 (`dff95ddd`),
worktree `Nexus-OS-dev-resolver`. Дата: 22 ноября 2026.
**Область:** только dev-сборка и проверки — `next.config.ts`, команды запуска,
конфиг браузерных тестов. Не тронуты `main`, VPS, ключи, продуктовый UI,
Multi-Agent, `packages/contracts` и чужие незакоммиченные файлы.

## Причина

`packages/contracts/src/index.ts` — barrel из ~56 строк `export * from "./X.js"`.
На диске лежат `X.ts`. Production (`next build`) и `tsx` разрешают `.js`→`.ts`
через TS `moduleResolution: bundler`; **Next 16.3.1 dev-бандлер (Turbopack)
такого alias'а не делает**. Результат — `Module not found: Can't resolve
'./X.js'` и `Export isValidChatTextAction / MANAGER_WORK_CONTROL_EVENTS
doesn't exist`, `GET /` → 500. Базовая фиксация — `BASELINE.md`.

## Сравнение вариантов

### Вариант A — webpack `resolve.extensionAlias` (**выбран**)

- `next.config.ts`: `webpack(config, {dev})` добавляет
  `".js": [".ts", ".tsx", ".js", ".jsx"]` только в dev.
- Команды `dev`/`demo`/`demo:lan` получают явный `--webpack`;
  `build` тоже `--webpack` (Next 16 rejects webpack-конфиг при build на
  Turbopack без `--webpack`, и Turbopack-build ловит ту же ошибку barrel'а).
- Проверено: `GET /` = 200, `GET /graph-workspace` = 200,
  dev- и production-репетиции PASS, launcher 5/5, E2E 48/48.

### Вариант B — сохранить Turbopack (**отвергнут, не работает**)

Проверены три формы в `next.config.ts` при стандартном `pnpm dev` (Turbopack):

| Проба                                                                | Результат                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `turbopack.resolveAlias: {"@cosmora/contracts": ".../src/index.ts"}` | `GET /` 500 — внутренние `.js`-реэкспорты не переписаны           |
| `turbopack.resolveAlias: {".js$": ""}`                               | `GET /` 500 — wildcard не применяется к относительным реэкспортам |
| `turbopack.resolveExtensions: [..., ".ts", ...]`                     | Не устраняет `.js`-суффикс в импортах                             |

Turbopack 16.3.1 не умеет mapping `.js`→`.ts` для этого barrel'а. Поскольку
решение требует изменения общего контракта пакетов (переписывать ~56 строк
`index.ts` или менять的习惯 exports), а оно выходит за рамки блока, зафиксировано
точно: **интегратору нужно решить, переводить ли `packages/contracts/src/index.ts`
на extensionless/`./X.ts` импорты** — это затронет production ESM-вывод и
требует отдельной проверки `next build` + `tsc`. Выбран вариант A как решение
с меньшей областью изменения внутри позволенных файлов.

## Числа проверок

| Проверка                           | Команда                                                                      | Результат                       |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| Чистый dev-запуск, главная         | `pnpm --filter @cosmora/web dev` + `GET /`                                   | **200**, 106 268 байт           |
| Чистый dev-запуск, граф            | `GET /graph-workspace`                                                       | **200**, 14 047 байт            |
| Dev-репетиция (с чеком главной)    | `node scripts/presentation-demo.mjs --check`                                 | **HTTP rehearsal PASS**, exit 0 |
| Тесты лаунчера                     | `node --test scripts/test/presentation-demo.test.mjs`                        | **5/5 PASS**                    |
| Production-сборка                  | `pnpm --filter @cosmora/contracts build && pnpm --filter @cosmora/web build` | **exit 0**                      |
| Production-репетиция               | `presentation-demo.mjs --check --production --api-port=3100`                 | **HTTP rehearsal PASS**         |
| Браузерные тесты чата (dev)        | `playwright test -c playwright.composer.config.ts`                           | **48 PASS**                     |
| Браузерные тесты чата (production) | `KOSMORA_E2E_PRODUCTION=1` + тот же конфиг                                   | **48 PASS**                     |

Логи — в [results/](results/).

## Отдельная найденная проблема и повтор

Первый dev-прогон E2E дал **47 PASS / 1 FAIL**: `chat-reliability.spec.ts:88`
превысил базовый таймаут 30 с (дев-компиляция страниц ~10–20 с на тест; в
production тот же тест проходил). Причина — не резолвер и не продукт: страница
отрисовалась, ошибки импорта в логе нет. Повтор одного теста с
`--timeout=90000` прошёл (**21.4 с**, 1 PASS). После увеличения `timeout` до
90 с в `playwright.composer.config.ts` один полный dev-прогон дал **48 PASS**.

Оговорка по повторяемости: в последующих длинных dev-прогонах (6–7 мин)
dev-сервер иногда падал посредине (`ECONNREFUSED 127.0.0.1:3000` после ~12
тестов) — все выполненные до падения тесты, включая ранее падавший по таймауту,
проходили. Это нестабильность долгоживущего dev-сервера под нагрузкой в этом окружении,
не регрессия резолвера: обязательный по заданию production-прогон стабильно
даёт **48 PASS** (два независимых прогона). Логи всех попыток — в `results/`.

## Команды запуска (после правки)

```
pnpm install --frozen-lockfile
pnpm --filter @cosmora/contracts build     # prerequisite: dist workspace packages
pnpm --filter @cosmora/web dev             # webpack + extensionAlias, / и /graph-workspace
node scripts/presentation-demo.mjs --check # dev-репетиция с проверкой главной
pnpm --filter @cosmora/web build            # next build --webpack
node scripts/presentation-demo.mjs --check --production --api-port=3100
node --test scripts/test/presentation-demo.test.mjs
playwright test -c playwright.composer.config.ts
```
