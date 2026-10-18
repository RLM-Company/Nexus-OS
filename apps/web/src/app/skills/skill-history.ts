import { asDraft, draftKey, type Draft } from "./skill-model";

export type SkillHistory = { past: Draft[]; future: Draft[]; group: keyof Draft | null };
export const SKILL_HISTORY_LIMIT = 40;
export const SKILL_HISTORY_BYTES = 2 * 1024 * 1024;
export const emptySkillHistory = (): SkillHistory => ({ past: [], future: [], group: null });
const bounded = (items: Draft[]): Draft[] => {
  const result: Draft[] = [];
  let bytes = 0;
  for (let index = items.length - 1; index >= 0 && result.length < SKILL_HISTORY_LIMIT; index--) {
    const item = asDraft(items[index]!);
    bytes += JSON.stringify(item).length * 2;
    if (bytes > SKILL_HISTORY_BYTES) break;
    result.unshift(item);
  }
  return result;
};
/** Content only. Selected IDs, server version, creation keys and permissions never enter history. */
export function recordSkillEdit(
  history: SkillHistory,
  before: Draft,
  after: Draft,
  group: keyof Draft | null = null
): SkillHistory {
  if (draftKey(before) === draftKey(after)) return history;
  return {
    past: group && group === history.group ? history.past : bounded([...history.past, before]),
    future: [],
    group
  };
}
export function travelSkillHistory(
  history: SkillHistory,
  current: Draft,
  direction: "undo" | "redo"
): { history: SkillHistory; draft: Draft } | null {
  const source = direction === "undo" ? history.past : history.future;
  const target = source.at(-1);
  if (!target) return null;
  return {
    draft: asDraft(target),
    history:
      direction === "undo"
        ? { past: source.slice(0, -1), future: bounded([...history.future, current]), group: null }
        : { past: bounded([...history.past, current]), future: source.slice(0, -1), group: null }
  };
}
