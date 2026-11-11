import { describe, expect, it } from "vitest";
import { mediaBudgetLabel, mediaBudgetNotice } from "./media-budget-status";

describe("Media UI budget receipt labels", () => {
  it("warns when the provider charge or hold is not settled", () => {
    expect(mediaBudgetLabel("uncertain")).toBe("Расход не подтверждён");
    expect(mediaBudgetNotice("uncertain")).toMatch(/дополнительным расходам/);
    expect(mediaBudgetLabel("reserved")).toBe("Бюджет зарезервирован");
    expect(mediaBudgetNotice("reserved")).toMatch(/Итоговый расход ещё не подтверждён/);
  });

  it("does not invent amounts or uncertain claims for reconciled and missing budget fields", () => {
    expect(mediaBudgetLabel("reconciled")).toBe("Расход учтён");
    expect(mediaBudgetNotice("reconciled")).toBeNull();
    for (const value of ["none", null, undefined] as const) {
      expect(mediaBudgetLabel(value)).toBeNull();
      expect(mediaBudgetNotice(value)).toBeNull();
    }
  });
});
