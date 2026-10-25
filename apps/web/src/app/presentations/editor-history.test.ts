import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  contentKey,
  emptyHistory,
  HISTORY_BYTES,
  HISTORY_LIMIT,
  recordEdit,
  snapshot,
  travel
} from "./editor-history";
import type { Deck } from "./model";
const deck = (): Deck => ({
  id: "deck",
  title: "Доклад",
  theme: "paper",
  slides: [{ id: "s1", layout: "title", title: "A", body: "", aside: "", notes: "" }],
  slide_count: 1,
  version: 1,
  created_at: "initial",
  updated_at: "initial"
});
describe("presentation local edit history", () => {
  it("groups typing but preserves the first text and exact multiline Unicode for redo", () => {
    const initial = snapshot(deck(), 0);
    const middle = { ...initial, title: "Б" };
    const final = { ...initial, title: "Байкал 😀\r\n" };
    let history = recordEdit(emptyHistory(), initial, middle, "title");
    history = recordEdit(history, middle, final, "title");
    expect(history.past).toHaveLength(1);
    const undone = travel(history, final, "undo")!;
    expect(undone.value).toEqual(initial);
    expect(travel(undone.history, undone.value, "redo")!.value).toEqual(final);
  });
  it("new edits discard redo, while selection-only and no-op changes do not", () => {
    const a = snapshot(deck(), 0);
    const b = { ...a, title: "B" };
    const undo = travel(recordEdit(emptyHistory(), a, b), b, "undo")!;
    expect(recordEdit(undo.history, a, { ...a, selected: 1 })).toBe(undo.history);
    expect(recordEdit(undo.history, a, { ...a, title: "C" }).future).toEqual([]);
  });
  it("undo after save keeps the newest server version, identity, timestamp and source", () => {
    const current = { ...deck(), version: 7, updated_at: "new", title: "Saved" };
    const old = snapshot(deck(), 0);
    const applied = applySnapshot(current, old);
    expect(applied).toMatchObject({ id: "deck", title: "Доклад", version: 7, updated_at: "new" });
    expect(contentKey(applied)).not.toBe(contentKey(current));
    expect(contentKey(applySnapshot(applied, snapshot(current, 0)))).toBe(contentKey(current));
  });
  it("structural undo restores slide IDs, selection and notes; redo does not regenerate IDs", () => {
    const initial = snapshot(deck(), 0);
    const changed = {
      ...initial,
      selected: 1,
      slides: [...initial.slides, { ...initial.slides[0]!, id: "duplicate", notes: "note" }]
    };
    const undo = travel(recordEdit(emptyHistory(), initial, changed), changed, "undo")!;
    const redo = travel(undo.history, undo.value, "redo")!;
    expect(redo.value).toEqual(changed);
    expect(applySnapshot(deck(), redo.value).slide_count).toBe(2);
  });
  it("bounds history by both count and retained string bytes", () => {
    let value = snapshot(deck(), 0);
    let history = emptyHistory();
    for (let i = 0; i < 100; i++) {
      const next = { ...value, title: String(i) };
      history = recordEdit(history, value, next);
      value = next;
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    value = { ...value, title: "x".repeat(HISTORY_BYTES / 3) };
    history = recordEdit(history, value, { ...value, title: "next" });
    expect(
      history.past.reduce((n, item) => n + JSON.stringify(item).length * 2, 0)
    ).toBeLessThanOrEqual(HISTORY_BYTES);
  });
  it("snapshots and restores do not share mutable slide objects", () => {
    const original = deck();
    const snap = snapshot(original, 0);
    original.slides[0]!.title = "mutated";
    expect(snap.slides[0]!.title).toBe("A");
    applySnapshot(original, snap).slides[0]!.notes = "mutated";
    expect(snap.slides[0]!.notes).toBe("");
    expect(travel(emptyHistory(), snap, "undo")).toBeNull();
  });
});
