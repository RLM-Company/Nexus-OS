import type { SupplierComparisonInput } from "./supplier-offer-comparison.js";

/** Результат извлечения исходных данных поставщиков.
 *
 * Чистая функция: не читает файлы, не вызывает модель и не меняет состояние.
 * Возвращает как пригодную для существующего расчёта часть, так и честный
 * перечень пропусков. Часть пропусков можно восполнить из другого файла,
 * часть требует ответа владельца. */
export type SupplierExtractionGap = {
  code:
    | "missing_requirements"
    | "missing_offers"
    | "unknown_item_id"
    | "missing_quantity"
    | "missing_unit"
    | "missing_price"
    | "missing_currency"
    | "invalid_delivery_days"
    | "unknown_cost_amount";
  path: string;
  question?: string;
};

export type SupplierExtraction = {
  input: SupplierComparisonInput | null;
  gaps: SupplierExtractionGap[];
  /** True only when the calculation cannot be completed without an owner answer. */
  needs_answer: boolean;
  /** Sufficient data to call compareSupplierOffers() as-is. */
  ready: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const question = (text: string): string => `Уточните: ${text}`;

/** Extract supplier comparison input from already-parsed file contents.
 *
 * Several JSON parts may be merged (one per attachment). Literal numbers and
 * identifiers are preserved; normalized wording is never used to guess a
 * missing value. A missing currency or an unknown additional cost stays a gap
 * because inventing either would change the result of BIZ-013. */
export function extractSupplierInput(parts: readonly unknown[]): SupplierExtraction {
  const gaps: SupplierExtractionGap[] = [];
  const requirements: Array<{
    itemId: string;
    label: string;
    quantity: number;
    unit: string;
  }> = [];
  const offers: Array<{
    supplier: string;
    currency: string;
    deliveryDays?: number | null;
    additionalCosts?: Array<{ label: string; amount: number | null }> | null;
    lines: Array<{
      itemId: string;
      quantity: number;
      unit: string;
      unitPrice: number | null;
    }>;
  }> = [];
  const known = new Set<string>();

  for (const part of parts) {
    if (!isRecord(part)) continue;
    const rawRequirements = Array.isArray(part.requirements) ? part.requirements : [];
    for (const [index, row] of rawRequirements.entries()) {
      const path = `requirements[${index}]`;
      if (!isRecord(row)) {
        gaps.push({ code: "missing_requirements", path });
        continue;
      }
      const { itemId, label, quantity, unit } = row;
      if (typeof itemId !== "string" || !itemId.trim()) {
        gaps.push({
          code: "unknown_item_id",
          path: `${path}.itemId`,
          question: question(`ID позиции для «${typeof label === "string" ? label : ""}».`)
        });
        continue;
      }
      if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
        gaps.push({
          code: "missing_quantity",
          path: `${path}.quantity`,
          question: question(`количество для позиции ${itemId}.`)
        });
        continue;
      }
      if (typeof unit !== "string" || !unit.trim()) {
        gaps.push({
          code: "missing_unit",
          path: `${path}.unit`,
          question: question(`единицу для позиции ${itemId}.`)
        });
        continue;
      }
      if (typeof label !== "string" || !label.trim()) {
        gaps.push({
          code: "missing_requirements",
          path: `${path}.label`,
          question: question(`название позиции ${itemId}.`)
        });
        continue;
      }
      known.add(itemId);
      requirements.push({ itemId, label, quantity, unit });
    }

    const rawOffers = Array.isArray(part.offers) ? part.offers : [];
    for (const [oIndex, rawOffer] of rawOffers.entries()) {
      const path = `offers[${oIndex}]`;
      if (!isRecord(rawOffer)) {
        gaps.push({ code: "missing_offers", path });
        continue;
      }
      const supplier = typeof rawOffer.supplier === "string" ? rawOffer.supplier.trim() : "";
      const currency = typeof rawOffer.currency === "string" ? rawOffer.currency.trim() : "";
      if (!supplier) {
        gaps.push({
          code: "missing_offers",
          path: `${path}.supplier`,
          question: question(`название поставщика для предложения ${oIndex + 1}.`)
        });
      }
      if (!/^[A-Za-z]{3}$/.test(currency)) {
        gaps.push({
          code: "missing_currency",
          path: `${path}.currency`,
          question: question(
            `трёхбуквенный код валюты для «${supplier || `предложения ${oIndex + 1}`}».`
          )
        });
      }
      const deliveryDays = rawOffer.deliveryDays;
      if (
        deliveryDays !== undefined &&
        deliveryDays !== null &&
        (!Number.isSafeInteger(deliveryDays) || (deliveryDays as number) < 0)
      ) {
        gaps.push({
          code: "invalid_delivery_days",
          path: `${path}.deliveryDays`,
          question: question(`целое число дней поставки для «${supplier}» (0 — в тот же день).`)
        });
      }
      const costs: Array<{ label: string; amount: number | null }> = [];
      if (rawOffer.additionalCosts != null && !Array.isArray(rawOffer.additionalCosts)) {
        gaps.push({ code: "unknown_cost_amount", path: `${path}.additionalCosts` });
      } else if (Array.isArray(rawOffer.additionalCosts)) {
        for (const [cIndex, rawCost] of rawOffer.additionalCosts.entries()) {
          if (!isRecord(rawCost) || typeof rawCost.label !== "string" || !rawCost.label.trim()) {
            gaps.push({ code: "unknown_cost_amount", path: `${path}.additionalCosts[${cIndex}]` });
            continue;
          }
          const amount = rawCost.amount;
          if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
            gaps.push({
              code: "unknown_cost_amount",
              path: `${path}.additionalCosts[${cIndex}].amount`,
              question: question(
                `сумму расхода «${rawCost.label}» или явно укажите null для неизвестной.`
              )
            });
            continue;
          }
          costs.push({ label: rawCost.label, amount });
        }
      }
      const lines: Array<{
        itemId: string;
        quantity: number;
        unit: string;
        unitPrice: number | null;
      }> = [];
      const rawLines = Array.isArray(rawOffer.lines) ? rawOffer.lines : [];
      for (const [lIndex, rawLine] of rawLines.entries()) {
        const linePath = `${path}.lines[${lIndex}]`;
        if (!isRecord(rawLine)) {
          gaps.push({ code: "unknown_item_id", path: linePath });
          continue;
        }
        const itemId = typeof rawLine.itemId === "string" ? rawLine.itemId.trim() : "";
        if (!itemId) {
          gaps.push({
            code: "unknown_item_id",
            path: `${linePath}.itemId`,
            question: question(`ID позиции для строки ${lIndex + 1} поставщика «${supplier}».`)
          });
          continue;
        }
        if (!known.has(itemId)) {
          gaps.push({
            code: "unknown_item_id",
            path: `${linePath}.itemId`,
            question: question(`позиция ${itemId}: это лишняя строка или опечатка в ID?`)
          });
        }
        if (typeof rawLine.quantity !== "number" || !Number.isFinite(rawLine.quantity)) {
          gaps.push({
            code: "missing_quantity",
            path: `${linePath}.quantity`,
            question: question(`количество для позиции ${itemId} у «${supplier}».`)
          });
          continue;
        }
        if (typeof rawLine.unit !== "string" || !rawLine.unit.trim()) {
          gaps.push({
            code: "missing_unit",
            path: `${linePath}.unit`,
            question: question(`единицу для позиции ${itemId} у «${supplier}».`)
          });
          continue;
        }
        const unitPrice = rawLine.unitPrice;
        if (unitPrice !== null && (typeof unitPrice !== "number" || !Number.isFinite(unitPrice))) {
          gaps.push({
            code: "missing_price",
            path: `${linePath}.unitPrice`,
            question: question(
              `цену за единицу позиции ${itemId} у «${supplier}» или явно укажите null.`
            )
          });
          continue;
        }
        lines.push({
          itemId,
          quantity: rawLine.quantity,
          unit: rawLine.unit,
          unitPrice
        });
      }
      if (!supplier || !currency) continue;
      offers.push({
        supplier,
        currency: currency.toUpperCase(),
        ...(deliveryDays === undefined || deliveryDays === null
          ? {}
          : { deliveryDays: deliveryDays as number }),
        ...(rawOffer.additionalCosts === undefined || rawOffer.additionalCosts === null
          ? {}
          : { additionalCosts: costs }),
        lines
      });
    }
  }

  if (!requirements.length)
    gaps.unshift({
      code: "missing_requirements",
      path: "requirements",
      question: question("перечень позиций спецификации.")
    });
  // BIZ-013 compares offers: a single offer is not a comparison.
  if (offers.length < 2)
    gaps.unshift({
      code: "missing_offers",
      path: "offers",
      question: question("хотя бы одно дополнительное предложение поставщика для сравнения.")
    });

  const ready = gaps.length === 0 && requirements.length > 0 && offers.length > 1;
  return {
    input: ready ? { requirements, offers } : null,
    gaps,
    needs_answer: gaps.some((gap) => Boolean(gap.question)),
    ready
  };
}
