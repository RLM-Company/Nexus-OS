import type { Deck, Slide, Theme } from "./model";

// Only editable content enters history: server versions and provenance never rewind.
export type EditorSnapshot = { title: string; theme: Theme; slides: Slide[]; selected: number };
export type EditorHistory = {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  group: string | null;
};
export const HISTORY_LIMIT = 40;
export const HISTORY_BYTES = 8 * 1024 * 1024;
export const emptyHistory = (): EditorHistory => ({ past: [], future: [], group: null });
export const snapshot = (deck: Deck, selected: number): EditorSnapshot => ({
  title: deck.title,
  theme: deck.theme,
  slides: deck.slides.map((slide) => ({ ...slide })),
  selected
});
export const contentKey = (value: Pick<EditorSnapshot, "title" | "theme" | "slides">): string =>
  JSON.stringify([value.title, value.theme, value.slides]);
const size = (value: EditorSnapshot) => JSON.stringify(value).length * 2;
function bounded(items: EditorSnapshot[]): EditorSnapshot[] {
  let bytes = 0;
  const result: EditorSnapshot[] = [];
  for (let index = items.length - 1; index >= 0 && result.length < HISTORY_LIMIT; index--) {
    const item = items[index]!;
    bytes += size(item);
    if (bytes > HISTORY_BYTES) break;
    result.unshift(item);
  }
  return result;
}
export function recordEdit(
  history: EditorHistory,
  before: EditorSnapshot,
  after: EditorSnapshot,
  group: string | null = null
): EditorHistory {
  if (contentKey(before) === contentKey(after)) return history;
  return {
    past: group && history.group === group ? history.past : bounded([...history.past, before]),
    future: [],
    group
  };
}
export function travel(
  history: EditorHistory,
  current: EditorSnapshot,
  direction: "undo" | "redo"
): { history: EditorHistory; value: EditorSnapshot } | null {
  const source = direction === "undo" ? history.past : history.future;
  const value = source.at(-1);
  if (!value) return null;
  return {
    value,
    history:
      direction === "undo"
        ? { past: source.slice(0, -1), future: bounded([...history.future, current]), group: null }
        : { past: bounded([...history.past, current]), future: source.slice(0, -1), group: null }
  };
}
export function applySnapshot(deck: Deck, value: EditorSnapshot): Deck {
  return {
    ...deck,
    title: value.title,
    theme: value.theme,
    slides: value.slides.map((slide) => ({ ...slide })),
    slide_count: value.slides.length
  };
}
