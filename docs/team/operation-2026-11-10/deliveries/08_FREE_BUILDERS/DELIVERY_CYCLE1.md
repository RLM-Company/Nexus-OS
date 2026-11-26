# DELIVERY — 08_FREE_BUILDERS / games-sites cycles

База: `5f976d77b9a756ddcb10365e3aa60e1efb69d8b7` (main 25.11.2026).
Ветка: `studio/games-sites-cycle`. Merge/deploy не выполнялись.
Решения владельца (26.11): web-нативный 3D; правую панель трогать минимальным
integration commit; связь с computer executor (OpenCode №2) отложена.

## Цикл 1 — Games: диагностика ошибки → файл → исправление → повторный запуск

### Что было

`game-development.spec.ts` уже проверял, что ошибки game.js видны в консоли
`<ol id="game-log">` внутри sandbox-iframe, что DOM/сеть недоступны и что
зависший код останавливается. Диагностика не была связана с конкретным файлом
и не показывалась вне iframe; пользователю приходилось вручную искать причину.

### Что работает теперь

- Sandboxed runtime отправляет родителю структурированное сообщение
  `kosmora-game-diagnostic` с именем файла `game.js`, номером строки worker-кода
  и текстом ошибки. Сообщение принимается только от активного iframe сессии.
- Чистая функция `mapWorkerErrorToGameLine` пересчитывает номер строки worker'а
  в номер строки исходного `game.js` по известному preamble'у `gameWorkerSource`.
  Если исходник изменился так, что не совпадает с запущенным worker'ом, или
  местоположение в стеке отсутствует — номер строки не выдумывается (`null`).
- `GameSourcePreview` показывает доступную diag с role=alert: «Ошибка в
  game.js, строка N: …» и подсказкой «Исправьте game.js и нажмите Запустить
  игру». Исправление исходника аннулирует старую сессию иdiag; явный
  повторный запуск запускает исправленный код без нового запроса к модели.

### Изменённые файлы

- `apps/web/src/app/games/game-project-runtime.ts` — structured diagnostic postMessage.
- `apps/web/src/app/games/game-error-diagnostic.ts` — bounded mapping + message extraction.
- `apps/web/src/app/games/game-error-diagnostic.test.ts` — 5 unit-тестов.
- `apps/web/src/app/games/game-source-preview.tsx` — приём/отображение diag.
- `apps/web/e2e/game-development.spec.ts` — e2e «ошибка → файл → исправление → перезапуск».

### Проверки и результаты

```sh
pnpm --filter @cosmora/web exec vitest run src/app/games   # 10 passed (3 files)
pnpm --filter @cosmora/web typecheck                        # EXIT 0
pnpm --filter @cosmora/web lint                             # EXIT 0
pnpm --filter @cosmora/contracts build && pnpm --filter @cosmora/web build  # EXIT 0
pnpm exec prettier --write <изменённые файлы>              # PASS
node scripts/check-secrets.mjs                             # PASS
```

**E2E-прогон на этом Windows-хосте не завершён.** Два запуска
`playwright test -c playwright.config.ts e2e/game-development.spec.ts`
(production-режим) упали по таймауту webServer: сначала API-fixture за 60 с,
затем полная пересборка Next + `next start` за 180 с. Журналы содержат
предупреждения «Attempted import error» от чужих файлов（`studio-data-*`,
`presentations/*`) в текущем main. Тест «ошибка → файл → исправление →
перезапуск» добавлен, но его прохождение здесь не заявляется; полный
браузерный suite должен подтвердить CI. Unit-тесты и сборка прошли.

### Ограничения

Сообщение об ошибке и номер строки извлекаются из worker stack; при
несовпадении запущенного и текущего исходника номер строки честно не
показывается. Диагностика не исполняет и не исправляет код автоматически.
Показ ошибки остаётся в Games; подключение к правой панели — следующий срез.
