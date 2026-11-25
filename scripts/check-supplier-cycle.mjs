import assert from "node:assert/strict";
import {
  acceptSupplierResult,
  applySupplierCycleEvent,
  initialSupplierCycle,
  SupplierCycleConflict
} from "../packages/core/src/supplier-cycle-continuation.ts";

const req = [
  { itemId: "p1", label: "Материал", quantity: 10, unit: "шт" },
  { itemId: "p2", label: "Работа", quantity: 2, unit: "ч" }
];
const offer = (supplier) => ({
  supplier,
  currency: "RUB",
  deliveryDays: 3,
  additionalCosts: [],
  lines: [
    { itemId: "p1", quantity: 10, unit: "шт", unitPrice: 100 },
    { itemId: "p2", quantity: 2, unit: "ч", unitPrice: 500 }
  ]
});

let state = applySupplierCycleEvent(initialSupplierCycle(), {
  type: "parts",
  parts: [{ requirements: req }]
});
assert.equal(state.stage, "awaiting_answer");
assert.ok(state.question?.includes("предложение"));
state = applySupplierCycleEvent(state, {
  type: "answer",
  parts: [{ offers: [offer("А"), offer("Б")] }]
});
assert.equal(state.stage, "calculating");
assert.equal(state.parts.length, 2);
assert.equal(state.extraction.ready, true);

const beforeError = state.parts.length;
state = applySupplierCycleEvent(state, { type: "error", code: "CALCULATION_INTERRUPTED" });
assert.equal(state.error_code, "CALCULATION_INTERRUPTED");
assert.equal(state.parts.length, beforeError);
state = applySupplierCycleEvent(state, { type: "instructions", text: "Учесть доставку" });
assert.deepEqual(state.instructions, ["Учесть доставку"]);
assert.equal(state.error_code, null);

state = acceptSupplierResult(state, { format: "v1", csv: "csv", markdown: "md" });
assert.equal(state.stage, "result_ready");
assert.equal(applySupplierCycleEvent(state, { type: "pause" }).result.csv, "csv");
assert.equal(applySupplierCycleEvent(state, { type: "cancel" }).stage, "cancelled");

let waiting = applySupplierCycleEvent(initialSupplierCycle(), {
  type: "parts",
  parts: [{ requirements: req }]
});
let paused = applySupplierCycleEvent(waiting, { type: "pause" });
assert.equal(paused.stage, "paused");
assert.equal(paused.parts.length, waiting.parts.length);
let resumed = applySupplierCycleEvent(paused, { type: "resume" });
assert.equal(resumed.stage, "awaiting_answer");
assert.equal(resumed.question, waiting.question);

const start = initialSupplierCycle();
assert.throws(
  () => applySupplierCycleEvent(start, { type: "pause", expected_version: start.version + 1 }),
  SupplierCycleConflict
);
console.log("cycle checks: 5 passed");
