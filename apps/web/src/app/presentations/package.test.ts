import { describe, expect, it } from "vitest";
import { parsePresentationPackage, presentationPackage } from "./package";
import type { Deck } from "./model";

const deck: Deck = {
  id: "original",
  title: "Доклад",
  theme: "paper",
  slide_count: 1,
  version: 9,
  created_at: "2026-10-01",
  updated_at: "2026-10-14",
  slides: [
    {
      id: "first",
      layout: "two-column",
      title: "<script> & текст",
      body: "左\nСлева",
      aside: "Right",
      notes: "Только докладчику"
    }
  ]
};
describe("portable presentation package", () => {
  it("round trips text and notes without transferring storage identity; also reads previous raw exports", () => {
    const portable = presentationPackage(deck);
    expect(portable).not.toHaveProperty("id");
    expect(portable).not.toHaveProperty("version");
    expect(parsePresentationPackage(JSON.stringify(portable))).toEqual(portable);
    expect(parsePresentationPackage("\uFEFF" + JSON.stringify(deck))).toEqual(portable);
    expect(portable.slides[0]?.title).toBe("<script> & текст");
    expect(portable.slides[0]?.notes).toBe("Только докладчику");
  });
  it("rejects malformed, oversized and foreign-format files before network activity", () => {
    const portable = presentationPackage(deck);
    for (const input of [
      "{",
      "[]",
      JSON.stringify({ ...portable, format: "other" }),
      JSON.stringify({ ...portable, owner_id: "other" }),
      JSON.stringify({ ...portable, slides: [...portable.slides, ...portable.slides] }),
      JSON.stringify({
        ...portable,
        slides: [{ ...portable.slides[0], layout: "remote", url: "https://evil.example" }]
      }),
      JSON.stringify({ ...portable, slides: [{ ...portable.slides[0], notes: "bad\u0001xml" }] }),
      JSON.stringify({ ...portable, slides: [{ ...portable.slides[0], body: "bad\ud800xml" }] }),
      " ".repeat(350001)
    ])
      expect(() => parsePresentationPackage(input)).toThrow();
  });
});
