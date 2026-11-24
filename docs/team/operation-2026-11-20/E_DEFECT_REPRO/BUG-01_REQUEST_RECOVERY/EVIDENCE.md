# Доказательства — BUG-01

## Baseline (до исправления)

[REQUEST_RECOVERY_2026_11_13_RU.md:13-32](../../../operation-2026-11-10/deliveries/02_DEVELOPER/REQUEST_RECOVERY_2026_11_13_RU.md):
кнопка не предлагалась для истории «только пользователь»; проверка
`!draft.trim()` позволяла восстановить поверх нового файла или пробельного
текста, затирая новый ввод и вложение.

Первый прогон: **8 FAIL + 2 PASS**. Для pending-file:
`Expected "" / Received "Реквизиты: 19 700 …"`.
Объединённый прогон: 85 PASS + 4 FAIL (счётчик принимал
`POST /chat-navigation/import-pins` за повторную отправку; позже уточнено).

## После исправления

Введены `recoverable-run-draft.ts` и 9 юнит-тестов; `run-draft-recovery.spec.ts`
— 12 браузерных сценариев. Финальный targeted-прогон: **12 PASS, retries 0**.
Селектор использует последний run ID и подтверждённый терминальный статус;
живые guard-проверки повторены перед восстановлением.

## Свежий повтор 20.11.2026 на `db06774c` (main)

Команда: `vitest run src/app/recoverable-run-draft.test.ts`
(вместе с `restored-run-state.test.ts` и `e2e-flaky-policy.test.ts`).
**Результат: 3 файла, 17 тестов, 17 PASS, exit 0.**

Браузерный E2E `run-draft-recovery.spec.ts`: **12/12 PASS** на `main` `b4ab5543`
в production-режиме (`KOSMORA_E2E_PRODUCTION=1`, 47/47 всех сценариев composer).
Покрыты failed/cancelled, file/whitespace draft, stale click и pending file.
Обход dev-блокера и детали — [E2E_BLOCKER.md](../E2E_BLOCKER.md).

## Передача владельцу

Владелец 01_CODEX; комплект передан в [OWNER_HANDOFF.md](../OWNER_HANDOFF.md).
Статус: подтверждено на зафиксированной версии, исправлено, повторено после
исправления в поставке 13.11.
