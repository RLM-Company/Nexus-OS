import { asDraft, type Draft } from "./skill-model";
export const SKILL_FIELDS = [
  { key: "name", label: "Название", limit: 80 },
  { key: "summary", label: "Описание", limit: 240 },
  { key: "instructions", label: "Инструкция", limit: 20_000 }
] as const;
export type SkillSearchOptions = {
  query: string;
  caseSensitive: boolean;
  field: keyof Draft | "all";
};
export type SkillMatch = { field: keyof Draft; start: number; end: number };
export const SKILL_SEARCH_LIMIT = 4000;
export const SKILL_MATCH_LIMIT = 5000;
export function findSkillText(
  draft: Draft,
  options: SkillSearchOptions
): { matches: SkillMatch[]; limited: boolean } {
  const matches: SkillMatch[] = [];
  if (!options.query || options.query.length > SKILL_SEARCH_LIMIT)
    return { matches, limited: false };
  const expression = new RegExp(
    options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu"
  );
  for (const { key } of SKILL_FIELDS) {
    if (options.field !== "all" && options.field !== key) continue;
    expression.lastIndex = 0;
    for (let found = expression.exec(draft[key]); found; found = expression.exec(draft[key])) {
      if (matches.length === SKILL_MATCH_LIMIT) return { matches, limited: true };
      matches.push({ field: key, start: found.index, end: found.index + found[0].length });
    }
  }
  return { matches, limited: false };
}
/** Exact local replacement. Empty drafts are allowed; saving still requires all three fields. */
export function replaceSkillText(
  draft: Draft,
  options: SkillSearchOptions,
  replacement: string,
  only?: number
): Draft {
  if (replacement.length > SKILL_SEARCH_LIMIT) throw Error("Замена превышает 4000 символов.");
  const found = findSkillText(draft, options);
  if (found.limited) throw Error("Слишком много совпадений. Уточните запрос или выберите поле.");
  const matches =
    only === undefined ? found.matches : found.matches.filter((_, index) => index === only);
  if (!matches.length) return draft;
  // Reject growth before allocation, using final field lengths rather than intermediate states.
  for (const { key, label, limit } of SKILL_FIELDS) {
    const size = matches
      .filter((match) => match.field === key)
      .reduce(
        (sum, match) => sum + replacement.length - (match.end - match.start),
        draft[key].length
      );
    if (size > limit) throw Error(`${label}: замена превышает ${limit} символов.`);
  }
  const result = asDraft(draft);
  for (const match of [...matches].reverse()) {
    const text = result[match.field];
    result[match.field] = text.slice(0, match.start) + replacement + text.slice(match.end);
  }
  for (const { key } of SKILL_FIELDS) {
    if ([...result[key]].some((c) => c.charCodeAt(0) < 32 && !"\t\r\n".includes(c)))
      throw Error("Замена содержит недопустимые управляющие символы.");
  }
  return result;
}
