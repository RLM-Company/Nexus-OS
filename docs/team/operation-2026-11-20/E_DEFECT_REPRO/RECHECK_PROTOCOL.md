# Протокол повторной проверки после исправления

## Правило

Повтор — это тот же минимальный вход и сценарий, что в `input.json` и
`SCENARIO.md` дефекта, на новой зафиксированной версии с исправлением.
Результат записывается в `EVIDENCE.md` с датой, SHA и командой. Нельзя
закрыть дефект записью в документе без фактического прогона (класс C
[борда гештальтов](../../../product/STAGE_TWO_GESTALT_BOARD_RU.md)).

## Свежие повторы 20.11.2026 (`main` `b4ab5543`)

| ID     | Команда                                                                     | Результат                                  |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------ |
| BUG-01 | `vitest run src/app/recoverable-run-draft.test.ts` (+2 файла)               | 3 файла, **17/17 PASS**                    |
| BUG-01 | `KOSMORA_E2E_PRODUCTION=1 playwright test -c playwright.composer.config.ts` | **12/12 PASS** (`run-draft-recovery`)      |
| BUG-02 | `vitest run src/app/e2e-flaky-policy.test.ts` (+2 файла)                    | 3 файла, **17/17 PASS**                    |
| BUG-02 | тот же E2E-набор                                                            | **47/47 PASS**, включая `chat-reliability` |
| BUG-03 | `vitest run src/app/restored-run-state.test.ts` (+2 файла)                  | 3 файла, **17/17 PASS**                    |
| BUG-03 | тот же E2E-набор                                                            | **3/3 PASS** (`terminal-run-recovery`)     |
| BUG-04 | `vitest run test/code-agent.test.ts` (apps/api)                             | **105 PASS, 1 skipped**                    |
| BUG-05 | `node --test scripts/test/presentation-demo.test.mjs`                       | **5/5 PASS**                               |

Плюс `node scripts/presentation-demo.mjs --check` → **HTTP rehearsal PASS**.

## Dev-блокер снят обходом

Dev-резолвер `@cosmora/contracts` нестабилен; для E2E используется штатный
production-режим конфига (`KOSMORA_E2E_PRODUCTION=1`), который сборку и
webServer запускает корректно. Подробное расследование, обход и результат
47/47 — [E2E_BLOCKER.md](E2E_BLOCKER.md). Постоянный фикс dev-резолвера
остаётся отдельным вопросом владельца контрактов/Next.

## Что считается провалом повтора

- Хотя бы один из описанных сценариев даёт прежнее поведение.
- Количество наблюдателей/отправок больше ожидаемого.
- Секрет или содержимое вложения появляется в запросе/файле.
- CI проходит при `flaky=1` или теряет trace.
- Тест лаунчера падает на Windows с тем же расхождением пути (BUG-05).
