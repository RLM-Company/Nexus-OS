import { validateDataTable } from "@cosmora/contracts/data-workspace";

type Requirement = { itemId: string; label: string; quantity: number; unit: string };
type OfferLine = { itemId: string; quantity: number; unit: string; unitPrice: number | null };
type AdditionalCost = { label: string; amount: number | null };
type Offer = {
  supplier: string;
  currency: string;
  deliveryDays?: number | null;
  additionalCosts?: readonly AdditionalCost[] | null;
  lines: readonly OfferLine[];
};

export type SupplierComparisonInput = {
  requirements: readonly Requirement[];
  offers: readonly Offer[];
};

type ReportCell = string | number | null;
type AdditionalCostsStatus = "не указаны" | "не применяются" | "частично известны" | "указаны";

// Preserve up to six decimal places on each input using integer arithmetic.
const scale = 1_000_000n;
function scaled(value: number, field: string) {
  const [integer, fraction = ""] = String(value).split(".");
  if (typeof value !== "number" || !/^\d{1,12}$/.test(integer ?? "") || !/^\d{0,6}$/.test(fraction))
    throw new TypeError(`Недопустимое число в поле ${field}.`);
  return BigInt(integer!) * scale + BigInt(fraction.padEnd(6, "0"));
}

function amountString(value: bigint) {
  const moneyScale = scale * scale;
  const fraction = (value % moneyScale).toString().padStart(12, "0").replace(/0+$/, "");
  return (value / moneyScale).toString() + (fraction ? "." + fraction : "");
}

function requiredText(value: string, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 180)
    throw new TypeError(`Недопустимое значение в поле ${field}.`);
  return value.trim();
}

function byId<T>(items: readonly T[], identity: (item: T) => string, field: string) {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = requiredText(identity(item), field);
    if (result.has(id)) throw new TypeError(`Повтор ключа в поле ${field}.`);
    result.set(id, item);
  }
  return result;
}

