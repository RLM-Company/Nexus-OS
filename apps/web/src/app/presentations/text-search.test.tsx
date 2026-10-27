import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findText, MATCH_LIMIT, replaceText, type SearchOptions } from "./text-search";
import { PresentationSearch } from "./presentation-search";
import type { Deck } from "./model";
const deck = (body = "Байкал и байкал"): Deck => ({
  id: "deck",
  title: "Байкал",
  theme: "paper",
  slides: [
    { id: "s1", layout: "content", title: "", body, aside: "байкал", notes: "байкал" },
    { id: "s2", layout: "content", title: "байкал", body: "", aside: "", notes: "" }
  ],
  slide_count: 2,
  version: 4,
  created_at: "initial",
  updated_at: "saved"
});
const options: SearchOptions = {
  query: "байкал",
  caseSensitive: false,
  includeNotes: false,
  slide: null
};
describe("presentation literal search and atomic replace", () => {
  it("finds Cyrillic in source order, including hidden columns, and explicitly opts into notes", () => {
    const found = findText(deck(), options);
    expect(found.matches.map(({ slide, field }) => [slide, field])).toEqual([
      [0, "body"],
      [0, "body"],
      [0, "aside"],
      [1, "title"]
    ]);
    expect(findText(deck(), { ...options, includeNotes: true }).matches).toHaveLength(5);
    expect(findText(deck(), { ...options, caseSensitive: true, slide: 0 }).matches).toHaveLength(2);
  });
  it("treats regex metacharacters and replacement dollars literally", () => {
    const source = deck("a.*[x] a.*[x]");
    const result = replaceText(source, { ...options, query: "a.*[x]" }, "$& $1 <b>");
    expect(result.slides[0]!.body).toBe("$& $1 <b> $& $1 <b>");
    expect(source.slides[0]!.body).toBe("a.*[x] a.*[x]");
    expect(result.version).toBe(4);
    expect(result.title).toBe("Байкал");
  });
  it("preserves CRLF, emoji offsets and whitespace outside matches", () => {
    const source = deck("😀\r\nБайкал\tБАЙКАЛ ");
    const found = findText(source, { ...options, slide: 0 });
    expect(found.matches[0]).toMatchObject({ start: 4, end: 10 });
    expect(replaceText(source, { ...options, slide: 0 }, "湖").slides[0]!.body).toBe(
      "😀\r\n湖\t湖 "
    );
  });
  it("replaces only the chosen occurrence or deletes matches without overlap", () => {
    expect(replaceText(deck(), options, "озеро", 1).slides[0]!.body).toBe("Байкал и озеро");
    expect(
      replaceText(deck("aaaaa"), { ...options, query: "aa", slide: 0 }, "").slides[0]!.body
    ).toBe("a");
    expect(findText(deck(), { ...options, query: "" }).matches).toEqual([]);
  });
  it("rejects overflowing titles and invalid control characters without partial edits", () => {
    const source = deck();
    const before = JSON.stringify(source);
    expect(() => replaceText(source, options, "x".repeat(181))).toThrow(/длину/);
    expect(() => replaceText(source, options, "\u0000")).toThrow();
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects aggregate byte limits before returning an edited deck", () => {
    const source = deck("a");
    source.slides = Array.from({ length: 50 }, (_, i) => ({
      ...source.slides[0]!,
      id: `s${i}`,
      title: "",
      body: "a",
      aside: "a",
      notes: "a"
    }));
    expect(() =>
      replaceText(source, { ...options, query: "a", includeNotes: true }, "界".repeat(2000))
    ).toThrow();
  });
  it("caps match collection and refuses incomplete bulk replacements", () => {
    const source = deck("a".repeat(4000));
    source.slides = Array.from({ length: 4 }, (_, i) => ({ ...source.slides[0]!, id: `s${i}` }));
    const query = { ...options, query: "a" };
    expect(findText(source, query).limited).toBe(true);
    expect(findText(source, query).matches).toHaveLength(MATCH_LIMIT);
    expect(() => replaceText(source, query, "b")).toThrow(/много/);
  });
  it("renders accessible controls without injecting slide markup", () => {
    const html = renderToStaticMarkup(
      <PresentationSearch
        deck={deck("<script>alert(1)</script>")}
        selected={0}
        busy={false}
        onSelect={() => {}}
        onReplace={() => {}}
      />
    );
    expect(html).toContain("Поиск и замена");
    expect(html).not.toContain("<script>");
    expect(html).toContain("disabled");
  });
});
