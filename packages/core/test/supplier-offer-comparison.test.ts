import { describe, expect, it } from "vitest";
import {
  compareSupplierOffers,
  type SupplierComparisonInput
} from "../src/supplier-offer-comparison.js";

const example: SupplierComparisonInput = {
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
      supplier: "Бета|Сервис",
      currency: "EUR",
      additionalCosts: [{ label: "Доставка", amount: null }],
      lines: [
        { itemId: "AB-10", unit: "рулон", quantity: 1, unitPrice: 2 },
        { itemId: "EXTRA", unit: "шт.", quantity: 1, unitPrice: 0 }
      ]
    }
  ]
};

describe("supplier offer comparison", () => {
  it("compares exact IDs irrespective of quote row order and keeps currencies separate", () => {
    const result = compareSupplierOffers(example);
    expect(result.rows[0]).toMatchObject({
      supplier: "Альфа",
      currency: "RUB",
      deliveryDays: 4,
      complete: true,
      knownSubtotal: "7.5",
      total: "7.5",
      lines: [
        { itemId: "AB-10", quoteAmount: "1.25" },
        { itemId: "AB-20", quoteAmount: "6" }
      ]
    });
    expect(result.rows[1]).toMatchObject({
      supplier: "Бета|Сервис",
      currency: "EUR",
      unrequestedItems: ["EXTRA"],
      deliveryDays: null,
      additionalCostsStatus: "частично известны",
      total: null,
      lines: [
        { itemId: "AB-10", issues: ["разные единицы"] },
        { itemId: "AB-20", offeredQuantity: null, issues: ["позиция отсутствует"] }
      ]
    });
    expect(result.csv).toContain("Итог,Альфа,RUB,4,,,,,,,,7.5,7.5");
    expect(result.csv).toContain("Расход,Бета|Сервис,EUR,,,Доставка,,,,,,,,сумма не указана");
    expect(result.markdown).toContain("Бета\\|Сервис");
  });

  it("distinguishes zero, missing and non-applicable costs and makes CSV cells spreadsheet safe", () => {
    const exact = example.offers[0]!;
    const result = compareSupplierOffers({
      ...example,
      offers: [
        { ...exact, supplier: "\u200b=FORMULA", additionalCosts: [], deliveryDays: 0 },
        { currency: exact.currency, supplier: ',"Quoted"', lines: exact.lines },
        { ...exact, supplier: "Гамма", additionalCosts: [{ label: "Налог", amount: 0 }] }
      ]
    });
    expect(result.csv).toContain("'\u200b=FORMULA");
    expect(result.csv).toContain('",""Quoted"""');
    expect(
      result.rows.map(({ deliveryDays, additionalCostsStatus, total }) => ({
        deliveryDays,
        additionalCostsStatus,
        total
      }))
    ).toEqual([
      { deliveryDays: 0, additionalCostsStatus: "не применяются", total: "7.25" },
      { deliveryDays: null, additionalCostsStatus: "не указаны", total: null },
      { deliveryDays: 4, additionalCostsStatus: "указаны", total: "7.25" }
    ]);
  });

  it("shows quantity and price differences independently", () => {
    const result = compareSupplierOffers({
      ...example,
      offers: [
        {
          ...example.offers[0]!,
          lines: [
            { itemId: "AB-10", quantity: 11, unit: "м", unitPrice: null },
            { itemId: "AB-20", quantity: 6, unit: "шт.", unitPrice: 0 }
          ]
        },
        example.offers[1]!
      ]
    });
    expect(result.rows[0]).toMatchObject({
      total: null,
      lines: [
        { issues: ["недокомплект", "цена не указана"], quoteAmount: null },
        { issues: ["избыток"], quoteAmount: "0" }
      ]
    });
  });

  it("rejects duplicate IDs and rejects the numeric precision it cannot represent", () => {
    expect(() =>
      compareSupplierOffers({
        ...example,
        requirements: [example.requirements[0]!, example.requirements[0]!]
      })
    ).toThrow("Повтор ключа");
    expect(() =>
      compareSupplierOffers({
        ...example,
        requirements: [{ ...example.requirements[0]!, quantity: 0.00000001 }]
      })
    ).toThrow("Недопустимое число");
  });
});
