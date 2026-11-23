# Браузерные E2E: обход dev-блокера и результат — 20 ноября 2026

## Проблема (dev-режим)

`playwright test -c playwright.composer.config.ts` в dev-режиме не запускал
`webServer`: `next dev` (Turbopack по умолчанию, при `--webpack` — тот же
результат) не разрешал `export * from "./X.js"` barrel `@cosmora/contracts`.

Проверено:

- символы реально экспортируются из `domain.ts:258` и `manager-work.ts:46`;
  `index.ts` содержит нужные `export *`; `tsx`-импорт даёт
  `typeof isValidChatTextAction === "function"`;
- `pnpm --filter @cosmora/contracts build` проходит;
- с `--webpack` ошибка та же, но уже `Can't resolve './agent-studio.js'` —
  то есть это общая проблема dev-резолвера `.js`→`.ts` в монорепо,
  а не конкретно Turbopack;
- `next build` (production) проходит успешно.

## Обход (без правки конфигов и исходников)

В `playwright.config.ts` уже предусмотрен штатный production-режим:

```
KOSMORA_E2E_PRODUCTION=1
command: pnpm --filter @cosmora/contracts build && pnpm build && pnpm start
```

Запуск:

```
KOSMORA_E2E_PRODUCTION=1 \
  node_modules/.bin/playwright test -c playwright.composer.config.ts
```

Production-сборка разрешает barrel-экспорты корректно; webServer стартует.

## Результат: 47/47 PASS

```
ok 33-44  e2e/run-draft-recovery.spec.ts   (chat + project, failed/cancelled,
           file/whitespace draft, stale click, pending file) — 12 сценариев
ok 45-47  e2e/terminal-run-recovery.spec.ts (cancelled/failed/completed —
           не оживают из stale history) — 3 сценария
ok 1-32   chat-reliability + composer-draft-races
47 passed (2.3m), exit 0
```

Это закрывает браузерный уровень BUG-01 и BUG-03 на `main` `b4ab5543`.

## Ограничение

Dev-резолвер по-прежнему неисправен: E2E проходят только в production-режиме.
Это отдельный системный вопрос владельца контрактов/Next (не дефект
BUG-01..05 и не патч экспорта чата). Пробные правки субпатов были откачены,
дерево `packages/contracts` чистое.

Для повторения: `KOSMORA_E2E_PRODUCTION=1 playwright test -c playwright.composer.config.ts`.

## Статус

Браузерные сценарии BUG-01/03 **пройдены** (47/47). Dev-резолвер остаётся
известной проблемой tooling'а, но больше не блокирует приёмку дефектов:
для неё используется существующий production-режим конфига. Постоянный фикс
dev-резолвера — отдельный незакрытый шаг владельца контрактов/Next.
