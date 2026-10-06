import { describe, expect, it } from "vitest";
import { numericStats, parseCsv, serializeCsvSelection } from "./studio-csv";

describe("local CSV boundaries", () => {
  it.each([",", ";", "\t", "|"])("reads quoted multiline records with %j", (delimiter) => {
    const table = parseCsv(
      `\ufeffname${delimiter}note\r\nAlice${delimiter}"line one\nline two with ""quotes"""`
    );
    expect(table.delimiter).toBe(delimiter);
    expect(table.rows).toEqual([["Alice", 'line one\nline two with "quotes"']]);
  });

  it("retains 200,000 short rows without argument-count overflow", () => {
    const table = parseCsv("id,value\n" + "1,x\n".repeat(200_000));
    expect(table.headers).toEqual(["id", "value"]);
    expect(table.rows).toHaveLength(200_000);
    expect(table.rows.at(-1)).toEqual(["1", "x"]);
  });

  it("rejects excessive padding of short records before allocating a huge table", () => {
    const text =
      Array.from({ length: 250 }, (_, index) => `c${index}`).join(",") + "\nx\n".repeat(8_001);
    expect(text.length).toBeLessThan(2_000_000);
    expect(() => parseCsv(text)).toThrow("2 млн ячеек");
  });

  it("preserves empty records and counts only the bounded current filter", () => {
    const table = parseCsv("name;score\nAlice;10\n;\nБоб;20,5\nZoë;bad");
    expect(table.rows).toHaveLength(4);
    expect(numericStats(table.rows, 1, 2, [2, 3, 0])).toEqual({
      count: 1,
      invalid: 1,
      empty: 0,
      scanned: 2,
      limited: true,
      min: 20.5,
      max: 20.5,
      mean: 20.5
    });
  });

  it("rejects malformed quotes and reports oversized selections explicitly", () => {
    expect(() => parseCsv('name,note\nAlice,"ok"oops')).toThrow();
    expect(
      serializeCsvSelection(
        { delimiter: ",", headers: ["a".repeat(7_001)], rows: [["x"]] },
        [0],
        [0]
      ).blocked
    ).toBe("header");
    expect(
      serializeCsvSelection(
        { delimiter: ",", headers: ["name"], rows: [["x".repeat(7_001)]] },
        [0],
        [0]
      ).blocked
    ).toBe("row");
  });
});
