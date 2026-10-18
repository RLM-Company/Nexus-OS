import { expect, it } from "vitest";
import {
  emptySkillHistory,
  recordSkillEdit,
  travelSkillHistory,
  SKILL_HISTORY_LIMIT,
  SKILL_HISTORY_BYTES
} from "./skill-history";
const initial = { name: "Skill", summary: "Summary", instructions: "Кириллица 😀\r\n" };
it("coalesces typing within one field and separates fields and blur boundaries", () => {
  const a = { ...initial, name: "S" },
    b = { ...a, name: "Sk" },
    c = { ...b, summary: "New" };
  let history = recordSkillEdit(emptySkillHistory(), initial, a, "name");
  history = recordSkillEdit(history, a, b, "name");
  expect(history.past).toEqual([initial]);
  history = recordSkillEdit(history, b, c, "summary");
  expect(history.past).toEqual([initial, b]);
  history.group = null;
  history = recordSkillEdit(history, c, { ...c, summary: "Next" }, "summary");
  expect(history.past).toEqual([initial, b, c]);
});
it("undo/redo restore exact text while a new edit clears redo and no-op edits preserve it", () => {
  const a = { ...initial, instructions: "Other\r\n😀" };
  const history = recordSkillEdit(emptySkillHistory(), initial, a);
  const undone = travelSkillHistory(history, a, "undo")!;
  expect(undone.draft).toEqual(initial);
  expect(travelSkillHistory(undone.history, undone.draft, "redo")?.draft).toEqual(a);
  expect(recordSkillEdit(undone.history, initial, initial)).toBe(undone.history);
  expect(recordSkillEdit(undone.history, initial, { ...initial, name: "Changed" }).future).toEqual(
    []
  );
  expect(travelSkillHistory(emptySkillHistory(), initial, "undo")).toBeNull();
  expect(travelSkillHistory(emptySkillHistory(), initial, "redo")).toBeNull();
});
it("copies only editable fields, never server identity, versions or creation keys", () => {
  const state = { ...initial, id: "server", current_version: 12, requestId: "key" };
  const next = { ...initial, name: "Next" };
  const history = recordSkillEdit(emptySkillHistory(), state, next);
  expect(history.past[0]).toEqual(initial);
  expect(travelSkillHistory(history, next, "undo")?.draft).toEqual(initial);
  state.name = "Mutated";
  expect(history.past[0]?.name).toBe(initial.name);
  const serverVersion = 13;
  const result = {
    id: "server",
    current_version: serverVersion,
    ...travelSkillHistory(history, next, "undo")!.draft
  };
  expect(result.current_version).toBe(serverVersion);
});
it("bounds both directions by count and serialized bytes", () => {
  let history = emptySkillHistory(),
    current = initial;
  for (let i = 0; i < 100; i++) {
    const next = { ...initial, name: String(i) };
    history = recordSkillEdit(history, current, next);
    current = next;
  }
  expect(history.past).toHaveLength(SKILL_HISTORY_LIMIT);
  expect(history.past[0]?.name).toBe("59");
  for (let i = 0; i < SKILL_HISTORY_LIMIT; i++) {
    const result = travelSkillHistory(history, current, "undo")!;
    history = result.history;
    current = result.draft;
  }
  expect(history.future).toHaveLength(SKILL_HISTORY_LIMIT);
  expect(travelSkillHistory(history, current, "undo")).toBeNull();
  const huge = { ...initial, instructions: "x".repeat(SKILL_HISTORY_BYTES) };
  expect(recordSkillEdit(emptySkillHistory(), huge, initial).past).toEqual([]);
});
it("an atomic multi-field replacement is one undo operation", () => {
  const replaced = { name: "New", summary: "New", instructions: "New" };
  const history = recordSkillEdit(emptySkillHistory(), initial, replaced);
  expect(travelSkillHistory(history, replaced, "undo")?.draft).toEqual(initial);
});
