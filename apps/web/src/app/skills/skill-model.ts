export type Draft = { name: string; summary: string; instructions: string };
export type Skill = {
  id: string;
  name: string;
  summary: string;
  current_version: number;
  updated_at: string;
};
export type Revision = Draft & { version: number; created_at: string };
export type Detail = { skill: Skill; versions: Revision[] };
export type SkillPackage = Draft & {
  format: "kosmora.skill.v1";
  execution: "disabled";
  permissions: [];
  sha256: string;
};
export const emptyDraft = (): Draft => ({ name: "", summary: "", instructions: "" });
export const draftKey = (value: Draft): string =>
  JSON.stringify([value.name, value.summary, value.instructions]);
export const asDraft = (value: Draft): Draft => ({
  name: value.name,
  summary: value.summary,
  instructions: value.instructions
});
export function normalizeDraft(value: Draft): Draft {
  const clean = (text: string, max: number) => {
    if (
      typeof text !== "string" ||
      text.length > max ||
      !text.trim() ||
      [...text.trim()].some((c) => c.charCodeAt(0) < 32 && !"\t\r\n".includes(c))
    )
      throw Error("Заполните название, описание и инструкцию без управляющих символов.");
    return text.trim();
  };
  return {
    name: clean(value.name, 80),
    summary: clean(value.summary, 240),
    instructions: clean(value.instructions, 20_000)
  };
}
export function filterSkills(items: Skill[], query: string): Skill[] {
  const needle = query.trim().toLocaleLowerCase("ru");
  return items.filter((item) =>
    `${item.name}\n${item.summary}`.toLocaleLowerCase("ru").includes(needle)
  );
}
export function matchesSuccessor(
  detail: Detail,
  id: string,
  expectedVersion: number,
  draft: Draft
): boolean {
  const revision = detail.versions.find((value) => value.version === expectedVersion + 1);
  return (
    detail.skill.id === id &&
    detail.skill.current_version === expectedVersion + 1 &&
    !!revision &&
    draftKey(revision) === draftKey(normalizeDraft(draft))
  );
}
