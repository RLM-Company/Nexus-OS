import type { Deck, Slide } from "./model";
import { presentationPackage } from "./package";
export type TextField = "title" | "body" | "aside" | "notes";
export type SearchOptions = {
  query: string;
  caseSensitive: boolean;
  includeNotes: boolean;
  slide: number | null;
};
export type TextMatch = { slide: number; field: TextField; start: number; end: number };
export const MATCH_LIMIT = 10_000;
export const SEARCH_LIMIT = 4000;
export function findText(
  deck: Deck,
  options: SearchOptions
): { matches: TextMatch[]; limited: boolean } {
  const matches: TextMatch[] = [];
  if (!options.query || options.query.length > SEARCH_LIMIT) return { matches, limited: false };
  const expression = new RegExp(
    options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu"
  );
  const fields: TextField[] = options.includeNotes
    ? ["title", "body", "aside", "notes"]
    : ["title", "body", "aside"];
  for (let slide = 0; slide < deck.slides.length; slide++) {
    if (options.slide !== null && options.slide !== slide) continue;
    for (const field of fields) {
      expression.lastIndex = 0;
      for (
        let match = expression.exec(deck.slides[slide]![field]);
        match;
        match = expression.exec(deck.slides[slide]![field])
      ) {
        if (matches.length === MATCH_LIMIT) return { matches, limited: true };
        matches.push({ slide, field, start: match.index, end: match.index + match[0].length });
      }
    }
  }
  return { matches, limited: false };
}
/** Recompute against the exact current deck. Replacement strings are always literal. */
export function replaceText(
  deck: Deck,
  options: SearchOptions,
  replacement: string,
  only?: number
): Deck {
  if (replacement.length > SEARCH_LIMIT) throw Error("Замена превышает 4000 символов.");
  const found = findText(deck, options);
  if (found.limited)
    throw Error("Слишком много совпадений. Уточните поиск или выберите один слайд.");
  const matches =
    only === undefined ? found.matches : found.matches.filter((_, index) => index === only);
  if (!matches.length) return deck;
  const slides: Slide[] = deck.slides.map((slide) => ({ ...slide }));
  // Reverse offsets keep every original match stable, even when replacements change length.
  for (const match of [...matches].reverse()) {
    const slide = slides[match.slide]!;
    const value = slide[match.field];
    if (
      value.length - (match.end - match.start) + replacement.length >
      (match.field === "title" ? 180 : 4000)
    )
      throw Error(`Слайд ${match.slide + 1}: замена превышает допустимую длину поля.`);
    slide[match.field] = value.slice(0, match.start) + replacement + value.slice(match.end);
  }
  const result = { ...deck, slides };
  presentationPackage(result); // Same field/byte/control-character rules as portable save/export.
  return result;
}
