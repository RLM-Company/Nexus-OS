# Доказательства — BUG-02

## Baseline

CI `43262386490`, browser job `131336988797`,
`chat-reliability.spec.ts:87`: «Ошибка запуска», повтор прошёл, результат
**489 passed + 1 flaky, job SUCCESS**. Диагностика загружалась только в
`failure()`, поэтому восстановившийся crash потерял trace/error_code.

Fixture: `receipt.json:9-25` в каталоге
[chat-flake-2026-11-12](../../../operation-2026-11-10/deliveries/02_DEVELOPER/fixtures/chat-flake-2026-11-12/):
`baseline_isolated {passed:10, retries:0}`, `baseline_mixed {...}`.
Продуктовый фикстурный прогон 10/10 при retries 0; смешанный прогон
160 PASS / 1 FAIL (Games `file://` заблокирован политикой Chromium) /
1 прерван / 328 не запущено.

## После исправления

`policy_regression.before`: «Playwright reports flaky=1 but exits0; regression fails».
`policy_regression.after`: «exits1; regression passes».
Введён `apps/web/src/app/e2e-flaky-policy.test.ts` с искусственным первым FAIL
и успешным повтором; артефакты загружаются безусловно.

## Свежий повтор 20.11.2026 на `db06774c` (main)

Команда: `vitest run src/app/e2e-flaky-policy.test.ts`
(вместе с `recoverable-run-draft.test.ts` и `restored-run-state.test.ts`).
**Результат: 3 файла, 17 тестов, 17 PASS, exit 0.** Gate-логика `failOnFlakyTests`
и загрузка артефактов подтверждены локально.

Браузерный набор Playwright (`composer` config) в production-режиме прошел
**47/47 PASS**, включая `chat-reliability.spec.ts` — источник исторического
flaky-события. Полный GitHub CI с `CI=1` (режим `failOnFlakyTests`) локально
не запускается: нет runner; gate подтвержден юнитом `e2e-flaky-policy.test.ts`.
Обход dev-блокера — [E2E_BLOCKER.md](../E2E_BLOCKER.md).

## Ограничение

[CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md:25-32](../../../operation-2026-11-10/deliveries/02_DEVELOPER/CHAT_FLAKE_FOLLOWUP_2026_11_13_RU.md):
5 прогонов × 3 сценария = 15 выполнений, гипотеза не воспроизведена;
корень исторического сбоя чата остаётся неизвестным; причины не объявляются.
