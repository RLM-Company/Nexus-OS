import { describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  DRAFT_LIMITS,
  DRAFT_PREFIX,
  readComposerDraft,
  saveComposerDraft
} from "./composer-draft-storage";

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
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
const key = `${DRAFT_PREFIX}chat:a`;
const files = [{ name: "code.ts", content: "export const hello = '🛰️';" }];
describe("bounded composer drafts", () => {
  it("isolates scopes, restores materials and clears every record", () => {
    const storage = new MemoryStorage();
    saveComposerDraft(storage, key, "hello", files);
    saveComposerDraft(storage, `${DRAFT_PREFIX}project:a`, "project", []);
    expect(readComposerDraft(storage, key)).toEqual({ text: "hello", files, notice: null });
    expect(readComposerDraft(storage, `${DRAFT_PREFIX}project:a`).text).toBe("project");
    clearComposerDraft(storage, key);
    expect(readComposerDraft(storage, key).files).toEqual([]);
    expect(readComposerDraft(storage, key).text).toBe("");
  });
  it("recovers legacy text and keeps text when materials are corrupt", () => {
    const storage = new MemoryStorage();
    storage.setItem(key, "raw legacy text");
    expect(readComposerDraft(storage, key).text).toBe("raw legacy text");
    storage.setItem(
      "cosmora:composer-materials:chat:a",
      '{"version":1,"savedAt":1,"files":[null]}'
    );
    // Use a current timestamp to test shape validation, rather than expiry.
    storage.setItem(
      "cosmora:composer-materials:chat:a",
      JSON.stringify({ version: 1, savedAt: Date.now(), files: [null] })
    );
    expect(readComposerDraft(storage, key)).toMatchObject({ text: "raw legacy text", files: [] });
    expect(readComposerDraft(storage, key).notice).toBeTruthy();
  });
  it("preserves text on quota errors and removes stale material", () => {
    const storage = new MemoryStorage();
    saveComposerDraft(storage, key, "old", files);
    const set = storage.setItem.bind(storage);
    storage.setItem = (recordKey, value) => {
      if (recordKey.includes("materials")) throw new Error("QuotaExceeded");
      set(recordKey, value);
    };
    expect(saveComposerDraft(storage, key, "latest", [])).toBeTruthy();
    expect(readComposerDraft(storage, key)).toEqual({ text: "latest", files: [], notice: null });
  });
  it("evicts oldest records by count and total size without touching other features", () => {
    const storage = new MemoryStorage();
    storage.setItem("cosmora:github-import:fixture", "keep");
    for (let i = 0; i < 30; i++)
      saveComposerDraft(storage, `${DRAFT_PREFIX}chat:${i}`, "draft", []);
    expect([...storage.values.keys()].filter((name) => name.startsWith(DRAFT_PREFIX))).toHaveLength(
      DRAFT_LIMITS.entries
    );
    expect(readComposerDraft(storage, `${DRAFT_PREFIX}chat:29`).text).toBe("draft");
    for (let i = 0; i < 8; i++)
      saveComposerDraft(storage, `${DRAFT_PREFIX}project:${i}`, "x".repeat(128_000), [
        {
          name: "large.png",
          kind: "image",
          media_type: "image/png",
          data_base64: "x".repeat(900_000)
        }
      ]);
    expect(
      [...storage.values]
        .filter(
          ([name]) =>
            name.startsWith(DRAFT_PREFIX) || name.startsWith("cosmora:composer-materials:")
        )
        .reduce((sum, [name, value]) => sum + name.length + value.length, 0)
    ).toBeLessThanOrEqual(DRAFT_LIMITS.characters);
    expect(storage.getItem("cosmora:github-import:fixture")).toBe("keep");
  });
  it("expires records and declines oversized text without truncating it", () => {
    const storage = new MemoryStorage();
    saveComposerDraft(storage, key, "old", files);
    storage.setItem(
      "cosmora:composer-materials:chat:a",
      JSON.stringify({ version: 1, savedAt: Date.now() - DRAFT_LIMITS.ageMs - 1, files })
    );
    expect(readComposerDraft(storage, key).text).toBe("");
    expect(storage.length).toBe(0);
    expect(saveComposerDraft(storage, key, "x".repeat(DRAFT_LIMITS.text + 1), [])).toBeTruthy();
  });
});
