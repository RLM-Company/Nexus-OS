import { describe, expect, it } from "vitest";
import type { OfficeOperation } from "@cosmora/contracts";
import {
  editedOfficeRange,
  officeCellDraft,
  officeTargetAfterRemoval,
  removeOfficeOperation,
  replaceOfficeOperation,
  validateEditableOfficePlan
} from "./office-plan";
const cell = (target: string): OfficeOperation => ({
  kind: "set_cell",
  target,
  address: "A1",
  value: "00123"
});
describe("Office plan changes", () => {
  it("removes only the selected edit and keeps independent copies of other operations", () => {
    const original: OfficeOperation[] = [
      cell("sheet:1"),
      { kind: "set_range", target: "sheet:1", start: "B1", rows: [[{ formula: "SUM(A1:A1)" }]] }
    ];
    const before = structuredClone(original);
    const result = removeOfficeOperation(original, 0, 1);
    expect(result).toEqual([before[1]]);
    if (result[0]?.kind === "set_range") result[0].rows[0]![0] = "changed";
    expect(original).toEqual(before);
  });
  it("refuses deleting a sheet with dependent cells/ranges without changing the original plan", () => {
    const plan: OfficeOperation[] = [{ kind: "add_sheet", name: "Итог" }, cell("sheet:2")];
    expect(() => removeOfficeOperation(plan, 0, 1)).toThrow(/ссылаются/);
    expect(plan[1]).toEqual(cell("sheet:2"));
  });
  it("rebases later new-sheet references when an earlier unused new sheet is removed", () => {
    const plan: OfficeOperation[] = [
      { kind: "add_sheet", name: "Лишний" },
      { kind: "add_sheet", name: "Итог" },
      cell("sheet:3"),
      cell("sheet:1")
    ];
    const result = removeOfficeOperation(plan, 0, 1);
    expect(result).toEqual([{ kind: "add_sheet", name: "Итог" }, cell("sheet:2"), cell("sheet:1")]);
    expect(plan[2]).toEqual(cell("sheet:3"));
    expect(officeTargetAfterRemoval(plan, 0, 1, "sheet:3")).toBe("sheet:2");
    expect(officeTargetAfterRemoval(plan, 0, 1, "sheet:2")).toBe("sheet:1");
  });
  it("renames a new sheet without changing its references and refuses invalid dependencies/names", () => {
    const plan: OfficeOperation[] = [{ kind: "add_sheet", name: "Итог" }, cell("sheet:2")];
    expect(
      replaceOfficeOperation(plan, 0, { kind: "add_sheet", name: "Новый итог" }, 1)[1]
    ).toEqual(plan[1]);
    expect(() => validateEditableOfficePlan([cell("sheet:2"), plan[0]!], 1)).toThrow(/раньше/);
    expect(() =>
      validateEditableOfficePlan(
        [
          { kind: "add_sheet", name: "Итог" },
          { kind: "add_sheet", name: "итог" }
        ],
        1
      )
    ).toThrow(/повторяется/);
    expect(() => replaceOfficeOperation(plan, 0, { kind: "add_sheet", name: "" }, 1)).toThrow(
      /пустое/
    );
  });
  it("round-trips mixed range values losslessly and edits one cell without changing the others", () => {
    const values = [
      ["00123", 19700, true, { formula: "SUM(B1:B1)" }, null, "кроме доставки\nобязательно"]
    ];
    const draft = values.map((row) => row.map(officeCellDraft));
    expect(editedOfficeRange("sheet:1", "A1", draft).rows).toEqual(values);
    draft[0]![1]!.text = "19800";
    const changed = editedOfficeRange("sheet:1", "A1", draft);
    expect(changed.rows).toEqual([
      ["00123", 19800, true, { formula: "SUM(B1:B1)" }, null, "кроме доставки\nобязательно"]
    ]);
    expect(values[0]![1]).toBe(19700);
  });
  it("refuses invalid text, addresses, numeric rounding and kind changes before saving a draft", () => {
    expect(() =>
      validateEditableOfficePlan(
        [{ kind: "replace_text", target: "paragraph:1", find: "", replace: "x" }],
        0
      )
    ).toThrow(/искомый/);
    expect(() =>
      validateEditableOfficePlan(
        [{ kind: "set_cell", target: "sheet:1", address: "XFE1", value: "x" }],
        1
      )
    ).toThrow(/адреса/);
    expect(() =>
      editedOfficeRange("sheet:1", "A1", [[{ type: "number", text: "9007199254740993" }]])
    ).toThrow(/округления/);
    expect(() =>
      replaceOfficeOperation([cell("sheet:1")], 0, { kind: "add_sheet", name: "Other" }, 1)
    ).toThrow(/изменилась/);
  });
});