function csvCell(value: ReportCell) {
  const text = value === null ? "" : String(value);
  // Spreadsheet text protection follows the shared convention in Studio.
  const safe = /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\p{Cc}]*[=+\-@＝＋－＠]/u.test(
    text
  )
    ? "'" + text
    : text;
  return /[,"\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function markdownCell(value: ReportCell) {
  if (value === null) return "—";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\`*_{}[\]<>()#!|~&]/gu, "\\$&");
}

function matchLine(itemId: string, requirement: Requirement, line: OfferLine | undefined) {
  const required = scaled(requirement.quantity, "количество по спецификации");
  if (required === 0n) throw new TypeError("Количество в спецификации должно быть больше нуля.");
  const unit = requiredText(requirement.unit, "единица спецификации");
  const label = requiredText(requirement.label, "позиция");
  const offered = line ? scaled(line.quantity, "количество в предложении") : null;
  const offeredUnit = line ? requiredText(line.unit, "единица предложения") : null;
  const unitPrice = line?.unitPrice == null ? null : scaled(line.unitPrice, "цена за единицу");
  const issues: string[] = [];
  if (!line) issues.push("позиция отсутствует");
  else {
    if (unit !== offeredUnit) issues.push("разные единицы");
    else if (offered! < required) issues.push("недокомплект");
    else if (offered! > required) issues.push("избыток");
    if (unitPrice === null) issues.push("цена не указана");
  }
  return {
    itemId,
    label,
    requiredQuantity: requirement.quantity,
    requiredUnit: unit,
    offeredQuantity: line?.quantity ?? null,
    offeredUnit,
    unitPrice: line?.unitPrice ?? null,
    quoteAmount: offered !== null && unitPrice !== null ? offered * unitPrice : null,
    issues
  };
}

function compareOffer(offer: Offer, requirements: Map<string, Requirement>) {
  const supplier = requiredText(offer.supplier, "поставщик");
  const currency = requiredText(offer.currency, "валюта").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("Укажите трёхбуквенный код валюты.");
  const deliveryDays = offer.deliveryDays ?? null;
  if (deliveryDays !== null && (!Number.isSafeInteger(deliveryDays) || deliveryDays < 0))
    throw new TypeError("Некорректный срок поставки.");
  if (offer.lines.length > 200 || (offer.additionalCosts?.length ?? 0) > 50)
    throw new RangeError("В предложении слишком много позиций или расходов.");
  const lines = byId(offer.lines, (line) => line.itemId, "ID строки поставщика");
  const comparableLines = [...requirements].map(([id, requirement]) =>
    matchLine(id, requirement, lines.get(id))
  );
  const unrequestedItems = [...lines.keys()].filter((id) => !requirements.has(id));
  const charges = offer.additionalCosts ?? null;
  let additionalCostsStatus: AdditionalCostsStatus = "не указаны";
  if (charges) {
    if (charges.length === 0) additionalCostsStatus = "не применяются";
    else if (charges.some((cost) => cost.amount == null))
      additionalCostsStatus = "частично известны";
    else additionalCostsStatus = "указаны";
  }
  let knownCosts = 0n;
  const additionalCosts =
    charges?.map((cost) => {
      const label = requiredText(cost.label, "название расхода");
      if (cost.amount == null) return { label, amount: null };
      const amount = scaled(cost.amount, "дополнительный расход") * scale;
      knownCosts += amount;
      return { label, amount: amountString(amount) };
    }) ?? null;
  let knownLines = 0n;
  for (const line of comparableLines) knownLines += line.quoteAmount ?? 0n;
  const complete = comparableLines.every(
    (line) =>
      line.offeredUnit === line.requiredUnit && line.offeredQuantity === line.requiredQuantity
  );
  const allLinePricesKnown = comparableLines.every((line) => line.quoteAmount !== null);
  const anyPriceKnown =
    comparableLines.some((line) => line.quoteAmount !== null) ||
    (additionalCosts?.some((cost) => cost.amount !== null) ?? false);
  const priceComplete =
    complete &&
    allLinePricesKnown &&
    unrequestedItems.length === 0 &&
    (additionalCostsStatus === "не применяются" || additionalCostsStatus === "указаны");
  return {
    supplier,
    currency,
    deliveryDays,
    additionalCostsStatus,
    additionalCosts,
    unrequestedItems,
    complete,
    knownSubtotal: anyPriceKnown ? amountString(knownLines + knownCosts) : null,
    total: priceComplete ? amountString(knownLines + knownCosts) : null,
    lines: comparableLines.map((line) => ({
      ...line,
      quoteAmount: line.quoteAmount === null ? null : amountString(line.quoteAmount)
    }))
  };
}

/** Align by exact, unique item IDs. Currency and unit conversions require explicit source data. */
export function compareSupplierOffers(
  input: SupplierComparisonInput,
  options?: { separateDelivery: boolean }
) {
  if (
    !input ||
    !Array.isArray(input.requirements) ||
    input.requirements.length < 1 ||
    input.requirements.length > 200 ||
    !Array.isArray(input.offers) ||
    input.offers.length < 2 ||
    input.offers.length > 12
  )
    throw new RangeError("Укажите от 1 до 200 требований и от 2 до 12 предложений.");
  const requirements = byId<Requirement>(input.requirements, (item) => item.itemId, "ID позиции");
  const offers = byId<Offer>(input.offers, (offer) => offer.supplier, "поставщик");
  const rows = [...offers.values()].map((offer) => compareOffer(offer, requirements));
  const headers = [
    "Тип строки",
    "Поставщик",
    "Валюта",
    "Срок в днях",
    "Позиция",
    "Наименование",
    "Требуется",
    "Ед. требования",
    "Предложено",
    "Ед. предложения",
    "Цена за ед.",
    "Известная сумма",
    "Полная сумма",
    "Состояние"
  ];
  const records: ReportCell[][] = [];
  for (const row of rows) {
    records.push([
      "Итог",
      row.supplier,
      row.currency,
      options?.separateDelivery ? null : row.deliveryDays,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      row.knownSubtotal,
      row.total,
      `${row.complete ? "комплектно" : "есть расхождения"}; расходы ${row.additionalCostsStatus}`
    ]);
    if (options?.separateDelivery)
      records.push([
        "Доставка",
        row.supplier,
        row.currency,
        row.deliveryDays,
        null,
        "Срок поставки",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        row.deliveryDays === null ? "срок не указан" : "указано"
      ]);
    for (const line of row.lines)
      records.push([
        "Требование",
        row.supplier,
        row.currency,
        null,
        line.itemId,
        line.label,
        line.requiredQuantity,
        line.requiredUnit,
        line.offeredQuantity,
        line.offeredUnit,
        line.unitPrice,
        line.quoteAmount,
        null,
        line.issues.join("; ") || "сопоставлено"
      ]);
    for (const cost of row.additionalCosts ?? [])
      records.push([
        "Расход",
        row.supplier,
        row.currency,
        null,
        null,
        cost.label,
        null,
        null,
        null,
        null,
        null,
        cost.amount,
        null,
        cost.amount === null ? "сумма не указана" : "указано"
      ]);
    for (const id of row.unrequestedItems)
      records.push([
        "Вне спецификации",
        row.supplier,
        row.currency,
        null,
        id,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "условия по позиции требуют уточнения"
      ]);
  }
  validateDataTable({
    delimiter: ",",
    headers,
    rows: records.map((record) => record.map((cell) => String(cell ?? "")))
  });
  const csv =
    [headers, ...records].map((record) => record.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const markdown =
    [
      "# Сравнение предложений поставщиков",
      "",
      "Суммы указаны в валютах поставщиков. Известная сумма включает цены сопоставленных по ID строк предложения и указанные расходы. Полная сумма доступна при точном комплекте и известных расходах.",
      "",
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...records.map((record) => `| ${record.map(markdownCell).join(" | ")} |`)
    ].join("\n") + "\n";
  return { format: "kosmora.supplier-offer-comparison.v1" as const, rows, csv, markdown };
}

export type SupplierComparisonResult = ReturnType<typeof compareSupplierOffers>;
