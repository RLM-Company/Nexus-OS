import { describe, expect, it } from "vitest";
import type { OfficeOperation } from "@cosmora/contracts";
import {
  deleteOfficeDraft,
  OFFICE_DRAFT_LIMITS,
  OFFICE_DRAFT_PREFIX,
  officeDraftKey,
  readOfficeDraft,
  restoreOfficeDraft,
  saveOfficeDraft
} from "./office-draft-storage";
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
const source = { name: "offer.docx", version: "sha256:" + "a".repeat(64), existingSheets: 0 };
const operations: OfficeOperation[] = [
  {
    kind: "replace_text",
    target: "paragraph:3",
    find: "Компания А",
    replace: "Компания В · 00123 · 19 700 · кроме доставки"
  }
];
describe("explicit Office plan drafts", () => {
  it("round-trips only the bounded plan and source identity without file bytes or confirmation", () => {
    const storage = new MemoryStorage();
    const saved = saveOfficeDraft(storage, source, operations, null, "first");
    expect(JSON.parse(saved.raw!)).toMatchObject({
      schema: 1,
      name: source.name,
      source_version: source.version,
      operations
    });
    expect(Object.keys(JSON.parse(saved.raw!) as Record<string, unknown>).sort()).toEqual(
      [
        "schema",
        "revision",
        "savedAt",
        "name",
        "source_version",
        "existingSheets",
        "operations"
      ].sort()
    );
    expect(restoreOfficeDraft(storage, source, saved.raw!)).toEqual(operations);
    const restored = restoreOfficeDraft(storage, source, saved.raw!);
    if (restored[0]?.kind === "replace_text") restored[0].replace = "changed";
    expect(restoreOfficeDraft(storage, source, saved.raw!)).toEqual(operations);
  });
  it("preserves mixed types, leading zeros, multiline conditions, negative numbers and unevaluated formulas", () => {
    const storage = new MemoryStorage();
    const xlsx = { ...source, name: "offer.xlsx", existingSheets: 1 };
    const ops: OfficeOperation[] = [
      { kind: "add_sheet", name: "Итог" },
      {
        kind: "set_range",
        target: "sheet:2",
        start: "A1",
        rows: [
          [
            "00123",
            19700,
            -12.5,
            true,
            null,
            { formula: "SUM(B1:B1)" },
            "кроме доставки\nобязательно"
          ]
        ]
      }
    ];
    const saved = saveOfficeDraft(storage, xlsx, ops, null, "first");
    expect(restoreOfficeDraft(storage, xlsx, saved.raw!)).toEqual(ops);
    const pptx = { ...source, name: "offer.pptx" };
    const slide: OfficeOperation[] = [
      { kind: "replace_text", target: "slide:1/shape:2", find: "Компания А", replace: "Компания В" }
    ];
    const slideSaved = saveOfficeDraft(storage, pptx, slide, null, "slide");
    expect(restoreOfficeDraft(storage, pptx, slideSaved.raw!)).toEqual(slide);
  });
  it("refuses a changed version or sheet count, never replacing the saved source implicitly", () => {
    const storage = new MemoryStorage();
    const saved = saveOfficeDraft(storage, source, operations, null, "first");
    const changed = { ...source, version: "sha256:" + "b".repeat(64) };
    expect(readOfficeDraft(storage, changed).notice).toMatch(/Версия/);
    expect(readOfficeDraft(storage, changed).operations).toBeNull();
    expect(() => saveOfficeDraft(storage, changed, operations, saved.raw, "second")).toThrow(
      /Версия/
    );
    expect(() => restoreOfficeDraft(storage, changed, saved.raw!)).toThrow(/Версия/);
    expect(readOfficeDraft(storage, { ...source, existingSheets: 1 }).operations).toBeNull();
    expect(readOfficeDraft(storage, { ...source, name: "other.docx" }).raw).toBeNull();
    expect(storage.getItem(officeDraftKey(source))).toBe(saved.raw);
  });
  it("rejects stale saves, restores and deletions, including A-B-A records with equal operations", () => {
    const storage = new MemoryStorage();
    const first = saveOfficeDraft(storage, source, operations, null, "first");
    const second = saveOfficeDraft(storage, source, operations, first.raw, "second");
    expect(() => saveOfficeDraft(storage, source, operations, first.raw, "stale")).toThrow(
      /другой вкладке/
    );
    expect(() => restoreOfficeDraft(storage, source, first.raw!)).toThrow(/другой вкладке/);
    expect(() => deleteOfficeDraft(storage, source, first.raw!)).toThrow(/другой вкладке/);
    expect(storage.getItem(officeDraftKey(source))).toBe(second.raw);
    deleteOfficeDraft(storage, source, second.raw!);
    expect(readOfficeDraft(storage, source).raw).toBeNull();
  });
  it("rejects malformed, expired, future and oversized records while allowing explicit deletion", () => {
    const storage = new MemoryStorage();
    const key = officeDraftKey(source);
    for (const raw of ["{", "x".repeat(OFFICE_DRAFT_LIMITS.record + 1)]) {
      storage.setItem(key, raw);
      expect(readOfficeDraft(storage, source).operations).toBeNull();
      expect(readOfficeDraft(storage, source).notice).toMatch(/повреждён/);
      deleteOfficeDraft(storage, source, raw);
    }
    const old = saveOfficeDraft(storage, source, operations, null, "old", 1);
    expect(readOfficeDraft(storage, source).notice).toMatch(/истёк/);
    deleteOfficeDraft(storage, source, old.raw!);
    saveOfficeDraft(storage, source, operations, null, "future", Date.now() + 120_000);
    expect(readOfficeDraft(storage, source).operations).toBeNull();
  });
  it("validates untrusted records, dependencies, budgets, exact shapes and value precision before restore", () => {
    const storage = new MemoryStorage();
    const xlsx = { ...source, name: "offer.xlsx", existingSheets: 1 };
    const valid: OfficeOperation[] = [
      { kind: "set_cell", target: "sheet:1", address: "A1", value: "00123" }
    ];
    const saved = saveOfficeDraft(storage, xlsx, valid, null, "first");
    const bad = [
      [{ ...valid[0], value: 9007199254740992 }],
      [{ ...valid[0], preview_token: "forbidden" }],
      [{ ...valid[0], target: "sheet:2" }],
      [{ ...valid[0], value: { formula: "SUM(A1:A1)", cached_value: 19700 } }],
      [{ kind: "set_range", target: "sheet:1", start: "A1", rows: [["x"], ["y", "z"]] }],
      [{ kind: "set_range", target: "sheet:1", start: "A1", rows: [] }],
      operations,
      Array.from({ length: 41 }, () => valid[0]),
      [{ ...valid[0], value: "x".repeat(501) }]
    ];
    for (const ops of bad) {
      storage.setItem(
        officeDraftKey(xlsx),
        JSON.stringify({ ...JSON.parse(saved.raw!), operations: ops })
      );
      expect(readOfficeDraft(storage, xlsx).operations).toBeNull();
    }
    storage.setItem(
      officeDraftKey(xlsx),
      JSON.stringify({ ...JSON.parse(saved.raw!), bytes: "forbidden" })
    );
    expect(readOfficeDraft(storage, xlsx).operations).toBeNull();
  });
  it("bounds its own namespace without evicting chat drafts or saved Office plans", () => {
    const storage = new MemoryStorage();
    storage.setItem("cosmora:composer-draft:chat:a", "keep");
    for (let i = 0; i < OFFICE_DRAFT_LIMITS.entries; i++)
      saveOfficeDraft(storage, { ...source, name: `${i}.docx` }, operations, null, `revision-${i}`);
    const before = [...storage.values];
    expect(() => saveOfficeDraft(storage, source, operations, null, "full")).toThrow(/заполнено/);
    expect([...storage.values]).toEqual(before);
    expect(
      [...storage.values.keys()].filter((k) => k.startsWith(OFFICE_DRAFT_PREFIX))
    ).toHaveLength(20);
  });
  it("does not discard an older draft when storage quota denies an update", () => {
    const storage = new MemoryStorage();
    const saved = saveOfficeDraft(storage, source, operations, null, "first");
    storage.setItem = () => {
      throw Error("QuotaExceededError");
    };
    expect(() => saveOfficeDraft(storage, source, operations, saved.raw, "second")).toThrow(
      /Quota/
    );
    expect(storage.getItem(officeDraftKey(source))).toBe(saved.raw);
    expect(() => officeDraftKey({ ...source, name: "../offer.docx" })).toThrow();
  });
});
