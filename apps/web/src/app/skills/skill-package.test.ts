import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSkillPackage, readSkillPackage } from "./skill-package";
import {
  draftKey,
  filterSkills,
  matchesSuccessor,
  normalizeDraft,
  type Detail
} from "./skill-model";
const draft = {
  name: "Проверка",
  summary: "Описание",
  instructions: "Текст 😀\r\n\t<svg onload='x'>"
};
const hash = (value: typeof draft) =>
  createHash("sha256")
    .update(JSON.stringify([value.name, value.summary, value.instructions]))
    .digest("hex");
describe("portable Skill review", () => {
  it("uses the server's canonical digest and preserves internal Unicode/CRLF literally", async () => {
    const pack = await createSkillPackage(draft);
    expect(pack.sha256).toBe(hash(draft));
    expect(await readSkillPackage(JSON.stringify(pack))).toEqual({ package: pack, draft });
    expect(Object.keys(pack).sort()).toEqual([
      "execution",
      "format",
      "instructions",
      "name",
      "permissions",
      "sha256",
      "summary"
    ]);
  });
  it("verifies raw imported checksum before showing the exact trimmed server result", async () => {
    const raw = { ...draft, name: "  Проверка  ", instructions: "\r\nТекст\r\n" };
    const pack = { ...(await createSkillPackage(draft)), ...raw, sha256: hash(raw) };
    const result = await readSkillPackage("\uFEFF" + JSON.stringify(pack));
    expect(result.package.name).toBe(raw.name);
    expect(result.draft).toEqual({ ...raw, name: "Проверка", instructions: "Текст" });
  });
  it("rejects corruption, extra authority fields and nonempty permissions", async () => {
    const pack = await createSkillPackage(draft);
    for (const invalid of [
      { ...pack, instructions: "changed" },
      { ...pack, owner_id: "other" },
      { ...pack, permissions: ["network"] },
      { ...pack, execution: "enabled" },
      { ...pack, sha256: pack.sha256.toUpperCase() },
      { ...pack, format: "other" }
    ])
      await expect(readSkillPackage(JSON.stringify(invalid))).rejects.toThrow();
  });
  it("rejects oversized UTF-8 before JSON parse, invalid shapes and empty fields", async () => {
    await expect(readSkillPackage("界".repeat(22_000))).rejects.toThrow(/64/);
    for (const input of ["null", "[]", "{}", "{", '"string"'])
      await expect(readSkillPackage(input)).rejects.toThrow();
    for (const patch of [
      { instructions: "  " },
      { name: "x".repeat(81) },
      { summary: "bad\u0000" },
      { instructions: "x".repeat(20_001) }
    ])
      await expect(createSkillPackage({ ...draft, ...patch })).rejects.toThrow();
  });
  it("normalizes only edges and filters names/summaries without mutating the catalog", () => {
    expect(normalizeDraft({ ...draft, name: " Проверка " }).instructions).toBe(draft.instructions);
    const items = [
      { id: "a", name: "История", summary: "Краткий конспект", current_version: 1, updated_at: "" },
      { id: "b", name: "Код", summary: "Проверка", current_version: 2, updated_at: "" }
    ];
    expect(filterSkills(items, " КОНСПЕКТ ")).toEqual([items[0]]);
    expect(filterSkills(items, "")).toEqual(items);
    expect(items).toHaveLength(2);
    expect(draftKey({ ...draft, version: 99 } as typeof draft)).toBe(draftKey(draft));
  });
  it("accepts only the same Skill's exact next saved revision", () => {
    const detail: Detail = {
      skill: {
        id: "a",
        name: draft.name,
        summary: draft.summary,
        current_version: 2,
        updated_at: ""
      },
      versions: [{ ...draft, version: 2, created_at: "" }]
    };
    expect(matchesSuccessor(detail, "a", 1, draft)).toBe(true);
    expect(matchesSuccessor(detail, "b", 1, draft)).toBe(false);
    expect(matchesSuccessor(detail, "a", 2, draft)).toBe(false);
    expect(matchesSuccessor({ ...detail, versions: [] }, "a", 1, draft)).toBe(false);
    expect(
      matchesSuccessor(detail, "a", 1, {
        ...draft,
        instructions: draft.instructions.replace("\r\n", "\n")
      })
    ).toBe(false);
  });
});
