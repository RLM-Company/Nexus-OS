import { describe, expect, it } from "vitest";
import type { BusinessScenarioId, BusinessScenarioRunResult } from "@cosmora/contracts";
import { runBusinessScenario } from "../src/business-scenarios.js";

const supplierInput = {
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

const validInput = (id: BusinessScenarioId): Record<string, unknown> => {
  switch (id) {
    case "BIZ-013":
      return supplierInput;
    case "BIZ-014":
      return { items: ["Кабель", "Разъём"], required_fields: ["цена", "срок"] };
    case "BIZ-016": {
      const row = { item_id: "AB-10", quantity: 5 };
      return { order: [row], invoice: [row], receipt: [row] };
    }
    case "BIZ-017":
      return {
        before_prices: [{ sku: "A", unit_price: 10, unit: "шт", pack: "1" }],
        after_prices: [{ sku: "A", unit_price: 12, unit: "шт", pack: "1" }]
      };
    case "BIZ-021":
      return {
        period: "2026-11",
        operations: [
          { kind: "income", amount: 100, source: "продажа" },
          { kind: "expense", amount: 40, source: "закупка" }
        ]
      };
    case "BIZ-023":
      return { revenue: 100, discount: 10, known_cost: 60, cost_complete: false };
    case "BIZ-024":
      return { period: "2026-11", plan: 100, fact: 120 };
    case "BIZ-038":
      return { template_fields: ["№", "дата"], provided: { "№": "001", дата: "2026-11-27" } };
    case "BIZ-040":
      return {
        pages: [{ file_name: "a.pdf", page: 1, source: "pdf_text", text: "Сумма: 00123" }],
        fields: [
          { key: "amount", label: "Сумма", patterns: ["Сумма:\\s*([0-9]+)"], critical: true }
        ]
      };
    case "BIZ-042":
      return {
        requirements: [
          { id: "T-1", mandatory: true, evidence: "сертификат", deadline: "2026-12-01" }
        ]
      };
    case "BIZ-046":
      return {
        source: "Продукт стоит 19 700 ₽.",
        answer: "Стоимость 19 700 ₽.",
        required_facts: ["19 700 ₽"],
        forbidden: ["21 000"],
        format: "any"
      };
    case "BIZ-072":
      return {
        period: "2026-11",
        entries: [{ text: "Решение по поставщику", source: "решение №12" }],
        stale: ["старый прайс"]
      };
  }
};

const ids: BusinessScenarioId[] = [
  "BIZ-013",
  "BIZ-014",
  "BIZ-016",
  "BIZ-017",
  "BIZ-021",
  "BIZ-023",
  "BIZ-024",
  "BIZ-038",
  "BIZ-040",
  "BIZ-042",
  "BIZ-046",
  "BIZ-072"
];

describe("business scenario runner — 12 scenarios", () => {
  it("has a stable registry of exactly these 12 IDs", () => {
    expect(ids).toHaveLength(12);
    for (const id of ids) {
      const result = runBusinessScenario(id, validInput(id));
      expect(result.format).toBe("kosmora.business-scenario-run.v1");
      expect(result.scenario_id).toBe(id);
      expect(result.needs_answer).toBe(false);
      expect(result.gaps).toEqual([]);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(["text", "table", "register", "calculation", "checklist", "gaps"]).toContain(
        result.artifact.kind
      );
    }
  });

  it("BIZ-013 reuses the verified comparison and keeps known subtotal", () => {
    const result = runBusinessScenario("BIZ-013", supplierInput);
    expect(result.artifact.kind).toBe("table");
    expect(result.artifact.reused).toContain("BIZ-013");
    expect(result.artifact.csv).toContain("Итог,Альфа,RUB,4");
    const rows = result.artifact.rows as Array<{ complete: boolean; total: string | null }>;
    expect(rows[0]).toMatchObject({ complete: true, total: "7.5" });
  });

  it("BIZ-040 reuses the verified field register and flags a missing critical field", () => {
    const result = runBusinessScenario("BIZ-040", {
      fields: [
        { key: "penalty", label: "Неустойка", patterns: ["Неустойка:\\s*([0-9]+)"], critical: true }
      ],
      pages: [{ file_name: "a.pdf", page: 1, source: "pdf_text", text: "Сумма: 123" }]
    });
    expect(result.artifact.kind).toBe("register");
    expect(result.artifact.reused).toContain("BIZ-040");
    const rows = result.artifact.rows as Array<{ status: string; value: string }>;
    expect(rows[0]).toMatchObject({ status: "missing", value: "" });
    expect(result.needs_answer).toBe(true);
    expect(result.gaps.map((gap) => gap.field)).toContain("critical:penalty");
  });

  it("calculation scenarios produce reproducible numbers", () => {
    const margin = runBusinessScenario("BIZ-023", validInput("BIZ-023"));
    expect(margin.artifact).toMatchObject({ margin: "30", cost_complete: false });
    const variance = runBusinessScenario("BIZ-024", validInput("BIZ-024"));
    expect(variance.artifact.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: "отклонение", value: "20" })])
    );
    const report = runBusinessScenario("BIZ-021", validInput("BIZ-021"));
    expect(report.artifact).toMatchObject({ income: "100", expense: "40", profit: "60" });
  });

  it("reports gaps and needs_answer instead of inventing missing values", () => {
    const result = runBusinessScenario("BIZ-023", { revenue: 100 });
    expect(result.needs_answer).toBe(true);
    expect(result.artifact.kind).toBe("gaps");
    expect(result.gaps.map((gap) => gap.field)).toContain("known_cost");
    expect(JSON.stringify(result.artifact)).not.toContain("60");
  });

  it("reapplies to changed input rather than replaying fixture values", () => {
    const first = runBusinessScenario("BIZ-023", {
      revenue: 100,
      known_cost: 60,
      cost_complete: true
    });
    expect(first.artifact).toMatchObject({ margin: "40", cost_complete: true });
    const second = runBusinessScenario("BIZ-023", {
      revenue: 200,
      discount: 50,
      known_cost: 25,
      cost_complete: true
    });
    expect(second.artifact).toMatchObject({ margin: "125", cost_complete: true });
    expect(second.artifact).not.toEqual(first.artifact);
    expect(second.needs_answer).toBe(false);

    const catalog = runBusinessScenario("BIZ-014", {
      items: ["Новый товар"],
      required_fields: ["срок поставки"]
    });
    expect(catalog.artifact.header).toEqual(["#", "Позиция", "срок поставки"]);
    expect(JSON.stringify(catalog)).not.toContain("Кабель");
  });

  it("is deterministic: same input yields the same result", () => {
    const input = validInput("BIZ-072");
    expect(runBusinessScenario("BIZ-072", input)).toEqual(runBusinessScenario("BIZ-072", input));
  });

  it("does not claim truth or model-quality judgement in style checks", () => {
    const result: BusinessScenarioRunResult = runBusinessScenario("BIZ-046", validInput("BIZ-046"));
    expect(result.needs_answer).toBe(false);
    expect(JSON.stringify(result.artifact.evaluation)).toContain("not_checked");
  });
});
