import { describe, expect, it } from "vitest";
import { extractSupplierInput } from "../src/supplier-input-extraction.js";
import { compareSupplierOffers } from "../src/supplier-offer-comparison.js";

const complete = {
  requirements: [
    { itemId: "p1", label: "Материал", quantity: 10, unit: "шт" },
    { itemId: "p2", label: "Работа", quantity: 2, unit: "ч" }
  ],
  offers: [
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
  ]
};

describe("supplier input extraction", () => {
  it("merges several file parts and feeds the existing calculation", () => {
    const extraction = extractSupplierInput([
      { requirements: complete.requirements },
      { offers: complete.offers }
    ]);
    expect(extraction.ready).toBe(true);
    expect(extraction.needs_answer).toBe(false);
    expect(extraction.gaps).toEqual([]);
    const report = compareSupplierOffers(extraction.input!);
    expect(report.csv).toContain("Альфа");
    expect(report.csv).toContain("2000");
  });

  it("reports a missing currency as a question instead of inventing one", () => {
    const extraction = extractSupplierInput([
      {
        ...complete,
        offers: [{ ...complete.offers[0], currency: undefined }]
      }
    ]);
    expect(extraction.ready).toBe(false);
    expect(extraction.input).toBeNull();
    expect(extraction.needs_answer).toBe(true);
    const gap = extraction.gaps.find((item) => item.code === "missing_currency");
    expect(gap?.path).toBe("offers[0].currency");
    expect(gap?.question).toContain("валюты");
  });

  it("asks for a second offer instead of running a non-comparison", () => {
    const extraction = extractSupplierInput([
      { requirements: complete.requirements, offers: [complete.offers[0]] }
    ]);
    expect(extraction.ready).toBe(false);
    expect(extraction.needs_answer).toBe(true);
    expect(extraction.gaps.some((item) => item.code === "missing_offers")).toBe(true);
  });

  it("keeps an unknown cost as an explicit null gap", () => {
    const extraction = extractSupplierInput([
      {
        ...complete,
        offers: [
          {
            ...complete.offers[0],
            additionalCosts: [{ label: "Доставка", amount: undefined }]
          }
        ]
      }
    ]);
    expect(extraction.gaps.some((gap) => gap.code === "unknown_cost_amount")).toBe(true);
    expect(extraction.needs_answer).toBe(true);
  });

  it("detects an unknown line item without dropping the known ones", () => {
    const extraction = extractSupplierInput([
      {
        ...complete,
        offers: [
          {
            ...complete.offers[0]!,
            lines: [
              ...complete.offers[0]!.lines,
              { itemId: "pX", quantity: 1, unit: "шт", unitPrice: 1 }
            ]
          }
        ]
      }
    ]);
    expect(extraction.ready).toBe(false);
    expect(
      extraction.gaps.filter(
        (gap) => gap.code === "unknown_item_id" && gap.path.endsWith(".itemId")
      )
    ).toHaveLength(1);
  });
});
