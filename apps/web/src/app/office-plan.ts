import type { OfficeOperation } from "@cosmora/contracts";
import {
  officeCellValue,
  officeRangeOperation,
  validateOfficePlan,
  type RangeType
} from "./office-range";
export type OfficeCellDraft = { type: RangeType; text: string };
export function officeCellDraft(
  value: Extract<OfficeOperation, { kind: "set_cell" }>["value"]
): OfficeCellDraft {
  if (value === null) return { type: "null", text: "" };
  if (typeof value === "object") return { type: "formula", text: value.formula };
  return { type: typeof value as "string" | "number" | "boolean", text: String(value) };
}
export function editedOfficeRange(
  target: string,
  start: string,
  cells: OfficeCellDraft[][]
): Extract<OfficeOperation, { kind: "set_range" }> {
  const checked = officeRangeOperation(
    target,
    start,
    cells.map((row) => row.map((cell) => (cell.type === "null" ? "" : cell.text))),
    (cells[0] ?? []).map(() => "string")
  );
  return {
    ...checked,
    rows: cells.map((row) => row.map((cell) => officeCellValue(cell.text, cell.type)))
  };
}
export function validateEditableOfficePlan(
  operations: OfficeOperation[],
  existingSheets: number
): void {
  validateOfficePlan(operations);
  let sheets = existingSheets;
  const names = new Set<string>();
  for (const op of operations) {
    if (op.kind === "add_sheet") {
      if (
        !op.name.trim() ||
        op.name.length > 31 ||
        ["\\", "/", ":", "*", "?", "[", "]"].some((symbol) => op.name.includes(symbol)) ||
        names.has(op.name.toLowerCase())
      )
        throw Error("Название нового листа пустое, повторяется или содержит недопустимые символы.");
      names.add(op.name.toLowerCase());
      sheets++;
    } else if (op.kind === "set_cell" || op.kind === "set_range") {
      if (!/^sheet:[1-9][0-9]{0,2}$/.test(op.target) || Number(op.target.slice(6)) > sheets)
        throw Error("Лист для правки должен существовать или быть добавлен раньше в этом плане.");
      if (op.kind === "set_cell") officeRangeOperation(op.target, op.address, [[""]], ["string"]);
    } else if (
      !op.target ||
      op.target.length > 120 ||
      !op.find ||
      op.find.length > 4000 ||
      op.replace.length > 4000
    ) {
      throw Error(
        "Для замены нужны адрес и искомый текст; длина текста ограничена 4000 символами."
      );
    }
  }
}
export function replaceOfficeOperation(
  operations: OfficeOperation[],
  index: number,
  replacement: OfficeOperation,
  existingSheets: number
): OfficeOperation[] {
  if (!operations[index] || operations[index].kind !== replacement.kind)
    throw Error("Правка изменилась. Откройте её снова.");
  const next = operations.map((op, i) => structuredClone(i === index ? replacement : op));
  validateEditableOfficePlan(next, existingSheets);
  return next;
}
export function removeOfficeOperation(
  operations: OfficeOperation[],
  index: number,
  existingSheets: number
): OfficeOperation[] {
  const removed = operations[index];
  if (!removed) throw Error("Правка уже удалена.");
  validateEditableOfficePlan(operations, existingSheets);
  const deletedSheet =
    existingSheets + operations.slice(0, index + 1).filter((op) => op.kind === "add_sheet").length;
  if (
    removed.kind === "add_sheet" &&
    operations.some(
      (op) =>
        (op.kind === "set_cell" || op.kind === "set_range") && op.target === `sheet:${deletedSheet}`
    )
  )
    throw Error("На этот новый лист ссылаются другие правки. Сначала удалите или перенесите их.");
  const next = operations
    .filter((_, i) => i !== index)
    .map((op) => {
      const copy = structuredClone(op);
      if (
        removed.kind === "add_sheet" &&
        (copy.kind === "set_cell" || copy.kind === "set_range") &&
        Number(copy.target.slice(6)) > deletedSheet
      )
        copy.target = `sheet:${Number(copy.target.slice(6)) - 1}`;
      return copy;
    });
  validateEditableOfficePlan(next, existingSheets);
  return next;
}
export function officeTargetAfterRemoval(
  operations: OfficeOperation[],
  index: number,
  existingSheets: number,
  target: string
): string {
  if (operations[index]?.kind !== "add_sheet" || !/^sheet:[1-9][0-9]{0,2}$/.test(target))
    return target;
  const deleted =
    existingSheets + operations.slice(0, index + 1).filter((op) => op.kind === "add_sheet").length;
  const selected = Number(target.slice(6));
  if (selected > deleted) return `sheet:${selected - 1}`;
  if (selected === deleted)
    return existingSheets + operations.filter((op) => op.kind === "add_sheet").length > 1
      ? "sheet:1"
      : "";
  return target;
}
