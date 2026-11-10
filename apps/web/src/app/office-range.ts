import type { OfficeOperation } from "@cosmora/contracts";
import { parseWithDelimiter } from "./studio-csv";

export const rangeTypes = ["string", "number", "boolean", "formula", "null"] as const;
export type RangeType = (typeof rangeTypes)[number];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function parseOfficeRange(text: string): string[][] {
  if (new TextEncoder().encode(text).length > 16000)
    throw Error("Таблица больше 16 000 байт. Разделите её на меньшие диапазоны.");
  const rows = parseWithDelimiter(text, "\t");
  if (!rows.length || rows.length > 10 || !rows[0]?.length || rows[0].length > 10)
    throw Error("Диапазон должен содержать от 1 до 10 строк и столбцов.");
  if (rows.some((row) => row.length !== rows[0]!.length))
    throw Error("В строках разное число ячеек. Ничего не добавлено и не обрезано.");
  return rows;
}

// Compare decimal values as written to their JSON number representation. This
// rejects rounding/underflow without rejecting ordinary 0.1 or notation 1e3.
function decimalKey(raw: string): string {
  const [mantissa = "", exponent = "0"] = raw.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = unsigned.split(".");
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - significant.length);
  return `${negative ? "-" : ""}${significant}e${power}`;
}

export function officeCellValue(raw: string, type: RangeType) {
  if (type === "null") return null;
  if (raw.length > 500) throw Error("В ячейке больше 500 символов.");
  if (type === "string") return raw;
  const trimmed = raw.trim();
  if (type === "boolean") {
    if (!/^(true|false)$/.test(trimmed)) throw Error("Для логического типа нужны true или false.");
    return trimmed === "true";
  }
  if (type === "formula") {
    const formula = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
    if (!formula || formula.length > 256) throw Error("Формула должна содержать 1–256 символов.");
    return { formula };
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))
    throw Error("Для числа используйте 19700 или 19700.5. Пробелы и единицы сохраняйте текстом.");
  const number = Number(trimmed);
  if (
    !Number.isFinite(number) ||
    Object.is(number, -0) ||
    (number !== 0 && Math.abs(number) < 2.2250738585072014e-308) ||
    decimalKey(trimmed).split("e")[0]!.replace("-", "").length > 15 ||
    decimalKey(trimmed) !== decimalKey(String(number))
  )
    throw Error("Число нельзя сохранить без округления. Выберите текст для точного значения.");
  return number;
}

export function officeRangeOperation(
  target: string,
  start: string,
  rows: string[][],
  types: RangeType[]
): Extract<OfficeOperation, { kind: "set_range" }> {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,5})$/.exec(start);
  const width = rows[0]?.length ?? 0;
  if (
    !/^sheet:[1-9][0-9]{0,2}$/.test(target) ||
    !match ||
    !rows.length ||
    rows.length > 10 ||
    !width ||
    width > 10 ||
    types.length !== width ||
    rows.some((row) => row.length !== width)
  )
    throw Error("Выберите лист, начальную ячейку и прямоугольную таблицу до 10 × 10.");
  const column = [...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (column + width - 1 > 16384 || Number(match[2]) + rows.length - 1 > 999999)
    throw Error("Диапазон выходит за поддерживаемые адреса ячеек.");
  const operation = {
    kind: "set_range" as const,
    target,
    start,
    rows: rows.map((row, r) =>
      row.map((raw, c) => {
        try {
          return officeCellValue(raw, types[c]!);
        } catch (error) {
          throw Error(
            `Строка ${r + 1}, столбец ${c + 1}: ${error instanceof Error ? error.message : "неверное значение"}`,
            { cause: error }
          );
        }
      })
    )
  };
  validateOfficePlan([operation]);
  return operation;
}

export function validateOfficePlan(operations: OfficeOperation[]): void {
  const cells = operations.reduce(
    (n, op) =>
      n + (op.kind === "set_range" ? op.rows.reduce((sum, row) => sum + row.length, 0) : 1),
    0
  );
  if (operations.length > 40 || cells > 100 || bytes(operations) > 16000)
    throw Error(
      "План превышает 40 операций, 100 изменений или 16 000 байт. Разделите его; ничего не обрезано."
    );
}
