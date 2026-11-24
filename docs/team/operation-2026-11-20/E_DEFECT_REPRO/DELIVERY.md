# DELIVERY — воспроизводимые дефекты с PR и повторной проверкой

**Статус:** готово к передаче владельцу; все пять дефектов воспроизведены,
исправлены и повторены. Не объявляется «принято первой группой»: сообщений
кандидатов не было. **BASE_SHA:** `51ce52a9`; повторы — на `main` `b4ab5543`.

## Состав

| Файл                                                                   | Результат                                   |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| [README.md](README.md)                                                 | источник, критерии отбора, пять дефектов    |
| [BUG-01_REQUEST_RECOVERY](BUG-01_REQUEST_RECOVERY/README.md)           | данные, сценарий, ожидаемое, доказательства |
| [BUG-02_CHAT_FLAKE](BUG-02_CHAT_FLAKE/README.md)                       | flaky-тест и потеря диагностики             |
| [BUG-03_TERMINAL_RUN_RECOVERY](BUG-03_TERMINAL_RUN_RECOVERY/README.md) | воскрешение завершённого запуска            |
| [BUG-04_REPAIR_FEEDBACK](BUG-04_REPAIR_FEEDBACK/README.md)             | секрет в запросе на repair                  |
| [BUG-05_TEST_DATABASE_URL](BUG-05_TEST_DATABASE_URL/README.md)         | Windows-путь, исправление                   |
| [OWNER_HANDOFF.md](OWNER_HANDOFF.md)                                   | владельцы и статусы                         |
| [RECHECK_PROTOCOL.md](RECHECK_PROTOCOL.md)                             | команды повтора и результаты                |
| [E2E_BLOCKER.md](E2E_BLOCKER.md)                                       | обход dev-блокера; 47/47 E2E                |

Для каждого дефекта: `input.json`, `SCENARIO.md`, `EXPECTED.md`, `EVIDENCE.md`;
для BUG-05 — [патч](BUG-05_TEST_DATABASE_URL/0001-fix-path-assertion.patch).

## Свежие повторы

| Уровень                     | Результат                             |
| --------------------------- | ------------------------------------- |
| Юнит (BUG-01/02/03)         | **17/17 PASS**                        |
| E2E composer (BUG-01/02/03) | **47/47 PASS** (12 + 47 + 3 сценария) |
| API (BUG-04)                | **105 PASS, 1 skipped**               |
| Лаунчер (BUG-05)            | **5/5 PASS** + `HTTP rehearsal PASS`  |

## Остаётся открытым

1. Постоянный фикс dev-резолвера `@cosmora/contracts` — E2E идут только в
   production-режиме ([E2E_BLOCKER.md](E2E_BLOCKER.md)).
2. Полный GitHub CI с `CI=1` для BUG-02 — нет runner.
3. Решение о merge патчей BUG-05 и D/CANDIDATE_CHAT_EXPORT.
4. Реальные сообщения первой группы — после дропа каждый баг проходит ту же
   схему через [FEEDBACK_TRIAGE.md](../C_CLOSED_DROP/FEEDBACK_TRIAGE.md).
