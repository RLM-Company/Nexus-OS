import { describe, expect, it } from "vitest";
import {
  answerClarification,
  clarificationDraft,
  clarificationStorageKey,
  clarificationWaiting,
  clearClarificationCard,
  createClarificationCard,
  readClarificationCard,
  saveClarificationCard,
  selectOption,
  setFreeText,
  skipClarification
} from "./clarification-card-state";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const input = {
  id: "q-1",
  taskScope: "project-a",
  question: "Какой формат отчёта нужен?",
  options: ["PDF", "DOCX", "XLSX"],
  required: false
};

describe("Koswork clarification card state", () => {
  it("creates one numbered question with bounded, trimmed options", () => {
    const card = createClarificationCard({ ...input, options: [" PDF ", "DOCX"] });
    expect(card.question).toBe("Какой формат отчёта нужен?");
    expect(card.options).toEqual([
      { number: 1, label: "PDF" },
      { number: 2, label: "DOCX" }
    ]);
    expect(card.status).toBe("pending");
    expect(clarificationWaiting(card)).toBe(false);
    expect(() => createClarificationCard({ ...input, options: [] })).toThrow();
    expect(() => createClarificationCard({ ...input, question: " " })).toThrow();
    expect(() =>
      createClarificationCard({ ...input, options: Array.from({ length: 10 }, () => "x") })
    ).toThrow();
  });

  it("survives reload in the same task scope only", () => {
    const storage = new MemoryStorage();
    const card = selectOption(createClarificationCard(input), 2);
    saveClarificationCard(storage, card);
    expect(storage.values.has(clarificationStorageKey("project-a"))).toBe(true);
    const restored = readClarificationCard(storage, "project-a");
    expect(restored?.selectedNumber).toBe(2);
    expect(restored?.question).toBe(input.question);
    expect(readClarificationCard(storage, "project-b")).toBeNull();
    clearClarificationCard(storage, "project-a");
    expect(readClarificationCard(storage, "project-a")).toBeNull();
  });

  it("ignores damaged, stale and foreign stored records", () => {
    const storage = new MemoryStorage();
    const key = clarificationStorageKey("project-a");
    storage.setItem(key, "{not json");
    expect(readClarificationCard(storage, "project-a")).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 99, savedAt: Date.now(), card: {} }));
    expect(readClarificationCard(storage, "project-a")).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 1, savedAt: 0, card: {} }));
    expect(readClarificationCard(storage, "project-a")).toBeNull();
    expect(storage.values.has(key)).toBe(false);
    const foreign = createClarificationCard({ ...input, taskScope: "project-b" });
    storage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), card: foreign }));
    expect(readClarificationCard(storage, "project-a")).toBeNull();
  });

  it("counts an option answer once and puts it into the existing composer", () => {
    let card = createClarificationCard(input);
    card = selectOption(card, 3);
    card = answerClarification(card);
    expect(card.status).toBe("answered");
    expect(card.answer).toEqual({ kind: "option", number: 3, label: "XLSX" });
    expect(clarificationDraft(card)).toBe("3. XLSX");
    const again = answerClarification(card);
    expect(again).toBe(card);
    expect(selectOption(card, 1)).toBe(card);
  });

  it("prefers a free-text answer over a selected option and bounds its length", () => {
    let card = selectOption(createClarificationCard(input), 1);
    card = setFreeText(card, "Свой вариант: только PDF с подписью");
    expect(card.selectedNumber).toBeNull();
    card = answerClarification(card);
    expect(card.answer).toEqual({
      kind: "free_text",
      value: "Свой вариант: только PDF с подписью"
    });
    expect(clarificationDraft(card)).toBe("Свой вариант: только PDF с подписью");
    const long = setFreeText(createClarificationCard(input), "x".repeat(2001));
    expect(long.freeText).toBe("");
  });

  it("does not answer an empty card and never skips a required question", () => {
    const empty = createClarificationCard(input);
    expect(answerClarification(empty)).toBe(empty);
    expect(clarificationDraft(empty)).toBeNull();
    const required = createClarificationCard({ ...input, required: true });
    expect(clarificationWaiting(required)).toBe(true);
    expect(skipClarification(required)).toBe(required);
    expect(clarificationWaiting(answerClarification(selectOption(required, 1)))).toBe(false);
  });

  it("skips an optional question exactly once", () => {
    const card = skipClarification(createClarificationCard(input));
    expect(card.status).toBe("skipped");
    expect(clarificationDraft(card)).toBeNull();
    expect(skipClarification(card)).toBe(card);
    expect(answerClarification(card)).toBe(card);
  });
});
