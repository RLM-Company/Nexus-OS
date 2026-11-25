import assert from "node:assert/strict";
import { extractSupplierInput } from "../packages/core/src/supplier-input-extraction.ts";
import { compareSupplierOffers } from "../packages/core/src/supplier-offer-comparison.ts";

const req = [
  { itemId: "p1", label: "Материал", quantity: 10, unit: "шт" },
  { itemId: "p2", label: "Работа", quantity: 2, unit: "ч" }
];
const offers = [
  {
    supplier: "Альфа",
    currency: "RUB",
    deliveryDays: 3,
    additionalCosts: [],
    lines: [
      { itemId: "p1", quantity: 10, unit: "шт", unitPrice: 100 },
      { itemId: "p2", quantity: 2, unit: "ч", unitPrice: 500 }
    ]
  },
  {
    supplier: "Бета",
    currency: "RUB",
    deliveryDays: 5,
    additionalCosts: [],
    lines: [
      { itemId: "p1", quantity: 10, unit: "шт", unitPrice: 90 },
      { itemId: "p2", quantity: 2, unit: "ч", unitPrice: 600 }
    ]
  }
];
let e = extractSupplierInput([{ requirements: req }, { offers }]);
assert.equal(e.ready, true);
assert.equal(e.gaps.length, 0);
let r = compareSupplierOffers(e.input);
assert.ok(r.csv.includes("Альфа"));
assert.ok(r.csv.includes("2000"));

e = extractSupplierInput([{ requirements: req, offers: [{ ...offers[0], currency: undefined }] }]);
assert.equal(e.ready, false);
assert.ok(e.needs_answer);
assert.ok(e.gaps.some((g) => g.code === "missing_currency" && g.question));

e = extractSupplierInput([
  {
    requirements: req,
    offers: [{ ...offers[0], additionalCosts: [{ label: "Доставка", amount: undefined }] }]
  }
]);
assert.ok(e.gaps.some((g) => g.code === "unknown_cost_amount"));

e = extractSupplierInput([
  {
    requirements: req,
    offers: [
      {
        ...offers[0],
        lines: [...offers[0].lines, { itemId: "pX", quantity: 1, unit: "шт", unitPrice: 1 }]
      }
    ]
  }
]);
assert.equal(e.ready, false);
assert.equal(e.gaps.filter((g) => g.code === "unknown_item_id").length, 1);
console.log("extractor checks: 4 passed");
