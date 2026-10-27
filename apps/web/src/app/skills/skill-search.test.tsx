import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  findSkillText,
  replaceSkillText,
  SKILL_MATCH_LIMIT,
  type SkillSearchOptions
} from "./skill-search";
import { SkillSearchPanel } from "./skill-search-panel";
const draft = {
  name: "Skill тест",
  summary: "ТЕСТ тест",
  instructions: "😀тест\r\nтест $& .* <script>"
};
const options: SkillSearchOptions = { query: "тест", caseSensitive: false, field: "all" };
it("finds literal matches across specified fields with Cyrillic, exact offsets and CRLF", () => {
  const found = findSkillText(draft, options);
  expect(found.limited).toBe(false);
  expect(found.matches).toHaveLength(5);
  expect(found.matches[3]).toEqual({ field: "instructions", start: 2, end: 6 });
  expect(findSkillText(draft, { ...options, caseSensitive: true }).matches).toHaveLength(4);
  expect(findSkillText(draft, { ...options, field: "name" }).matches).toHaveLength(1);
  expect(findSkillText(draft, { ...options, query: ".*" }).matches).toHaveLength(1);
  expect(findSkillText(draft, { ...options, query: "" }).matches).toEqual([]);
});
it("replaces one or every original match literally, preserving other fields and line endings", () => {
  const all = replaceSkillText(draft, options, "$&\\literal");
  expect(all).toEqual({
    name: "Skill $&\\literal",
    summary: "$&\\literal $&\\literal",
    instructions: "😀$&\\literal\r\n$&\\literal $& .* <script>"
  });
  expect(draft.instructions).toBe("😀тест\r\nтест $& .* <script>");
  expect(replaceSkillText(draft, options, "ONE", 3).instructions).toBe(
    "😀ONE\r\nтест $& .* <script>"
  );
  expect(replaceSkillText(draft, options, "ONE", 99)).toBe(draft);
});
it("preserves edge whitespace and allows locally empty fields without normalizing unrelated text", () => {
  const value = { name: " A ", summary: "", instructions: "x" };
  expect(replaceSkillText(value, { ...options, query: "x" }, "")).toEqual({
    ...value,
    instructions: ""
  });
});
it("handles repeated and overlapping literal candidates once per original nonoverlapping match", () => {
  const value = { name: "a", summary: "b", instructions: "aaaa" };
  expect(
    replaceSkillText(value, { ...options, field: "instructions", query: "aa" }, "a").instructions
  ).toBe("aa");
  expect(
    replaceSkillText(value, { ...options, field: "instructions", query: "aa" }, "aaaa").instructions
  ).toBe("aaaaaaaa");
});
it.each(["name", "summary", "instructions"] as const)(
  "rejects final %s overflow before modifying the draft",
  (field) => {
    const value = { name: "x", summary: "x", instructions: "x" };
    const length = field === "name" ? 80 : field === "summary" ? 240 : 20_000;
    value[field] = "x".repeat(length);
    expect(() =>
      replaceSkillText(value, { query: value[field], field, caseSensitive: true }, "y".repeat(4001))
    ).toThrow("4000");
    // A short query would overflow the full result; nothing is partially applied.
    if (field === "instructions") value[field] = "word".repeat(5000);
    expect(() =>
      replaceSkillText(
        value,
        { query: field === "instructions" ? "word" : "x", field, caseSensitive: true },
        field === "instructions" ? "words" : "xx"
      )
    ).toThrow("превышает");
    expect(value[field].length).toBe(length);
  }
);
it("bounds huge match sets, rejecting replacement until the search is narrowed", () => {
  const value = { name: "x", summary: "b", instructions: "x".repeat(6000) };
  expect(findSkillText(value, { ...options, query: "x" })).toMatchObject({ limited: true });
  expect(findSkillText(value, { ...options, query: "x" }).matches).toHaveLength(SKILL_MATCH_LIMIT);
  expect(() => replaceSkillText(value, { ...options, query: "x" }, "z")).toThrow("Слишком много");
  expect(findSkillText(value, { ...options, query: "x".repeat(4001) }).matches).toEqual([]);
});
it("rejects control characters, treats replacement text as literal HTML and handles no-op queries", () => {
  expect(() => replaceSkillText(draft, options, "\u0000")).toThrow("управляющие");
  expect(replaceSkillText(draft, { ...options, query: "absent" }, "text")).toBe(draft);
  expect(replaceSkillText(draft, options, "<img onerror=alert(1)> ").name).toBe(
    "Skill <img onerror=alert(1)> "
  );
  const html = renderToStaticMarkup(
    <SkillSearchPanel draft={draft} epoch={0} busy={false} onSelect={() => {}} onApply={() => {}} />
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain("Поиск и замена в Skill");
});
