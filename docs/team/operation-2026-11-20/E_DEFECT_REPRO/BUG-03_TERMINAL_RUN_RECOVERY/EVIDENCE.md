# Доказательства — BUG-03

## Baseline

CI `43389934875`, artifact `14020214341`: повторяющийся `run.cancelled` для
одного ID, GET history только с пользовательским сообщением,
`restoredRunState` выводил `queued`, EventSource открывался заново → terminal →
refresh → queued. Trace не доказывает, что React стёр текст; причина отмены
неизвестна.

Фикстуры: [terminal-run-recovery-2026-11-13](../../../operation-2026-11-10/deliveries/02_DEVELOPER/fixtures/terminal-run-recovery-2026-11-13/) —
`original-trace-findings.json` с ролью/статусом/временем и SHA-256,
`baseline-browser.log`, `initial-test-precondition-failure.log`,
`initial-unit-syntax-failure.log`.

## После исправления

`restored-run-state.ts` с 7 тестами; `terminal-run-recovery.spec.ts` — 3
регрессии (completed/failed/cancelled), один наблюдатель вместо цикла.
Логи: `unit-passed.log`, `browser-passed.log`, `SHA256SUMS`,
`api-oci-base-main/test-passed.log`.

Первый E2E ожидал HTTP 202 вместо контрактных 201 — 3 FAIL (ошибка подготовки
теста, не продукта). Старый продукт: 3 FAIL (12/15/17 observers вместо 1).
Финальный production Chromium: **69 PASS**.

## Свежий повтор 20.11.2026 на `db06774c` (main)

Команда: `vitest run src/app/restored-run-state.test.ts`
(вместе с `recoverable-run-draft.test.ts` и `e2e-flaky-policy.test.ts`).
**Результат: 3 файла, 17 тестов, 17 PASS, exit 0.**

Браузерный E2E `terminal-run-recovery.spec.ts`: **3/3 PASS** на `main` `b4ab5543`
в production-режиме (`KOSMORA_E2E_PRODUCTION=1`, 47/47 всех сценариев composer):
cancelled/failed/completed не оживают из stale history.
Обход dev-блокера — [E2E_BLOCKER.md](../E2E_BLOCKER.md).

## Передача владельцу

Владелец 01_CODEX; см. [OWNER_HANDOFF.md](../OWNER_HANDOFF.md).
Статус: подтверждено, исправлено, повторено после исправления в поставке 13.11.
