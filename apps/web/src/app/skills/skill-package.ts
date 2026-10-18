import { asDraft, draftKey, normalizeDraft, type Draft, type SkillPackage } from "./skill-model";
export const SKILL_PACKAGE_BYTES = 64_000;
const digest = async (value: Draft): Promise<string> => {
  const bytes = new TextEncoder().encode(draftKey(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
/** Same portable format as the server. This checksum is not an author signature. */
export async function createSkillPackage(value: Draft): Promise<SkillPackage> {
  const draft = normalizeDraft(value);
  return {
    format: "kosmora.skill.v1",
    ...draft,
    execution: "disabled",
    permissions: [],
    sha256: await digest(draft)
  };
}
export async function readSkillPackage(
  source: string
): Promise<{ package: SkillPackage; draft: Draft }> {
  if (new TextEncoder().encode(source).length > SKILL_PACKAGE_BYTES)
    throw Error("Пакет превышает 64 КБ.");
  const value: unknown = JSON.parse(source.replace(/^\uFEFF/u, ""));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Нужен JSON-пакет Kosmora Skill.");
  const v = value as Record<string, unknown>;
  const keys = ["format", "name", "summary", "instructions", "execution", "permissions", "sha256"];
  if (
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((key) => !keys.includes(key)) ||
    v.format !== "kosmora.skill.v1" ||
    v.execution !== "disabled" ||
    !Array.isArray(v.permissions) ||
    v.permissions.length ||
    typeof v.name !== "string" ||
    typeof v.summary !== "string" ||
    typeof v.instructions !== "string" ||
    typeof v.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(v.sha256)
  )
    throw Error("Некорректный пакет: нужны текстовая инструкция и пустые разрешения.");
  const raw = { name: v.name, summary: v.summary, instructions: v.instructions };
  const draft = normalizeDraft(raw);
  if ((await digest(raw)) !== v.sha256)
    throw Error("SHA-256 не совпадает. Пакет изменён или повреждён.");
  return {
    package: {
      format: "kosmora.skill.v1",
      ...asDraft(raw),
      execution: "disabled",
      permissions: [],
      sha256: v.sha256
    },
    draft
  };
}
export function downloadSkillPackage(value: SkillPackage, name: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 80) || "skill"}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
