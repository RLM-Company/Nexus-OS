import { describe, it, expect } from "vitest";
import { MAX_SEARCH_MATCHES, searchText, replaceMatches } from "./text-search";
describe("literal Canvas search and replace", () => {
  it("matches Unicode and mixed case with original UTF-16 offsets", () => {
    const text = "😀 Орбита\r\nорбита";
    const result = searchText(text, "орбита");
    expect(result.matches.map((m) => text.slice(m.start, m.end))).toEqual(["Орбита", "орбита"]);
    expect(searchText(text, "орбита", true).matches).toHaveLength(1);
    expect(replaceMatches(text, result.matches, "$&\\1")).toBe("😀 $&\\1\r\n$&\\1");
  });
  it("escapes regex metacharacters and treats replacements literally", () => {
    const text = "[a].* [a].*";
    expect(replaceMatches(text, searchText(text, "[a].*").matches, "$1")).toBe("$1 $1");
    expect(searchText(text, "").matches).toEqual([]);
    expect(replaceMatches(text, [], "x")).toBe(text);
  });
  it("reports the search cap and refuses invalid overlapping offsets", () => {
    const result = searchText("x".repeat(MAX_SEARCH_MATCHES + 1), "x");
    expect(result.capped).toBe(true);
    expect(result.matches).toHaveLength(MAX_SEARCH_MATCHES);
    expect(searchText("x".repeat(MAX_SEARCH_MATCHES), "x").capped).toBe(false);
    expect(() =>
      replaceMatches(
        "abc",
        [
          { start: 0, end: 2 },
          { start: 1, end: 3 }
        ],
        "x"
      )
    ).toThrow();
  });
});
