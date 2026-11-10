import { describe, expect, it } from "vitest";
import {
  officeCellValue,
  officeRangeOperation,
  parseOfficeRange,
  validateOfficePlan
} from "./office-range";

describe("Office range input", () => {
  it("preserves the first row, zeros, conditions, quotes and multiline clipboard fields", () => {
    expect(
      parseOfficeRange(
        '00123\t19 700\t"кроме доставки\nусловие обязательно"\r\n00456\t-12.5\t"не менять ""дату"""\r\n'
      )
    ).toEqual([
      ["00123", "19 700", "кроме доставки\nусловие обязательно"],
      ["00456", "-12.5", 'не менять "дату"']
    ]);
    expect(officeCellValue("=SUM(A1:A2)", "string")).toBe("=SUM(A1:A2)");
  });
  it("rejects ragged, oversized, malformed and overflowing ranges without padding or truncation", () => {
    for (const text of [
      "",
      "a\tb\nc",
      "x\n".repeat(11),
      Array(11).fill("x").join("\t"),
      '"unterminated',
      "я".repeat(8001)
    ])
      expect(() => parseOfficeRange(text)).toThrow();
    expect(() =>
      officeRangeOperation("sheet:1", "XFD1", [["x", "y"]], ["string", "string"])
    ).toThrow(/адреса/);
    expect(() => officeRangeOperation("sheet:1", "A999999", [["x"], ["y"]], ["string"])).toThrow(
      /адреса/
    );
    expect(() => officeRangeOperation("sheet:1", "A1", [["x".repeat(501)]], ["string"])).toThrow(
      /500/
    );
  });
  it("builds explicit mixed types; formulas are declarations and clearing is deliberate", () => {
    expect(
      officeRangeOperation(
        "sheet:2",
        "A2",
        [["00123", "19700", "true", "=SUM(B2:B2)", "old"]],
        ["string", "number", "boolean", "formula", "null"]
      ).rows
    ).toEqual([["00123", 19700, true, { formula: "SUM(B2:B2)" }, null]]);
    expect(() => officeCellValue("yes", "boolean")).toThrow(/true/);
  });
  it("refuses rounding, underflow and ambiguous numbers instead of silently changing them", () => {
    for (const raw of [
      "9007199254740993",
      "9007199254740992",
      "5e-324",
      "-0",
      "0.10000000000000001",
      "1e-500",
      "1e500",
      "19 700",
      "19,7",
      "0x10",
      "",
      "12 ₽"
    ])
      expect(() => officeCellValue(raw, "number")).toThrow();
    for (const raw of ["0.1", "19700", "-12.50", "+1e3", "0.000001", "1.2300"])
      expect(officeCellValue(raw, "number")).toBe(Number(raw));
    expect(officeCellValue("9007199254740993", "string")).toBe("9007199254740993");
  });
  it("applies the shared operation, expanded-cell and serialized byte budgets", () => {
    const cell = { kind: "set_cell" as const, target: "sheet:1", address: "A1", value: "x" };
    expect(() => validateOfficePlan(Array.from({ length: 40 }, () => cell))).not.toThrow();
    expect(() => validateOfficePlan(Array.from({ length: 41 }, () => cell))).toThrow(/40/);
    const range = officeRangeOperation(
      "sheet:1",
      "A1",
      Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => "x")),
      Array.from({ length: 10 }, () => "string" as const)
    );
    expect(() => validateOfficePlan([range, cell])).toThrow(/100/);
    expect(() =>
      validateOfficePlan(Array.from({ length: 20 }, () => ({ ...cell, value: "я".repeat(500) })))
    ).toThrow(/16 000/);
  });
});
