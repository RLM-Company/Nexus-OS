import { describe, expect, it } from "vitest";
import {
  pinnedNavigationKey,
  pinsFirst,
  readPinnedNavigation,
  savePinnedNavigation,
  togglePin
} from "./pinned-navigation";
const key = pinnedNavigationKey("owner-1");

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
    expect(savePinnedNavigation(storage, pins, key)).toBe(true);
    expect(JSON.parse(raw ?? "null")).toEqual({
      version: 1,
      chats: ["chat-1"],
      projects: ["project-2"]
    });
    expect(readPinnedNavigation(storage, key)).toEqual(pins);
    const items = [{ id: "a" }, { id: "chat-1" }, { id: "b" }];
    expect(pinsFirst(items, pins.chats)).toEqual([items[1], items[0], items[2]]);
    expect(togglePin(pins, "chats", "chat-1").chats).toEqual([]);
  });

  it("ignores damaged and future storage and never throws on quota failure", () => {
    expect(readPinnedNavigation({ getItem: () => "{" }, key)).toEqual({ chats: [], projects: [] });
    expect(readPinnedNavigation({ getItem: () => '{"version":2,"chats":["x"]}' }, key)).toEqual({
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
        { chats: [], projects: [] },
        key
      )
    ).toBe(false);
  });

  it("deduplicates and caps malicious storage without affecting unrelated lists", () => {
    const raw = JSON.stringify({ version: 1, chats: ["a", "a", 3, "x".repeat(161)], projects: [] });
    expect(
      readPinnedNavigation({ getItem: (requestedKey) => (requestedKey === key ? raw : null) }, key)
        .chats
    ).toEqual(["a"]);
    expect(pinsFirst([{ id: "other" }], ["a"]).map((item) => item.id)).toEqual(["other"]);
  });
  it("separates owners and never restores an unscoped legacy key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (requested: string) => values.get(requested) ?? null,
      setItem: (requested: string, value: string) => {
        values.set(requested, value);
      }
    };
    values.set("kosmora:pinned-navigation:v1", '{"version":1,"chats":["old"],"projects":[]}');
    savePinnedNavigation(storage, { chats: ["private-chat"], projects: [] }, key);
    expect(readPinnedNavigation(storage, pinnedNavigationKey("owner-2"))).toEqual({
      chats: [],
      projects: []
    });
    expect(readPinnedNavigation(storage, key).chats).toEqual(["private-chat"]);
  });
});
