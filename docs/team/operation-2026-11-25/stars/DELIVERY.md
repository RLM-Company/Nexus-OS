# Stars: первая связанная работа команды

База: `codex/stars-mission-1` (`1816478c`, PR #677) + API `codex/stars-mission-2`.

## Что добавлено

- `apps/web/src/app/stars/page.tsx` — отдельное пространство Stars (не чат и не сайдбар):
  карта участников с ролью, задачей, статусом, заменой и переданной частью;
  связи зависимостей; текущая работа и его проверка; обращение к агенту;
  кнопки паузы/продолжения/отмены; постоянная команда через `team_scope`
  и событийный запуск записью `event:supplier-proposals-ready`.
- `packages/core/src/stars-environment.ts` — заменяемый интерфейс среды:
  локальный инертный адаптер и cloud-реализация подменяется без изменения
  контрактов миссии; привязка событий идемпотентна.
- `scripts/stars-acceptance.mjs` + `stars-acceptance.json` — полный прогон.

## Приёмка (фактический вывод)

```
brief: planning v2
plan: working v3
fail: working v4
replace: working v5
message: working v6
result: working v7
result: working v8
verify: verifying v9
verify: verifying v10
combine: completed v11
STARS ACCEPTANCE PASSED
exit 0
```

Покрыто: поручение, менеджер + двое исполнителей, зависимости, отказ
исполнителя, замена с передачей незавершённой части, два результата,
проверка старшим, общий итог, сохранение/перезапуск через JSON round-trip.

## Проверки

- `eslint` core/web — 0
- `tsc --noEmit` core/web — 0
- `prettier --check .` — 0
- `scripts/stars-acceptance.mjs` — exit 0

Vitest локально недоступен из-за sandbox EPERM; API-тест готов для CI.
