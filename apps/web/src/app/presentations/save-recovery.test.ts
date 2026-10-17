import { expect, it } from "vitest";
import { matchesSavedDraft, savePresentation } from "./save-recovery";
import type { api } from "./client";
import type { Deck } from "./model";
const draft: Deck = {
  id: "d",
  title: " Title ",
  theme: "paper",
  slides: [
    { id: "s", layout: "content", title: "", body: "😀\r\n", aside: "", notes: "secret notes" }
  ],
  slide_count: 1,
  version: 3,
  created_at: "first",
  updated_at: "old"
};
const stored: Deck = { ...draft, title: "Title", version: 4, updated_at: "new" };
it("accepts only exact successor content, including notes and CRLF", () => {
  expect(matchesSavedDraft(draft, stored)).toBe(true);
  for (const changed of [
    { ...stored, id: "other" },
    { ...stored, version: 3 },
    { ...stored, version: 5 },
    { ...stored, slides: [{ ...stored.slides[0]!, notes: "other" }] },
    { ...stored, slides: [{ ...stored.slides[0]!, body: "😀\n" }] }
  ])
    expect(matchesSavedDraft(draft, changed)).toBe(false);
});
it("recovers a lost write response by reading once without a second PUT", async () => {
  const calls: string[] = [];
  const request: typeof api = async <T>(_url: string, options?: RequestInit): Promise<T> => {
    await Promise.resolve();
    calls.push(options?.method ?? "GET");
    if (options?.method === "PUT") throw Error("lost response");
    return stored as T;
  };
  expect(await savePresentation(draft, request)).toBe(stored);
  expect(calls).toEqual(["PUT", "GET"]);
});
it("preserves the original error and local data when readback differs or fails", async () => {
  const original = Error("CONFLICT");
  const before = JSON.stringify(draft);
  for (const failRead of [false, true]) {
    const request: typeof api = async <T>(_url: string, options?: RequestInit): Promise<T> => {
      await Promise.resolve();
      if (options?.method === "PUT") throw original;
      if (failRead) throw Error("offline");
      return { ...stored, version: 5 } as T;
    };
    await expect(savePresentation(draft, request)).rejects.toBe(original);
  }
  expect(JSON.stringify(draft)).toBe(before);
});
