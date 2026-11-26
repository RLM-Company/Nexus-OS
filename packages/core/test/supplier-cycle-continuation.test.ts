import { describe, expect, it } from "vitest";
import {
  acceptSupplierResult,
  applySupplierCycleEvent,
  initialSupplierCycle,
  SupplierCycleConflict,
  type SupplierCycleState
} from "../src/supplier-cycle-continuation.js";

const requirements = [
  { itemId: "p1", label: "Материал", quantity: 10, unit: "шт" },
  { itemId: "p2", label: "Работа", quantity: 2, unit: "ч" }
];
const offer = (supplier: string) => ({
  supplier,
  currency: "RUB",
  deliveryDays: 3,
  additionalCosts: [],
  lines: [
    { itemId: "p1", quantity: 10, unit: "шт", unitPrice: 100 },
    { itemId: "p2", quantity: 2, unit: "ч", unitPrice: 500 }
  ]
});

describe("supplier execution cycle", () => {
  it("asks a question when offers are missing and resumes after the answer", () => {
    let state = applySupplierCycleEvent(initialSupplierCycle(), {
      type: "parts",
      parts: [{ requirements }]
    });
    expect(state.stage).toBe("awaiting_answer");
    expect(state.question).toContain("предложение");
    expect(state.parts).toHaveLength(1);

    state = applySupplierCycleEvent(state, {
      type: "answer",
      parts: [{ offers: [offer("Альфа"), offer("Бета")] }]
    });
    expect(state.stage).toBe("calculating");
    expect(state.question).toBeNull();
    expect(state.extraction?.ready).toBe(true);
    expect(state.parts).toHaveLength(2);
  });

  it("preserves accepted parts through an intermediate error", () => {
    let state = applySupplierCycleEvent(initialSupplierCycle(), {
      type: "parts",
      parts: [{ requirements, offers: [offer("Альфа"), offer("Бета")] }]
    });
    const before = state.parts.length;
    state = applySupplierCycleEvent(state, { type: "error", code: "CALCULATION_INTERRUPTED" });
    expect(state.error_code).toBe("CALCULATION_INTERRUPTED");
    expect(state.parts).toHaveLength(before);
    expect(state.extraction?.ready).toBe(true);

    state = applySupplierCycleEvent(state, {
      type: "instructions",
      text: "Учесть доставку отдельно"
    });
    expect(state.instructions).toEqual(["Учесть доставку отдельно"]);
    expect(state.error_code).toBeNull();
    expect(state.parts).toHaveLength(before);
  });

  it("keeps the accepted result through pause, resume and cancel", () => {
    let state = applySupplierCycleEvent(initialSupplierCycle(), {
      type: "parts",
      parts: [{ requirements, offers: [offer("Альфа"), offer("Бета")] }]
    });
    state = acceptSupplierResult(state, { format: "v1", csv: "csv", markdown: "md" });
    expect(state.stage).toBe("result_ready");

    const paused = applySupplierCycleEvent(state, { type: "pause" });
    expect(paused.stage).toBe("result_ready");
    expect(paused.result?.csv).toBe("csv");
    const cancelled = applySupplierCycleEvent(state, { type: "cancel" });
    expect(cancelled.stage).toBe("cancelled");
    expect(cancelled.result?.csv).toBe("csv");
  });

  it("pauses and resumes unfinished work without losing extraction", () => {
    let state = applySupplierCycleEvent(initialSupplierCycle(), {
      type: "parts",
      parts: [{ requirements }]
    });
    const waiting = state;
    state = applySupplierCycleEvent(state, { type: "pause" });
    expect(state.stage).toBe("paused");
    expect(state.parts).toEqual(waiting.parts);
    state = applySupplierCycleEvent(state, { type: "resume" });
    expect(state.stage).toBe("awaiting_answer");
    expect(state.question).toBe(waiting.question);
  });

  it("rejects a stale control event", () => {
    const state: SupplierCycleState = initialSupplierCycle();
    expect(() =>
      applySupplierCycleEvent(state, { type: "pause", expected_version: state.version + 1 })
    ).toThrow(SupplierCycleConflict);
  });
});
