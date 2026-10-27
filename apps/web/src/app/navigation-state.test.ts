import { describe, expect, it } from "vitest";
import { readNavigationState } from "./navigation-state";

describe("navigation response boundary", () => {
  const state = {
    folders: [{ id: "folder", title: "Проект" }],
    assignments: [{ chat_id: "chat", folder_id: "folder" }],
    chats: ["chat"],
    projects: ["project"]
  };
  it("accepts persisted pins, folders and assignments", () => {
    expect(readNavigationState(state)).toEqual(state);
  });
  it.each([
    null,
    [],
    { items: [] },
    { ...state, chats: null },
    { ...state, chats: [{}] },
    { ...state, projects: [""] },
    { ...state, assignments: [{}] },
    { ...state, folders: [{ id: "folder", title: 1 }] }
  ])("refuses malformed navigation without mutating existing state: %j", (bad) => {
    const original = structuredClone(state);
    expect(() => readNavigationState(bad)).toThrow("Не удалось прочитать");
    expect(state).toEqual(original);
  });
});
