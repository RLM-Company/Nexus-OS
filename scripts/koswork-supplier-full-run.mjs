/** Полный локальный прогон цикла исполнения Koswork на существующем входе
 * BIZ-013: пользователь прикладывает JSON-файлы, агент извлекает данные,
 * вызывает расчёт и сохраняет результат. Промежуточные события (пропуск,
 * ошибка, новые указания, пауза, продолжение, отмена) не теряют принятого.
 *
 * Запуск из корня репозитория:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *     --import ./scripts/cycle-resolve-hook.mjs \
 *     scripts/koswork-supplier-full-run.mjs
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { extractSupplierInput } from "../packages/core/src/supplier-input-extraction.ts";
import {
  acceptSupplierResult,
  applySupplierCycleEvent,
  initialSupplierCycle
} from "../packages/core/src/supplier-cycle-continuation.ts";
import { compareSupplierOffers } from "../packages/core/src/supplier-offer-comparison.ts";

const outDir = new URL("../docs/team/operation-2026-11-25/execution-cycle/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const log = [];
const record = (step, status, detail) => {
  log.push({ step, status, detail });
  console.log(`${step}: ${status} — ${detail}`);
};

// 1. Пользовательский вход: два вложения с разрешёнными предложениями.
const specification = {
  requirements: [
    { itemId: "a1", label: "Монтаж", quantity: 10, unit: "шт" },
    { itemId: "a2", label: "Доставка", quantity: 2, unit: "ч" }
  ]
};
const offers = [
  {
    supplier: "Альфа",
    currency: "RUB",
    deliveryDays: 3,
    additionalCosts: [],
    lines: [
      { itemId: "a1", quantity: 10, unit: "шт", unitPrice: 100 },
      { itemId: "a2", quantity: 2, unit: "ч", unitPrice: 500 }
    ]
  },
  {
    supplier: "Бета",
    currency: "RUB",
    deliveryDays: 5,
    additionalCosts: [],
    lines: [
      { itemId: "a1", quantity: 10, unit: "шт", unitPrice: 90 },
      { itemId: "a2", quantity: 2, unit: "ч", unitPrice: 600 }
    ]
  }
];

let state = initialSupplierCycle();
state = applySupplierCycleEvent(state, { type: "parts", parts: [specification] });
assert.equal(state.stage, "awaiting_answer");
assert.ok(state.question?.includes("предложение"));
record("извлечение", "вопрос", state.question);

// 2. Ответ владельца: второе вложение с предложениями.
state = applySupplierCycleEvent(state, { type: "answer", parts: [{ offers }] });
assert.equal(state.stage, "calculating");
record("ответ", "принято", `${state.parts.length} частей, извлечение готово`);

// 3. Промежуточная ошибка расчёта: принятые части сохраняются.
state = applySupplierCycleEvent(state, { type: "error", code: "CALCULATION_INTERRUPTED" });
assert.equal(state.error_code, "CALCULATION_INTERRUPTED");
assert.equal(state.parts.length, 2);
record("ошибка", "сохранено", `parts=${state.parts.length}, code=${state.error_code}`);

// 4. Новые указания пользователя: ошибка сбрасывается, части остаются.
state = applySupplierCycleEvent(state, {
  type: "instructions",
  text: "Проверить валюту и срока поставки перед расчётом"
});
assert.equal(state.error_code, null);
assert.equal(state.stage, "calculating");
assert.equal(state.parts.length, 2);
record("указания", "принято", state.instructions.join("; "));

// 5. Пауза и продолжение: вопрос и извлечение не теряются.
state = applySupplierCycleEvent(state, { type: "pause" });
assert.equal(state.stage, "paused");
state = applySupplierCycleEvent(state, { type: "resume" });
assert.equal(state.stage, "calculating");
assert.equal(state.extraction?.ready, true);
record("пауза/продолжение", "готово", "стадия calculating восстановлена");

// 6. Существующий расчёт BIZ-013 и принятие результата.
const report = compareSupplierOffers(state.extraction.input);
assert.ok(report.csv.includes("Альфа"));
state = acceptSupplierResult(state, report);
assert.equal(state.stage, "result_ready");
record("расчёт", "готово", `${report.format}, CSV ${report.csv.length} байт`);

// 7. Отмена после принятия: результат остаётся доступен.
const cancelled = applySupplierCycleEvent(state, { type: "cancel" });
assert.equal(cancelled.stage, "cancelled");
assert.equal(cancelled.result?.csv, report.csv);
record("отмена", "результат сохранён", `csv=${cancelled.result?.csv.length} байт`);

writeFileSync(
  new URL("full-run.local.json", outDir),
  JSON.stringify({ log, result: report }, null, 2)
);
console.log("FULL RUN PASSED");
