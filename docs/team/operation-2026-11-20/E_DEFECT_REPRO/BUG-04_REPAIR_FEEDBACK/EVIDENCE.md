# Доказательства — BUG-04

## Baseline

[REPAIR_FEEDBACK_DELIVERY_RU.md:16-49](../../../operation-2026-11-10/deliveries/02_DEVELOPER/REPAIR_FEEDBACK_DELIVERY_RU.md):
результат проверки игнорировался, поэтому необрезанные stdout/stderr/journal
могли попасть в запрос модели и новый чекпоинт. Два реальных регресса
доказали artificial token в захваченном запросе и в `repair_request.source_check`.

Фикстуры: [repair-feedback-2026-11-12](../../../operation-2026-11-10/deliveries/02_DEVELOPER/fixtures/repair-feedback-2026-11-12/) —
`baseline-failed.log`, `receipt.json`, `SHA256SUMS.txt`,
`first-expanded-counter-failed.log`, `second-expanded-counter-failed.log`.

## После исправления

Вырезание до фрагмента в 8000 символов; невалидные Legacy-доказательства →
`REPAIR_CHECK_REQUIRED`/409. Добавлено 6 случаев (модель/чекпоинт, отмена,
идемпотентность, токен на границе, длинный безопасный вывод, `truncated=true`).

Логи: `api-passed.log`. Baseline **2 FAILED → 2 PASS**. Расширенные прогоны
146 PASS + 3/4 FAIL (ошибка теста: `f.checked` использовал дефолтный runner
вместо `repairRunner`). Финальные API/context/tree/GitHub: **150 PASS + 1 opt-in SKIP**.

## Свежий повтор 20.11.2026 на `db06774c` (main)

Команда: `vitest run test/code-agent.test.ts` (apps/api).
**Результат: 105 PASS, 1 skipped (106), exit 0** — включает все кейсы
redaction в `repair_request.source_check`, границу фрагмента, отмену и
идемпотентность.

## Передача владельцу

Владелец 02_DEVELOPER; см. [OWNER_HANDOFF.md](../OWNER_HANDOFF.md).
Статус: подтверждено, исправлено, повторено после исправления в поставке 12.11.
