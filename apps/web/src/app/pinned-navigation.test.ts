import { describe, expect, it } from "vitest";
import {
  PINNED_NAVIGATION_KEY,
  pinsFirst,
  readPinnedNavigation,
  savePinnedNavigation,
  togglePin
} from "./pinned-navigation";

describe("pinned navigation", () => {
  it("restores bounded IDs without content and keeps stable recent order", () => {
    let raw: string | null = null;
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      }
    };
    const first = togglePin({ chats: [], projects: [] }, "chats", "chat-1");
    const pins = togglePin(first, "projects", "project-2");
    expect(savePinnedNavigation(storage, pins)).toBe(true);
    expect(JSON.parse(raw ?? "null")).toEqual({
      version: 1,
      chats: ["chat-1"],
      projects: ["project-2"]
    });
    expect(readPinnedNavigation(storage)).toEqual(pins);
    const items = [{ id: "a" }, { id: "chat-1" }, { id: "b" }];
    expect(pinsFirst(items, pins.chats)).toEqual([items[1], items[0], items[2]]);
    expect(togglePin(pins, "chats", "chat-1").chats).toEqual([]);
  });

  it("ignores damaged and future storage and never throws on quota failure", () => {
    expect(readPinnedNavigation({ getItem: () => "{" })).toEqual({ chats: [], projects: [] });
    expect(readPinnedNavigation({ getItem: () => '{"version":2,"chats":["x"]}' })).toEqual({
      chats: [],
      projects: []
    });
    expect(
      savePinnedNavigation(
        {
          setItem: () => {
            throw new Error("quota");
          }
        },
        { chats: [], projects: [] }
      )
    ).toBe(false);
  });

  it("deduplicates and caps malicious storage without affecting unrelated lists", () => {
    const raw = JSON.stringify({ version: 1, chats: ["a", "a", 3, "x".repeat(161)], projects: [] });
    expect(
      readPinnedNavigation({ getItem: (key) => (key === PINNED_NAVIGATION_KEY ? raw : null) }).chats
    ).toEqual(["a"]);
    expect(pinsFirst([{ id: "other" }], ["a"]).map((item) => item.id)).toEqual(["other"]);
  });
});
