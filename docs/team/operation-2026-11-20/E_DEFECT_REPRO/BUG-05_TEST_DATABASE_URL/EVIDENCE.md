# Доказательства — BUG-05

## Подтверждено на зафиксированной версии

Команда (Windows, Node v26.13.0, `51ce52a9`):

```
node --test scripts/test/presentation-demo.test.mjs
```

Первый результат: **5 tests, 4 pass, 1 fail**:
`scripts/test/presentation-demo.test.mjs:48`,
Expected `file:/isolated-demo/demo.db`,
Actual `file:\isolated-demo\demo.db`.
Сырой вывод первого прогона сохранён в истории этого файла.

Остальные четыре теста прошли: явные порты без URL/wildcard, граф на точных
выдержках с SHA-256, отказ seeding при изменённой цитате, проверка
production proxy до запуска.

## Исправление

Патч: [0001-fix-path-assertion.patch](0001-fix-path-assertion.patch).
Суть: expected строится через `node:path join` с разделителем текущей ОС —
так же, как лаунчер строит `DATABASE_URL`. Это тестовый дефект, не продуктовый:
изоляция окружения и mock-режим не менялись.

Патч применён к рабочему дереву. На чистой копии базы
`git apply --check --whitespace=nowarn` = **0** (проверено 20.11.2026).

## Повторная проверка после исправления — ПРОЙДЕНА

Команда: `node --test scripts/test/presentation-demo.test.mjs`
Результат: **5 tests, 5 pass, 0 fail, exit 0**.
Сырой вывод: [UNIT_TEST_LOG.raw.txt](../../C_CLOSED_DROP/DEMO_DATA/UNIT_TEST_LOG.raw.txt).

Дополнительно после исправления повторно выполнена полная HTTP-репетиция
`node scripts/presentation-demo.mjs --check` → `HTTP rehearsal PASS`,
exit 0. Регрессии лаунчера нет.

## Связь с репетицией дропа

Первые две попытки HTTP-репетиции в этой сессии остановились на подготовке
PDF-воркера из-за отсутствия `tesseract.js` в окружении. Это отдельный
инфраструктурный блокер; он не является причиной BUG-05 и устранён
установкой точных версий зависимостей без правки исходников.

## Передача владельцу

Владелец 01_CODEX (платформенный комментарий — 03_OPENCODE); см.
[OWNER_HANDOFF.md](../OWNER_HANDOFF.md). Статус: подтверждено, исправлено,
повторено после исправления. Для включения в `main` — отдельное решение
ревью/merge.
