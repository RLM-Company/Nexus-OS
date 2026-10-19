import { expect, it } from "vitest";
import { compareRevisions, type RevisionContent } from "./revision-diff";
const source = (): RevisionContent => ({
  title: "Доклад",
  theme: "paper",
  slides: [
    {
      id: "a",
      layout: "content",
      title: "Одинаково",
      body: "a\r\n",
      aside: " скрыто ",
      notes: "note"
    },
    { id: "b", layout: "content", title: "Одинаково", body: "b", aside: "", notes: "" }
  ]
});
it("matches duplicate titles by stable identity and reports order separately from text", () => {
  const before = source();
  const after = { ...before, slides: [...before.slides].reverse() };
  expect(compareRevisions(before, after).map((c) => [c.before, c.after])).toEqual([
    ["2", "1"],
    ["1", "2"]
  ]);
});
it("reports added and removed slides with their full notes and hidden text", () => {
  const before = source();
  const after = { ...before, slides: [{ ...before.slides[0]!, id: "new" }, before.slides[1]!] };
  const changes = compareRevisions(before, after);
  expect(changes).toHaveLength(2);
  expect(changes[0]!.before).toContain('"notes": "note"');
  expect(changes[1]!.after).toContain('"aside": " скрыто "');
});
it("compares all editable fields literally including CRLF and whitespace", () => {
  const before = source();
  const after: RevisionContent = {
    ...before,
    title: "доклад",
    theme: "night",
    slides: [
      {
        ...before.slides[0]!,
        layout: "quote",
        title: "Title",
        body: "a\n",
        aside: "скрыто",
        notes: "note "
      },
      before.slides[1]!
    ]
  };
  const changes = compareRevisions(before, after);
  expect(changes).toHaveLength(7);
  expect(changes.find((c) => c.label.includes("Основной текст"))).toMatchObject({
    before: "a\r\n",
    after: "a\n"
  });
  expect(compareRevisions(before, structuredClone(before))).toEqual([]);
});
