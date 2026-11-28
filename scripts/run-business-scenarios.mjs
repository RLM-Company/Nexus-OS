/** Reproducible 12-scenario acceptance for Harness 2.
 * Runs the pure production runner on new, non-fixture-shaped inputs and writes
 * a journal with artifacts and checks. No model/network/host access. */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { runBusinessScenario } from "../packages/core/src/business-scenarios.ts";

const out = new URL("../docs/team/operation-2026-11-27/deliveries/05_HARNESS/", import.meta.url);
mkdirSync(out, { recursive: true });

const supplier = {
  requirements: [
    { itemId: "AB-10", label: "Кабель", quantity: 12.5, unit: "м" },
    { itemId: "AB-20", label: "Разъём", quantity: 5, unit: "шт." }
  ],
  offers: [
    {
      supplier: "Альфа",
      currency: "RUB",
      deliveryDays: 4,
      additionalCosts: [{ label: "Доставка", amount: 0.25 }],
      lines: [
        { itemId: "AB-20", unit: "шт.", quantity: 5, unitPrice: 1.2 },
        { itemId: "AB-10", unit: "м", quantity: 12.5, unitPrice: 0.1 }
      ]
    },
    {
      supplier: "Бета",
      currency: "EUR",
      lines: [
        { itemId: "AB-10", unit: "рулон", quantity: 1, unitPrice: 2 },
        { itemId: "EXTRA", unit: "шт.", quantity: 1, unitPrice: 0 }
      ]
    }
  ]
};

const inputs = {
  "BIZ-013": supplier,
  "BIZ-014": { items: ["Кабель", "Разъём"], required_fields: ["цена", "срок"] },
  "BIZ-016": {
    order: [{ item_id: "AB-10", quantity: 5 }],
    invoice: [{ item_id: "AB-10", quantity: 5 }],
    receipt: [{ item_id: "AB-10", quantity: 5 }]
  },
  "BIZ-017": {
    before_prices: [{ sku: "A", unit_price: 10, unit: "шт", pack: "1" }],
    after_prices: [{ sku: "A", unit_price: 12, unit: "шт", pack: "1" }]
  },
  "BIZ-021": {
    period: "2026-11",
    operations: [
      { kind: "income", amount: 100, source: "продажа" },
      { kind: "expense", amount: 40, source: "закупка" }
    ]
  },
  "BIZ-023": { revenue: 100, discount: 10, known_cost: 60, cost_complete: false },
  "BIZ-024": { period: "2026-11", plan: 100, fact: 120 },
  "BIZ-038": { template_fields: ["№", "дата"], provided: { "№": "001", дата: "2026-11-27" } },
  "BIZ-040": {
    pages: [{ file_name: "a.pdf", page: 1, source: "pdf_text", text: "Сумма: 00123" }],
    fields: [{ key: "amount", label: "Сумма", patterns: ["Сумма:\\s*([0-9]+)"], critical: false }]
  },
  "BIZ-042": {
    requirements: [{ id: "T-1", mandatory: true, evidence: "сертификат", deadline: "2026-12-01" }]
  },
  "BIZ-046": {
    source: "Продукт стоит 19 700 ₽.",
    answer: "Стоимость 19 700 ₽.",
    required_facts: ["19 700 ₽"],
    forbidden: ["21 000"],
    format: "any"
  },
  "BIZ-072": {
    period: "2026-11",
    entries: [{ text: "Решение по поставщику", source: "решение №12" }],
    stale: ["старый прайс"]
  }
};

const results = [];
for (const [id, input] of Object.entries(inputs)) {
  const result = runBusinessScenario(id, input);
  assert.equal(result.needs_answer, false, `${id} unexpectedly needs an answer`);
  assert.ok(result.checks.length > 0, `${id} has no checks`);
  assert.ok(result.artifact && typeof result.artifact.kind === "string", `${id} has no artifact`);
  console.log(`${id}: ${result.artifact.kind} checks=${result.checks.length}`);
  results.push({ id, result });
}

// Re-application on changed input: the runner must not be fixture-bound.
const changed = runBusinessScenario("BIZ-023", {
  revenue: 200,
  discount: 0,
  known_cost: 50,
  cost_complete: true
});
assert.equal(changed.needs_answer, false);
results.push({ id: "BIZ-023/reapplied", result: changed });

// Gap path: no invented values.
const gap = runBusinessScenario("BIZ-021", { period: "2026-11" });
assert.equal(gap.needs_answer, true);
assert.equal(gap.artifact.kind, "gaps");
results.push({ id: "BIZ-021/gaps", result: gap });

writeFileSync(new URL("scenario-run.json", out), JSON.stringify(results, null, 2));
console.log(`SCENARIOS PASSED: ${Object.keys(inputs).length} + reapply + gaps`);
