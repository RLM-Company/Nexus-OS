import { expect, it } from "vitest";
import {
  exportOwnerSkillPackage,
  verifyOwnerSkillPackage
} from "../../apps/api/src/owner-skill-package.js";
import {
  createSkillPackage,
  readSkillPackage
} from "../../apps/web/src/app/skills/skill-package.js";
it("browser preview/export and server import/export use the same hash and canonical text", async () => {
  const draft = {
    name: "Школа",
    summary: "Проверка",
    instructions: "Кириллица 😀\r\n<literal>&\ttext"
  };
  const server = exportOwnerSkillPackage(draft);
  expect((await readSkillPackage(JSON.stringify(server))).draft).toEqual(draft);
  const browser = await createSkillPackage(draft);
  expect(browser).toEqual(server);
  expect(verifyOwnerSkillPackage(browser)).toEqual(draft);
  expect(() => verifyOwnerSkillPackage({ ...browser, instructions: "changed" })).toThrow();
});
