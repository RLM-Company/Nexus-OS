# Базовое воспроизведение: HTTP 500 на / в dev — 22 ноября 2026

**Ветка:** `stage3/dev-resolver-repair`. **База:** PR #617 head `dff95ddd`
(содержит TXT/HTML-экспорт и проверку главной страницы репетиции).
**Окружение:** Windows, Node v26.13.0, Next 16.3.1, pnpm 11.19.0,
зависимости установлены `pnpm install --frozen-lockfile --offline`.

## Команда и результат

```
pnpm --filter @cosmora/web dev
GET http://127.0.0.1:3000/  →  HTTP 500
```

Лог сервера (Next 16.3.1 **Turbopack**, по умолчанию):

```
Error: Module not found: Can't resolve './account-finance.js'
  packages/contracts/src/index.ts:34:1
  export * from "./account-finance.js";
...
Error: Export isValidChatTextAction doesn't exist in target module
  apps/web/src/app/composer-draft-storage.ts:2
Error: Export MANAGER_WORK_CONTROL_EVENTS doesn't exist in target module
  apps/web/src/app/manager-work-panel.tsx:12
GET / 500 in 18.9s
```

## Точная причина

`packages/contracts/src/index.ts` — barrel с ~56 строками
`export * from "./X.js"`. На диске в `packages/contracts/src/` лежат `X.ts`.
Production (`next build`) и `tsx` разрешают `.js`→`.ts` корректно (TS
`moduleResolution: bundler`). Dev-бандлер Turbopack такого alias'а не делает:
он ищет физический `.js`, не находит и либо падает `Module not found`, либо
возвращает неполный набор экспортов (`Export ... doesn't exist`).

Проверено: символы реально есть —
`isValidChatTextAction` в `domain.ts`, `MANAGER_WORK_CONTROL_EVENTS` в
`manager-work.ts`; прямой `tsx`-импорт из `src/index.ts` даёт
`typeof === "function"`. Значит проблема именно в dev-резолвере путей,
не в коде контрактов.

## Границы

Меняем только dev-сборку и проверки: `next.config.ts`, команды запуска,
скрипты репетиции/тестов. Не трогаем `packages/contracts`, продуктовый UI,
main, VPS, ключи, Multi-Agent и чужие незакоммиченные файлы.
